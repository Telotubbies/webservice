"""Command handler — `v2/{org}/{site}/{edge}/cmd/{command_id}` ->
`v2/{org}/{site}/{edge}/cmd-resp/{command_id}` (doc 17 §1/§6).

Pipeline (contract §Command lifecycle + SDLC 04 §5):

    parse JSON -> clock trusted? -> TTL live? -> idempotent replay? ->
    adapter.write() -> always publish cmd-resp

Wire vocabulary (doc 17 §6): status ∈ acknowledged | rejected | failed,
reason carries the detail (clock_untrusted, ttl_expired, not_writable,
out_of_range, …). The command payload names the tag as `tag_path` — the
site-relative path (area/line/device/signal), which maps back to the
adapter's dotted name via site_code.
"""

from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from datetime import datetime, timezone

from . import ops
from .clock import EdgeClock
from .config import Config
from .mqtt_bridge import MqttBridge

log = logging.getLogger("edge_bridge.cmd")

_DEFAULT_TTL_S = 60.0        # used if the backend omits ttl_s
_MAX_TTL_S = 3600.0          # bounded: an attacker-set year-long TTL is a time bomb
_MAX_FUTURE_S = 2.0          # issued_at tolerance for harmless clock noise
_IDEMPOTENCY_MAX = 1000      # SDLC 04 §5: remember last N command keys


class CommandHandler:
    def __init__(self, cfg: Config, holder,
                 clock: EdgeClock, bridge: MqttBridge):
        self._cfg = cfg
        self._holder = holder  # AdapterHolder: adapter may be swapped live
        self._clock = clock
        self._bridge = bridge
        # idempotency_key -> (status, reason); FIFO eviction
        self._seen: OrderedDict[str, tuple[str, str]] = OrderedDict()
        self.handled = 0
        self.denied = 0

    @property
    def cmd_topic(self) -> str:
        return self._cfg.cmd_topic

    # -- entry point (paho network thread) -----------------------------------

    def handle_message(self, msg) -> None:
        req_id = msg.topic.rsplit("/", 1)[-1]
        # Retained commands must never execute: a retained publish replays on
        # every reconnect — that's replay-by-design, not a fresh operator intent.
        if getattr(msg, "retain", False):
            self._respond(req_id, "rejected", "retained_command", req_id)
            log.warning("dropped retained command req_id=%s", req_id)
            return
        try:
            status, reason, command_id = self._execute(req_id, msg.payload)
        except Exception as exc:  # belt-and-braces: never drop a response
            log.exception("command handler crashed req_id=%s", req_id)
            status, reason, command_id = "failed", f"internal:{exc}", req_id
        if status == "pending":  # an op worker thread will respond
            return
        self._respond(req_id, status, reason, command_id)

    def _run_op(self, req_id: str, op: str, payload: dict,
                command_id: object) -> None:
        """Worker thread: ops can block on the network for seconds, which
        must never stall the paho network thread."""
        try:
            result = ops.run(op, payload)
            status, reason = "acknowledged", "ok"
        except ops.OpError as exc:
            result, status, reason = None, "failed", str(exc)
        except Exception as exc:  # noqa: BLE001 - always answer
            log.exception("op crashed req_id=%s op=%s", req_id, op)
            result, status, reason = None, "failed", f"internal:{exc}"
        self._respond(req_id, status, reason, command_id, result)

    def _respond(self, req_id: str, status: str, reason: str,
                 command_id: object, result: dict | None = None) -> None:
        resp_topic = self._cfg.cmd_resp_topic(req_id)
        resp = {
            "command_id": command_id,
            "status": status,
            "reason": reason,
            "ts": self._clock.now().isoformat().replace("+00:00", "Z"),
        }
        if result is not None:
            resp["result"] = result
        self._bridge.publish_json(resp_topic, resp)
        self.handled += 1
        if status == "rejected":
            self.denied += 1
        log.info("command req_id=%s command_id=%s status=%s reason=%s",
                 req_id, command_id, status, reason,
                 extra={"fields": {"event": "cmd_resp", "req_id": req_id,
                                   "command_id": command_id, "status": status,
                                   "reason": reason}})

    # -- validation + execution ----------------------------------------------

    def _execute(self, req_id: str, raw: bytes) -> tuple[str, str, object]:
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("payload is not an object")
        except (ValueError, UnicodeDecodeError):
            return "failed", "invalid_json", req_id

        command_id = payload.get("command_id", req_id)
        # doc 17 §6 + CONTRACT.v2 §6: `tag_path` (site-relative); the legacy
        # `tag` key is tolerated so in-flight v1 commands don't die mid-deploy
        tag_path = payload.get("tag_path") or payload.get("tag")
        value = payload.get("value")
        issued_at_raw = payload.get("issued_at")

        op = payload.get("op")
        if op is not None and op not in ops.OPS:
            return "failed", "unknown_op", command_id
        if (op is None and not isinstance(tag_path, str)) or issued_at_raw is None:
            return "failed", "invalid_command", command_id
        tag = self._adapter_name(tag_path) if op is None else ""
        try:
            issued_at = _parse_ts(str(issued_at_raw))
            ttl_s = float(payload.get("ttl_s", _DEFAULT_TTL_S))
        except (ValueError, TypeError):
            return "failed", "invalid_command", command_id

        # TTL must be finite and bounded — a huge TTL keeps a stale command
        # executable forever (contract: ttl_s 1..3600).
        if not (0 < ttl_s <= _MAX_TTL_S) or ttl_s != ttl_s:
            return "failed", "invalid_command", command_id

        # Clock check BEFORE ttl math: a TTL computed on an untrusted clock
        # proves nothing (SDLC 04 §6.6).
        if not self._clock.clock_ok:
            return "rejected", "clock_untrusted", command_id
        now = self._clock.now()
        # Commands "issued" in the future are either clock lies or a crafted
        # payload trying to make TTL math useless — never honour them.
        if issued_at.timestamp() > now.timestamp() + _MAX_FUTURE_S:
            return "rejected", "future_issued_at", command_id
        if now > datetime.fromtimestamp(
                issued_at.timestamp() + ttl_s, tz=timezone.utc):
            return "rejected", "ttl_expired", command_id

        if op is not None:
            # read-only op on a throwaway adapter; answered from a worker
            threading.Thread(target=self._run_op,
                             args=(req_id, op, payload, command_id),
                             name=f"edge-op-{req_id[:8]}", daemon=True).start()
            return "pending", "", command_id

        idem = payload.get("idempotency_key")
        if idem is not None and idem in self._seen:
            status, reason = self._seen[idem]
            log.info("idempotent replay req_id=%s key=%s -> %s/%s",
                     req_id, idem, status, reason)
            return status, reason, command_id

        try:
            result = self._holder.get().write(tag, value)
            status = "acknowledged" if result.ok else "rejected"
            reason = result.detail
        except Exception as exc:
            status, reason = "failed", f"write_failed:{exc}"

        if idem is not None:
            self._seen[idem] = (status, reason)
            while len(self._seen) > _IDEMPOTENCY_MAX:
                self._seen.popitem(last=False)
        return status, reason, command_id

    def _adapter_name(self, tag_path: str) -> str:
        """'sort/line1/motor1/speed_sp' or 'plant1.sort.line1.motor1.speed_sp'
        -> the adapter's dotted name."""
        name = tag_path.replace("/", ".")
        prefix = f"{self._cfg.site_code}."
        if not name.startswith(prefix):
            name = prefix + name
        return name


def _parse_ts(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
