"""Vision rule shapes — the wire contract between the console, the backend and
the gateway's rule engine (roadmap 9.7).

Rules are written ONLY here in the backend (CRUD router) and delivered inside
the cfg cameras[] entries; the gateway never edits them. These validators are
the backend's side of that contract — the edge re-validates everything it
receives because cfg content is untrusted input there.
"""

from __future__ import annotations

import math
from uuid import UUID

MAX_RULES_PER_CAMERA = 32
MAX_CLASS_IDS = 64
MAX_ZONE_POINTS = 64
MAX_ACTIONS = 8
MAX_NAME = 120
MAX_MESSAGE = 200
MAX_PULSE_MS = 60_000
MAX_HOLD_MS = 60_000
MAX_HOLD_FRAMES = 600

SEVERITIES = ("info", "warning", "critical")
ACTION_KINDS = ("plc_write", "counter", "alarm", "notify", "snapshot")


def _num(v, lo: float, hi: float, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError(f"{what} must be a number")
    f = float(v)
    if not math.isfinite(f) or not lo <= f <= hi:
        raise ValueError(f"{what} must be between {lo} and {hi}")
    return f


def _int(v, lo: int, hi: int, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{what} must be an integer between {lo} and {hi}")
    return v


def validate_zone(zone) -> list[list[float]]:
    """Normalized polygon [[x,y], ...], 3..64 points in [0,1]."""
    if not isinstance(zone, (list, tuple)) or not 3 <= len(zone) <= MAX_ZONE_POINTS:
        raise ValueError(f"zone must be a polygon of 3 to {MAX_ZONE_POINTS} points")
    out = []
    for p in zone:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ValueError("zone points must be [x, y] pairs")
        out.append([_num(p[0], 0.0, 1.0, "zone x"), _num(p[1], 0.0, 1.0, "zone y")])
    return out


def validate_conditions(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("conditions must be an object")
    if set(raw) - {"class_ids", "min_score", "zone", "min_area",
                   "hold_frames", "hold_ms", "count_in_zone"}:
        raise ValueError("conditions has unknown keys")
    ids = raw.get("class_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_CLASS_IDS:
        raise ValueError(f"conditions.class_ids must name 1 to {MAX_CLASS_IDS} classes")
    out_ids = []
    for i in ids:
        if isinstance(i, bool) or not isinstance(i, int) or not 0 <= i <= 9999:
            raise ValueError("conditions.class_ids entries must be integers >= 0")
        if i not in out_ids:
            out_ids.append(i)
    out: dict = {"class_ids": out_ids}
    if "min_score" in raw:
        out["min_score"] = _num(raw["min_score"], 0.05, 1.0, "min_score")
    if "zone" in raw and raw["zone"] is not None:
        out["zone"] = validate_zone(raw["zone"])
    if "min_area" in raw and raw["min_area"] is not None:
        out["min_area"] = _num(raw["min_area"], 0.0, 1.0, "min_area")
    if "hold_frames" in raw and raw["hold_frames"] is not None:
        out["hold_frames"] = _int(raw["hold_frames"], 1, MAX_HOLD_FRAMES, "hold_frames")
    if "hold_ms" in raw and raw["hold_ms"] is not None:
        out["hold_ms"] = _int(raw["hold_ms"], 1, MAX_HOLD_MS, "hold_ms")
    if "count_in_zone" in raw and raw["count_in_zone"] is not None:
        out["count_in_zone"] = _int(raw["count_in_zone"], 1, 1000, "count_in_zone")
        if "zone" not in out:
            raise ValueError("count_in_zone needs a zone")
    return out


def _tag_path(v) -> str:
    if not isinstance(v, str) or not 1 <= len(v) <= 200 or not all(
            c.isalnum() or c in "_/-" for c in v):
        raise ValueError("tag_path must be a path like 'sort/line1/pusher'")
    return v


def validate_actions(raw) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ACTIONS:
        raise ValueError(f"actions must name 1 to {MAX_ACTIONS} actions")
    out = []
    for a in raw:
        if not isinstance(a, dict):
            raise ValueError("each action must be an object")
        kind = a.get("kind")
        if kind not in ACTION_KINDS:
            raise ValueError(f"action kind must be one of {ACTION_KINDS}")
        known = {"kind", "tag_path", "value", "pulse_ms", "by", "severity", "message"}
        if set(a) - known:
            raise ValueError("action has unknown keys")
        if kind == "plc_write":
            tag = _tag_path(a.get("tag_path"))
            value = a.get("value")
            if isinstance(value, bool):
                v = value
            elif isinstance(value, (int, float)) and math.isfinite(float(value)):
                v = value
            else:
                raise ValueError("plc_write needs a numeric or boolean value")
            act: dict = {"kind": "plc_write", "tag_path": tag, "value": v}
            if "pulse_ms" in a and a["pulse_ms"] is not None:
                act["pulse_ms"] = _int(a["pulse_ms"], 1, MAX_PULSE_MS, "pulse_ms")
            out.append(act)
        elif kind == "counter":
            out.append({"kind": "counter", "tag_path": _tag_path(a.get("tag_path")),
                        "by": _num(a.get("by", 1), -1e6, 1e6, "by")})
        elif kind == "alarm":
            sev = a.get("severity", "warning")
            if sev not in SEVERITIES:
                raise ValueError(f"severity must be one of {SEVERITIES}")
            msg = a.get("message")
            if msg is not None and (not isinstance(msg, str) or not 1 <= len(msg) <= MAX_MESSAGE):
                raise ValueError(f"message must be 1..{MAX_MESSAGE} chars")
            out.append({"kind": "alarm", "severity": sev, "message": msg})
        elif kind == "notify":
            msg = a.get("message")
            if msg is not None and (not isinstance(msg, str) or not 1 <= len(msg) <= MAX_MESSAGE):
                raise ValueError(f"message must be 1..{MAX_MESSAGE} chars")
            out.append({"kind": "notify", "message": msg})
        else:  # snapshot
            out.append({"kind": "snapshot"})
    return out


def has_plc_action(actions: list[dict]) -> bool:
    return any(a["kind"] in ("plc_write", "counter") for a in actions)


def rule_json(r) -> dict:
    """vision_events/rule API shape from a vision_rules row."""
    from ..db.util import iso_z            # local: keep this module import-light
    return {"id": str(r["id"]), "camera_id": str(r["camera_id"]),
            "model_version_id": str(r["model_version_id"]) if r["model_version_id"] else None,
            "name": r["name"], "enabled": r["enabled"], "dry_run": r["dry_run"],
            "allow_cloud_write": r["allow_cloud_write"],
            "offline_write_window_s": r["offline_write_window_s"],
            "conditions": r["conditions"], "actions": r["actions"],
            "created_at": iso_z(r["created_at"]), "updated_at": iso_z(r["updated_at"])}


def rule_cfg(r) -> dict:
    """The edge-facing slice of a rule row (inside cfg cameras[].rules)."""
    return {"id": str(r["id"]), "name": r["name"], "enabled": r["enabled"],
            "dry_run": r["dry_run"], "allow_cloud_write": r["allow_cloud_write"],
            "offline_write_window_s": r["offline_write_window_s"],
            "conditions": r["conditions"], "actions": r["actions"]}


async def rules_for_cfg(tc, camera_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """camera_id -> [rule_cfg] for every ENABLED-or-disabled rule of these
    cameras (the gateway needs disabled state too — a rule arriving disabled
    must disarm a live one)."""
    if not camera_ids:
        return {}
    out: dict[UUID, list[dict]] = {}
    rows = await tc.fetch(
        "SELECT * FROM vision_rules WHERE camera_id = ANY($1::uuid[])"
        " ORDER BY camera_id, created_at", camera_ids)
    for r in rows:
        out.setdefault(r["camera_id"], []).append(rule_cfg(r))
    return out


def _plan_flag(plan: dict | None, key: str, default: bool) -> bool:
    if not isinstance(plan, dict):
        return default
    v = plan.get(key)
    return v if isinstance(v, bool) else default


def _plan_window(plan: dict | None) -> int:
    """Org default offline write window (s): plan_limits.offline_write_window_s,
    default 900, 0 = never write while offline."""
    v = (plan or {}).get("offline_write_window_s")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 900
    return max(0, min(86400, int(v)))


async def gate_for_cfg(tc, site_id: UUID, org_id: UUID) -> dict:
    """Off-switches the edge command gate caches: site control_enabled, org
    'AI may write to PLC' (plan_limits.ai_plc_write, default false — write
    access is opt-in) and the org offline write window."""
    row = await tc.fetchrow("SELECT control_enabled FROM sites WHERE id=$1", site_id)
    plan = await tc.fetchval("SELECT plan_limits FROM organizations WHERE id=$1", org_id)
    return {"control_enabled": bool(row["control_enabled"]) if row else False,
            "ai_plc_write": _plan_flag(plan, "ai_plc_write", False),
            "offline_write_window_s": _plan_window(plan)}
