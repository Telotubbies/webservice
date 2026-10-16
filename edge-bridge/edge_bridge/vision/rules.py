"""Vision rule engine (roadmap 9.7): evaluates cfg-delivered rules on the
gateway next to the model server, behind a LOCAL command gate that mirrors
backend/app/edge/commands.py.

Rules arrive inside the cfg cameras[] entries (`cameras[].rules`, plus the
site/org off-switches in `cameras[].gate`) — the gateway never edits them.
Every cfg payload field is re-validated here: cfg content is untrusted input.

Gate (evaluated per action at fire time):
  - rule enabled, camera enabled, site control_enabled, org ai_plc_write —
    all cached from the last applied cfg;
  - offline write window: while the broker link is down the gateway keeps
    writing only for the window (org default 15 min, 0 = never); past it PLC
    writes are blocked (blocked_reason='offline_window'), detection/alarming
    continues;
  - cloud-placed camera: PLC writes blocked unless the rule has
    allow_cloud_write (blocked_reason='cloud_placement');
  - per tag: writable + range check vs the cfg tag limits, one write in
    flight per tag, per-tag rate limit (5 writes / 10 s, mirroring
    RATE_COMMANDS_PER_TAG/RATE_COMMANDS_WINDOW_S).

dry_run=true rules record "would fire" events (kind='dry_run') and never act.
Every real PLC write produces a signed audit record (vision/audit), published
at once or buffered on disk while offline and replayed in order on reconnect.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from ..adapters.base import Quality
from .material import parse_cfg as parse_material_cfg
from .track import IoUTracker

log = logging.getLogger("edge_bridge.vision.rules")

DEFAULT_OFFLINE_WINDOW_S = 900          # org default when cfg omits it
WRITE_RATE_N = 5                        # mirrors backend RATE_COMMANDS_PER_TAG
WRITE_RATE_WINDOW_S = 10.0              # mirrors backend RATE_COMMANDS_WINDOW_S
MIN_REFIRE_S = 1.0                      # per-rule floor between fires
MAX_ACTIONS = 8
MAX_RULES = 64
MAX_ZONE_POINTS = 64
MAX_WRITE_QUEUE = 100                   # bound on queued+running PLC writes; excess drop+count
THUMB_MAX_BYTES = 48 * 1024             # backend accepts <=96KB base64; 48KB binary -> ~64KB b64
SNAPSHOT_KEEP = 20
SPOOL_NAME = "vision-audit.jsonl"
SPOOL_MAX_BYTES = 2 * 1024 * 1024
RULE_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")   # rule.id lands in file paths — no traversal


# ------------------------------------------------------------------ geometry
def _inside(x: float, y: float, poly: list) -> bool:
    """Ray-cast point-in-polygon on normalized coordinates."""
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _center(bbox: list) -> tuple[float, float]:
    return bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0


def _area(bbox: list) -> float:
    return max(0.0, float(bbox[2])) * max(0.0, float(bbox[3]))


# -------------------------------------------------------------------- parsing
def _num(v, lo: float, hi: float):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) and lo <= f <= hi else None


def _parse_conditions(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    ids = raw.get("class_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 64:
        return None
    ids = [i for i in ids if isinstance(i, int) and not isinstance(i, bool) and i >= 0]
    if not ids:
        return None
    zone = raw.get("zone")
    if zone is not None:
        if not isinstance(zone, list) or not 3 <= len(zone) <= MAX_ZONE_POINTS:
            return None
        pts = []
        for p in zone:
            if not isinstance(p, (list, tuple)) or len(p) != 2:
                return None
            px, py = _num(p[0], 0.0, 1.0), _num(p[1], 0.0, 1.0)
            if px is None or py is None:
                return None
            pts.append([px, py])
        zone = pts
    min_score = _num(raw.get("min_score", 0.0), 0.0, 1.0)
    if min_score is None:
        return None
    min_area = raw.get("min_area")
    if min_area is not None:
        min_area = _num(min_area, 0.0, 1.0)
        if min_area is None:
            return None
    hold_frames = raw.get("hold_frames")
    hold_frames = hold_frames if isinstance(hold_frames, int) \
        and not isinstance(hold_frames, bool) and 1 <= hold_frames <= 600 else None
    hold_ms = raw.get("hold_ms")
    hold_ms = hold_ms if isinstance(hold_ms, int) \
        and not isinstance(hold_ms, bool) and 1 <= hold_ms <= 60_000 else None
    count = raw.get("count_in_zone")
    count = count if isinstance(count, int) \
        and not isinstance(count, bool) and 1 <= count <= 1000 else None
    return {"class_ids": set(ids), "min_score": min_score, "zone": zone,
            "min_area": min_area, "hold_frames": hold_frames or 1,
            "hold_ms": (hold_ms or 0) / 1000.0, "count_in_zone": count}


def _parse_actions(raw) -> list | None:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ACTIONS:
        return None
    out = []
    for a in raw:
        if not isinstance(a, dict):
            return None
        kind = a.get("kind")
        if kind == "plc_write":
            tp = a.get("tag_path")
            v = a.get("value")
            if not isinstance(tp, str) or not 1 <= len(tp) <= 200:
                return None
            if not isinstance(v, (int, float, bool)) \
                    or (isinstance(v, float) and not math.isfinite(v)):
                return None
            pulse = a.get("pulse_ms")
            out.append({"kind": kind, "tag_path": tp, "value": v,
                        "pulse_ms": pulse if isinstance(pulse, int)
                        and not isinstance(pulse, bool) and 1 <= pulse <= 60_000 else None})
        elif kind == "counter":
            tp = a.get("tag_path")
            by = _num(a.get("by", 1), -1e6, 1e6)
            if not isinstance(tp, str) or not 1 <= len(tp) <= 200 or by is None:
                return None
            out.append({"kind": kind, "tag_path": tp, "by": by})
        elif kind == "alarm":
            sev = a.get("severity")
            msg = a.get("message")
            out.append({"kind": kind,
                        "severity": sev if sev in ("info", "warning", "critical") else "warning",
                        "message": str(msg)[:200] if isinstance(msg, str) else None})
        elif kind == "notify":
            msg = a.get("message")
            out.append({"kind": kind,
                        "message": str(msg)[:200] if isinstance(msg, str) else None})
        elif kind == "snapshot":
            out.append({"kind": kind})
        else:
            return None
    return out


@dataclass
class _Rule:
    id: str
    name: str
    enabled: bool
    dry_run: bool
    allow_cloud_write: bool
    offline_write_window_s: int | None
    cond: dict
    actions: list
    streak: int = 0
    first_match: float | None = None
    fired: bool = False                # edge-trigger: re-arms when the condition clears
    last_fire: float = 0.0


def parse_rule(raw) -> _Rule | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) \
            or RULE_ID_RE.fullmatch(raw["id"]) is None:
        return None
    cond = _parse_conditions(raw.get("conditions"))
    actions = _parse_actions(raw.get("actions"))
    if cond is None or actions is None:
        return None
    win = raw.get("offline_write_window_s")
    if not (isinstance(win, int) and not isinstance(win, bool) and 0 <= win <= 86400):
        win = None
    return _Rule(id=raw["id"], name=str(raw.get("name") or "rule")[:120],
                 enabled=raw.get("enabled") is not False,
                 dry_run=raw.get("dry_run") is not False,
                 allow_cloud_write=raw.get("allow_cloud_write") is True,
                 offline_write_window_s=win, cond=cond, actions=actions)


# --------------------------------------------------------------- audit spool
def sign_audit(rec: dict, password: str) -> dict | None:
    """HMAC-SHA256 over the canonical record (json, sorted keys, minus `sig`)
    keyed by sha256(mqtt_password) — the same value the backend stores as the
    credential fingerprint, so no new secret is needed."""
    if not password:
        return None
    key = hashlib.sha256(password.encode("utf-8")).digest()
    msg = json.dumps({k: v for k, v in rec.items() if k != "sig"},
                     sort_keys=True, separators=(",", ":")).encode()
    out = dict(rec)
    out["sig"] = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return out


class AuditSpool:
    """Ordered disk buffer for signed audit records while the link is down."""

    def __init__(self, state_dir: str):
        self._dir = Path(state_dir)
        self._path = self._dir / SPOOL_NAME
        self._lock = threading.Lock()

    def append(self, rec: dict) -> None:
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            with self._lock:
                if self._path.exists() and self._path.stat().st_size > SPOOL_MAX_BYTES:
                    log.error("audit spool full — dropping record")
                    return
                with self._path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        except OSError:
            log.exception("audit spool append failed")

    def drain(self, publish) -> int:
        """Replay in append order. Stops at the first publish failure; the
        remaining lines stay on disk for the next reconnect."""
        with self._lock:
            try:
                lines = self._path.read_text(encoding="utf-8").splitlines()
            except FileNotFoundError:
                return 0
            except OSError:
                log.exception("audit spool read failed")
                return 0
            sent = 0
            for i, line in enumerate(lines):
                try:
                    rec = json.loads(line)
                except ValueError:
                    sent += 1                     # skip a corrupt line, keep order
                    continue
                if not publish(rec):
                    break
                sent += 1
            rest = lines[sent:]
            try:
                if rest:
                    self._path.write_text("\n".join(rest) + "\n", encoding="utf-8")
                else:
                    self._path.unlink(missing_ok=True)
            except OSError:
                log.exception("audit spool trim failed")
            return sent

    def depth(self) -> int:
        try:
            with self._lock, self._path.open("rb") as f:
                return sum(1 for _ in f)
        except OSError:
            return 0


# ------------------------------------------------------------------- engine
class _CamState:
    def __init__(self):
        self.rules: list[_Rule] = []
        self.rules_hash = ""
        self.gate: dict = {}
        self.enabled = True
        self.placement = "auto"
        self.class_config: dict = {}
        self.model_version_id: str | None = None
        self.tracker = IoUTracker()
        self.counts: dict[int, int] = {}
        self.count_minute: str = ""


class RuleEngine:
    """One engine for all cameras on this gateway. `on_detections` is invoked
    by the VisionRunner per sampled frame, from each camera's worker thread."""

    def __init__(self, holder, bridge, cfg, state_dir: str, clock=None,
                 encode_thumb=None, spool: AuditSpool | None = None,
                 executor: ThreadPoolExecutor | None = None):
        self._holder = holder              # AdapterHolder — the LIVE adapter
        self._bridge = bridge              # MqttBridge — connected state + publish
        self._cfg = cfg                    # Config — topics + site_code
        self._dir = Path(state_dir)
        self._clock = clock
        self._encode_thumb = encode_thumb  # (frame) -> jpeg bytes | None
        self.spool = spool or AuditSpool(state_dir)
        self._pool = executor or ThreadPoolExecutor(max_workers=4,
                                                    thread_name_prefix="vision-act")
        self._lock = threading.Lock()
        self._cams: dict[str, _CamState] = {}
        self._inflight: dict[str, object] = {}          # tag_path -> claimed (under _lock)
        self._tag_writes: dict[str, list[float]] = {}   # tag_path -> monotonic list (under _lock)
        self._write_queued = 0                          # queued+running pool writes (under _lock)
        self._writes_dropped = 0                        # writes refused because the queue was full
        self._offline_since: float | None = None        # stamped at disconnect, not lazily

    # ------------------------------------------------- bridge state hooks
    def note_disconnected(self, _bridge=None) -> None:
        """MqttBridge.on_disconnect: stamp the offline window NOW — the first
        gate check may come minutes later and must not re-start the clock."""
        with self._lock:
            if self._offline_since is None:
                self._offline_since = self._now()

    def note_connected(self, _bridge=None) -> None:
        with self._lock:
            self._offline_since = None

    # ------------------------------------------------------------- context
    def _now(self) -> float:
        return time.monotonic()

    def _iso_now(self) -> str:
        t = self._clock.now() if self._clock is not None else None
        if t is None:
            from datetime import datetime, timezone
            t = datetime.now(timezone.utc)
        return t.isoformat().replace("+00:00", "Z")

    def online(self) -> bool:
        return self._bridge.connected.is_set()

    def offline_seconds(self) -> float:
        if self.online():
            self.note_connected()
            return 0.0
        with self._lock:
            # fallback for a bridge that was already down before the hook
            # could fire (e.g. engine created while offline)
            if self._offline_since is None:
                self._offline_since = self._now()
            return self._now() - self._offline_since

    # --------------------------------------------------------------- cfg in
    def _cam_state(self, cam: dict) -> _CamState:
        cid = cam["id"]
        st = self._cams.get(cid)
        if st is None:
            st = self._cams[cid] = _CamState()
        st.enabled = cam.get("enabled", True) is not False
        st.gate = cam.get("gate") if isinstance(cam.get("gate"), dict) else {}
        model = cam.get("model") if isinstance(cam.get("model"), dict) else {}
        st.placement = model.get("placement") if model.get("placement") in (
            "auto", "edge", "cloud") else "auto"
        st.class_config = model.get("class_config") if isinstance(
            model.get("class_config"), dict) else {}
        st.model_version_id = model.get("version_id") if isinstance(
            model.get("version_id"), str) else None
        raw_rules = cam.get("rules") if isinstance(cam.get("rules"), list) else []
        h = hashlib.sha256(json.dumps(raw_rules[:MAX_RULES], sort_keys=True,
                                      default=str).encode()).hexdigest()
        if h != st.rules_hash:
            parsed = [r for r in (parse_rule(x) for x in raw_rules[:MAX_RULES]) if r]
            # keep hold/fire state across cfg updates of the same rule id
            old = {r.id: r for r in st.rules}
            for r in parsed:
                if r.id in old:
                    o = old[r.id]
                    r.streak, r.first_match, r.fired, r.last_fire = \
                        o.streak, o.first_match, o.fired, o.last_fire
            st.rules, st.rules_hash = parsed, h
        return st

    # ------------------------------------------------------------ evaluation
    def on_detections(self, cam: dict, dets: list, frame, detector=None) -> None:
        """VisionRunner hook — one call per sampled frame with detections."""
        st = self._cam_state(cam)
        eff_placement = getattr(detector, "placement", None) or \
            ("edge" if st.placement in ("auto", "edge") else "cloud")
        tracks, new_tracks = st.tracker.update(dets)
        self._alert_events(cam, st, new_tracks, frame)
        self._count_minute(cam, st, new_tracks)
        for rule in st.rules:
            self._eval_rule(cam, st, rule, tracks, frame, eff_placement)

    def on_material(self, cam: dict, pkg: dict, frame, detector=None) -> None:
        """A truck visit closed: record the decision package and write it to
        the configured PLC tags through the same gate/audit as any rule."""
        st = self._cam_state(cam)
        cfg = parse_material_cfg(cam.get("material"))
        if cfg is None:
            return
        o = cfg["outputs"]
        code = {"gravel": o["gravel_value"], "sand": o["sand_value"]}.get(pkg["decision"], o["none_value"])
        acts = []
        if o["code"]:
            acts.append({"kind": "plc_write", "tag_path": o["code"], "value": code, "pulse_ms": None})
        if o["margin_pct"]:
            acts.append({"kind": "plc_write", "tag_path": o["margin_pct"], "value": round(pkg["margin"] * 100), "pulse_ms": None})
        if o["uncertain"]:
            acts.append({"kind": "plc_write", "tag_path": o["uncertain"], "value": bool(pkg["uncertain"]), "pulse_ms": None})
        if o["trigger"]:       # last, and delayed: the PLC latches the data tags on this edge
            acts.append({"kind": "plc_write", "tag_path": o["trigger"], "value": True,
                         "pulse_ms": o["pulse_ms"], "delay_ms": 150})
        rule = _Rule(id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"material:{cam['id']}")), name="material decision",
                     enabled=True, dry_run=cfg["dry_run"], allow_cloud_write=False,
                     offline_write_window_s=None, cond={}, actions=acts)
        placement = getattr(detector, "placement", None) or ("edge" if st.placement in ("auto", "edge") else "cloud")
        thumb = None
        if frame is not None and self._encode_thumb is not None:
            try:
                thumb = self._encode_thumb(frame)
            except Exception:                       # noqa: BLE001
                thumb = None
        results, blocked = [], None
        for a in acts:
            if cfg["dry_run"]:
                results.append({"action": "plc_write", "tag_path": a["tag_path"], "value": a["value"], "result": "would_write"})
                continue
            reason = self._gate_write(cam, st, rule, a, placement)
            if reason is None:
                ok = self._submit_write(cam, rule, a)
                reason = None if ok else "queue_full"
            if reason is not None:
                blocked = blocked or reason
                results.append({"action": "plc_write", "tag_path": a["tag_path"], "result": "blocked", "reason": reason})
            else:
                results.append({"action": "plc_write", "tag_path": a["tag_path"], "value": a["value"], "result": "submitted"})
        detail = dict(pkg, dry_run=cfg["dry_run"], outputs=results)
        self._emit(cam, None, "material", None, st, thumb, detail,
                   severity="warning" if pkg["uncertain"] else None, score=pkg["margin"],
                   blocked_reason=blocked)

    def _match_tracks(self, rule: _Rule, tracks: list) -> list:
        c = rule.cond
        out = []
        for t in tracks:
            if t.lost > 0:              # retained for re-acquisition, not "present"
                continue
            if t.class_id not in c["class_ids"] or t.score < c["min_score"]:
                continue
            if c["min_area"] is not None and _area(t.bbox) < c["min_area"]:
                continue
            if c["zone"] is not None:
                cx, cy = _center(t.bbox)
                if not _inside(cx, cy, c["zone"]):
                    continue
            out.append(t)
        return out

    def _eval_rule(self, cam: dict, st: _CamState, rule: _Rule, tracks: list,
                   frame, placement: str) -> None:
        c = rule.cond
        if not rule.enabled:
            rule.streak, rule.first_match = 0, None
            return
        matched = self._match_tracks(rule, tracks)
        hit = len(matched) >= (c["count_in_zone"] or 1)
        now = self._now()
        if hit:
            rule.streak += 1
            if rule.first_match is None:
                rule.first_match = now
        else:
            rule.streak, rule.first_match, rule.fired = 0, None, False
            return
        due = rule.streak >= c["hold_frames"] and \
            (c["hold_ms"] <= 0 or now - (rule.first_match or now) >= c["hold_ms"])
        if not due or rule.fired or now - rule.last_fire < MIN_REFIRE_S:
            return
        rule.fired, rule.last_fire = True, now
        best = max(matched, key=lambda t: t.score) if matched else None
        self._fire(cam, st, rule, best, frame, placement)

    # -------------------------------------------------------------- actions
    def _fire(self, cam: dict, st: _CamState, rule: _Rule, track, frame,
              placement: str) -> None:
        thumb = None
        if frame is not None and self._encode_thumb is not None:
            try:
                thumb = self._encode_thumb(frame)
            except Exception:                   # noqa: BLE001
                thumb = None
        if rule.dry_run:
            self._emit(cam, rule, "dry_run", track, st, thumb,
                       {"would": [a["kind"] for a in rule.actions]})
            return
        severity, results, blocked = None, [], None
        for a in rule.actions:
            if a["kind"] in ("plc_write", "counter"):
                reason = self._gate_write(cam, st, rule, a, placement)
                if reason is not None:
                    blocked = blocked or reason
                    results.append({"action": a["kind"], "tag_path": a["tag_path"],
                                    "result": "blocked", "reason": reason})
                    continue
                if self._submit_write(cam, rule, a):
                    results.append({"action": a["kind"], "tag_path": a["tag_path"],
                                    "result": "submitted"})
                else:
                    blocked = blocked or "queue_full"
                    results.append({"action": a["kind"], "tag_path": a["tag_path"],
                                    "result": "blocked", "reason": "queue_full"})
            elif a["kind"] == "alarm":
                severity = a["severity"]
                results.append({"action": "alarm", "result": "raised",
                                "severity": a["severity"], "message": a["message"]})
            elif a["kind"] == "notify":
                severity = severity or "info"
                results.append({"action": "notify", "result": "raised",
                                "message": a["message"]})
            elif a["kind"] == "snapshot":
                self._snapshot(rule, frame)
                results.append({"action": "snapshot", "result": "saved"})
        kind = "blocked" if blocked is not None and not any(
            r["result"] == "submitted" for r in results) else "rule_fire"
        self._emit(cam, rule, kind, track, st, thumb,
                   {"actions": results}, severity=severity,
                   blocked_reason=blocked if kind == "blocked" else None)

    def _emit(self, cam: dict, rule: _Rule | None, kind: str, track,
              st: _CamState, thumb: bytes | None, detail: dict,
              severity: str | None = None, blocked_reason: str | None = None,
              class_id=None, score=None, bbox=None) -> None:
        ev = {"camera_id": cam["id"], "kind": kind,
              "rule_id": rule.id if rule else None,
              "class_id": class_id if class_id is not None
              else (track.class_id if track else None),
              "score": score if score is not None
              else (round(track.score, 4) if track else None),
              "bbox": [round(float(v), 4) for v in track.bbox] if track else bbox,
              "model_version_id": st.model_version_id,
              "severity": severity, "blocked_reason": blocked_reason,
              "fired_at": self._iso_now(), "detail": detail}
        # binary cap keeps b64 under the backend's 96KB thumb limit
        if thumb is not None and len(thumb) <= THUMB_MAX_BYTES:
            ev["thumb_b64"] = base64.b64encode(thumb).decode()
        try:
            self._bridge.publish_json(self._cfg.vision_event_topic, ev, qos=1)
        except Exception:                       # noqa: BLE001 — publishing must never kill the camera thread
            log.exception("vision event publish failed")

    # ------------------------------------------------------------- PLC gate
    def _tag_spec(self, tag_path: str) -> dict | None:
        """Limits for a tag path from the adapter's tag map (cfg-derived).
        Exact match on the site-relative path — never a suffix guess."""
        want = self._adapter_name(tag_path)
        prefix = f"{self._cfg.site_code}."
        for full, meta in self._holder.get().tag_map().items():
            if full == want:
                return meta
            if full.startswith(prefix) and \
                    full[len(prefix):].replace(".", "/") == tag_path:
                return meta
        return None

    def _adapter_name(self, tag_path: str) -> str:
        name = tag_path.replace("/", ".")
        prefix = f"{self._cfg.site_code}."
        return name if name.startswith(prefix) else prefix + name

    def _gate_write(self, cam: dict, st: _CamState, rule: _Rule, action: dict,
                    placement: str) -> str | None:
        """None = allowed, else the blocked_reason."""
        if placement == "cloud" and not rule.allow_cloud_write:
            return "cloud_placement"
        # explicit `is True` — a string "false"/"true" in cfg must not pass a gate
        if st.gate.get("control_enabled", True) is not True:
            return "control_disabled"
        if st.gate.get("ai_plc_write") is not True:
            return "ai_write_disabled"
        if self._clock is not None and not self._clock.clock_ok:
            return "clock_untrusted"
        if not self.online():
            off = self.offline_seconds()
            win = rule.offline_write_window_s
            if win is None:
                g = st.gate.get("offline_write_window_s", DEFAULT_OFFLINE_WINDOW_S)
                win = g if isinstance(g, (int, float)) and not isinstance(g, bool) \
                    and 0 <= g <= 86400 else DEFAULT_OFFLINE_WINDOW_S
            if win == 0 or off >= win:
                return "offline_window"
        spec = self._tag_spec(action["tag_path"])
        if spec is None or spec.get("writable") is not True:
            return "not_writable"
        if action["kind"] == "plc_write" and isinstance(action["value"], (int, float)) \
                and not isinstance(action["value"], bool):
            lo, hi = spec.get("min"), spec.get("max")
            if (lo is not None and action["value"] < lo) \
                    or (hi is not None and action["value"] > hi):
                return "out_of_range"
        # check + claim is ONE critical section: two camera threads must not
        # both pass the in-flight/rate checks for the same tag
        with self._lock:
            if action["tag_path"] in self._inflight:
                return "in_flight"
            now = self._now()
            writes = [t for t in self._tag_writes.get(action["tag_path"], [])
                      if now - t < WRITE_RATE_WINDOW_S]
            if writes:
                self._tag_writes[action["tag_path"]] = writes   # prunes stale entries
            else:
                self._tag_writes.pop(action["tag_path"], None)
            if len(writes) >= WRITE_RATE_N:
                return "rate_limited"
            self._inflight[action["tag_path"]] = True
            self._tag_writes.setdefault(action["tag_path"], []).append(now)
        return None

    # ------------------------------------------------------------ execution
    def _submit_write(self, cam: dict, rule: _Rule, action: dict) -> bool:
        """Queue the write. The in-flight/rate claim was already taken by
        _gate_write under _lock; False = dropped (bounded pool queue)."""
        tag = action["tag_path"]
        with self._lock:
            if self._write_queued >= MAX_WRITE_QUEUE:
                self._inflight.pop(tag, None)
                self._writes_dropped += 1
                dropped = self._writes_dropped
            else:
                self._write_queued += 1
                dropped = 0
        if dropped:
            log.warning("plc write queue full (>=%d) — dropping write tag=%s "
                        "rule=%s (total dropped=%d)",
                        MAX_WRITE_QUEUE, tag, rule.id, dropped)
            return False
        try:
            fut = self._pool.submit(self._do_write, cam["id"], rule.id, action)
        except Exception:                       # noqa: BLE001 — pool shut down
            self._write_done(tag)
            return False
        fut.add_done_callback(lambda _f, t=tag: self._write_done(t))
        return True

    def _write_done(self, tag: str) -> None:
        with self._lock:
            self._write_queued = max(0, self._write_queued - 1)
            self._inflight.pop(tag, None)

    def _do_write(self, camera_id: str, rule_id: str, action: dict) -> None:
        """Worker thread: write (+ optional pulse), then the signed audit record."""
        adapter = self._holder.get()
        name = self._adapter_name(action["tag_path"])
        ok, detail, value = False, "error", action.get("value")
        try:
            if action["kind"] == "counter":
                cur = None
                for tv in adapter.read_all():
                    if tv.name == name:
                        # only a GOOD-quality read is a real process value —
                        # never increment a BAD/UNCERTAIN sample
                        if getattr(tv, "q", None) == Quality.GOOD:
                            cur = tv.v
                        break
                if not isinstance(cur, (int, float)) or isinstance(cur, bool):
                    detail = "counter_unreadable"
                else:
                    value = float(cur) + float(action["by"])
                    res = adapter.write(name, value)
                    ok, detail = res.ok, res.detail
            else:
                if action.get("delay_ms"):
                    time.sleep(action["delay_ms"] / 1000.0)
                res = adapter.write(name, action["value"])
                ok, detail = res.ok, res.detail
                if ok and action.get("pulse_ms"):
                    time.sleep(action["pulse_ms"] / 1000.0)
                    reset = False if isinstance(action["value"], bool) else 0
                    res2 = adapter.write(name, reset)
                    if not res2.ok:
                        # a pulse that never resets leaves the tag latched —
                        # retry once, then record the failure in the audit
                        log.error("pulse reset failed tag=%s: %s — retrying once",
                                  name, res2.detail)
                        res2 = adapter.write(name, reset)
                    if not res2.ok:
                        log.error("pulse reset retry failed tag=%s: %s",
                                  name, res2.detail)
                        ok, detail = False, f"reset_failed:{res2.detail}"[:200]
        except Exception as exc:                # noqa: BLE001 — a PLC fault must not kill the pool
            detail = f"write_failed:{exc}"[:200]
        self._audit(camera_id, rule_id, action["tag_path"], value,
                    "fired" if ok else detail)

    def _audit(self, camera_id: str, rule_id: str, tag_path: str, value,
               status: str) -> None:
        rec = {"command_id": str(uuid.uuid4()), "tag_path": tag_path,
               "value": value, "rule_id": rule_id, "camera_id": camera_id,
               "source": "edge_rule", "status": status,
               "fired_at": self._iso_now()}
        _user, pw = self._cfg.credentials() if hasattr(self._cfg, "credentials") else (None, None)
        signed = sign_audit(rec, pw or "")
        if signed is None:
            log.error("cannot sign audit record — no edge credential; dropping")
            return
        if self.online() and self._bridge.publish_json(
                self._cfg.vision_audit_topic, signed, qos=1):
            return
        self.spool.append(signed)

    def flush_audit(self) -> int:
        """Replay spooled records in order — called on (re)connect."""
        return self.spool.drain(
            lambda rec: self._bridge.publish_json(self._cfg.vision_audit_topic, rec, qos=1))

    # ------------------------------------------------------- alert + counts
    def _alert_events(self, cam: dict, st: _CamState, new_tracks: list,
                      frame) -> None:
        """Every announced track of a class marked alert -> one stored event."""
        alerts = {int(k) for k, e in st.class_config.items()
                  if isinstance(e, dict) and e.get("alert") and e.get("enabled")}
        if not alerts:
            return
        want = [t for t in new_tracks if t.class_id in alerts]
        if not want:
            return
        thumb = None
        if frame is not None and self._encode_thumb is not None:
            try:
                thumb = self._encode_thumb(frame)
            except Exception:                   # noqa: BLE001
                thumb = None
        for t in want:
            self._emit(cam, None, "alert_object", t, st, thumb,
                       {"track_id": t.id})

    def _count_minute(self, cam: dict, st: _CamState, new_tracks: list) -> None:
        """Non-alert enabled classes roll up to per-minute counts (9.8)."""
        minute = self._iso_now()[:16]           # "YYYY-MM-DDTHH:MM"
        if st.count_minute and st.count_minute != minute and st.counts:
            try:
                self._bridge.publish_json(self._cfg.vision_count_topic,
                                          {"camera_id": cam["id"],
                                           "minute": st.count_minute,
                                           "counts": dict(st.counts)}, qos=0)
            except Exception:                   # noqa: BLE001
                pass
            st.counts.clear()
        st.count_minute = minute
        for t in new_tracks:
            ent = st.class_config.get(str(t.class_id))
            if isinstance(ent, dict) and ent.get("enabled") and not ent.get("alert"):
                st.counts[t.class_id] = st.counts.get(t.class_id, 0) + 1

    # --------------------------------------------------------------- snapshot
    def _snapshot(self, rule: _Rule, frame) -> None:
        if frame is None or self._encode_thumb is None:
            return
        try:
            jpeg = self._encode_thumb(frame)
            if jpeg is None:
                return
            d = self._dir / "snapshots" / rule.id
            d.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=d, prefix=".s-", suffix=".jpg")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(jpeg)
                name = f"{int(time.time() * 1000)}.jpg"
                os.replace(tmp, d / name)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            keep = sorted(d.glob("*.jpg"))
            for old in keep[:-SNAPSHOT_KEEP]:
                try:
                    old.unlink()
                except OSError:
                    pass
        except (OSError, Exception):            # noqa: BLE001 — a snapshot never kills detection
            log.exception("snapshot save failed rule=%s", rule.id)

    # ---------------------------------------------------------------- misc
    def camera_removed(self, camera_id: str) -> None:
        self._cams.pop(camera_id, None)

    def stop(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
