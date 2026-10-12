"""Command handler — `plant1/cmd/edge1/{req_id}` -> `cmd-resp/edge1/{req_id}`.

Pipeline (contract §Command lifecycle + SDLC 04 §5):

    parse JSON -> clock trusted? -> TTL live? -> idempotent replay? ->
    adapter.write() -> always publish cmd-resp

Denial details come straight from the contract: `clock_untrusted`,
`ttl_expired`, `not_writable`, `out_of_range`. Malformed payloads and
adapter crashes map to status `error`. Every command gets exactly one
response — nothing is silently dropped.
"""

from __future__ import annotations

import json
import logging
from collections import OrderedDict
from datetime import datetime, timezone

from .adapters.base import TagAdapter
from .clock import EdgeClock
from .mqtt_bridge import MqttBridge

log = logging.getLogger("edge_bridge.cmd")

_DEFAULT_TTL_S = 60.0        # used if the backend omits ttl_s
_MAX_TTL_S = 3600.0          # bounded: an attacker-set year-long TTL is a time bomb
_MAX_FUTURE_S = 2.0          # issued_at tolerance for harmless clock noise
_IDEMPOTENCY_MAX = 1000      # SDLC 04 §5: remember last N command keys


class CommandHandler:
    def __init__(self, site: str, edge_id: str, adapter: TagAdapter,
                 clock: EdgeClock, bridge: MqttBridge):
        self._site = site
        self._edge_id = edge_id
        self._adapter = adapter
        self._clock = clock
        self._bridge = bridge
        # idempotency_key -> (status, detail); FIFO eviction
        self._seen: OrderedDict[str, tuple[str, str]] = OrderedDict()
        self.handled = 0
        self.denied = 0

    @property
    def cmd_topic(self) -> str:
        return f"{self._site}/cmd/{self._edge_id}/+"

    # -- entry point (paho network thread) -----------------------------------

    def handle_message(self, msg) -> None:
        req_id = msg.topic.rsplit("/", 1)[-1]
        # Retained commands must never execute: a retained publish replays on
        # every reconnect — that's replay-by-design, not a fresh operator intent.
        if getattr(msg, "retain", False):
            self._respond(req_id, "denied", "retained_command", req_id)
            log.warning("dropped retained command req_id=%s", req_id)
            return
        try:
            status, detail, command_id = self._execute(req_id, msg.payload)
        except Exception as exc:  # belt-and-braces: never drop a response
            log.exception("command handler crashed req_id=%s", req_id)
            status, detail, command_id = "error", f"internal:{exc}", req_id
        self._respond(req_id, status, detail, command_id)

    def _respond(self, req_id: str, status: str, detail: str,
                 command_id: object) -> None:
        resp_topic = f"{self._site}/cmd-resp/{self._edge_id}/{req_id}"
        resp = {
            "command_id": command_id,
            "status": status,
            "detail": detail,
            "ts": self._clock.now().isoformat().replace("+00:00", "Z"),
        }
        self._bridge.publish_json(resp_topic, resp)
        self.handled += 1
        if status == "denied":
            self.denied += 1
        log.info("command req_id=%s command_id=%s status=%s detail=%s",
                 req_id, command_id, status, detail,
                 extra={"fields": {"event": "cmd_resp", "req_id": req_id,
                                   "command_id": command_id, "status": status,
                                   "detail": detail}})

    # -- validation + execution ----------------------------------------------

    def _execute(self, req_id: str, raw: bytes) -> tuple[str, str, object]:
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("payload is not an object")
        except (ValueError, UnicodeDecodeError):
            return "error", "invalid_json", req_id

        command_id = payload.get("command_id", req_id)
        tag = payload.get("tag")
        value = payload.get("value")
        issued_at_raw = payload.get("issued_at")

        if not isinstance(tag, str) or issued_at_raw is None:
            return "error", "invalid_command", command_id
        try:
            issued_at = _parse_ts(str(issued_at_raw))
            ttl_s = float(payload.get("ttl_s", _DEFAULT_TTL_S))
        except (ValueError, TypeError):
            return "error", "invalid_command", command_id

        # TTL must be finite and bounded — a huge TTL keeps a stale command
        # executable forever (contract: ttl_s 1..3600).
        if not (0 < ttl_s <= _MAX_TTL_S) or ttl_s != ttl_s:
            return "error", "invalid_command", command_id

        # Clock check BEFORE ttl math: a TTL computed on an untrusted clock
        # proves nothing (SDLC 04 §6.6).
        if not self._clock.clock_ok:
            return "denied", "clock_untrusted", command_id
        now = self._clock.now()
        # Commands "issued" in the future are either clock lies or a crafted
        # payload trying to make TTL math useless — never honour them.
        if issued_at.timestamp() > now.timestamp() + _MAX_FUTURE_S:
            return "denied", "future_issued_at", command_id
        if now > datetime.fromtimestamp(
                issued_at.timestamp() + ttl_s, tz=timezone.utc):
            return "denied", "ttl_expired", command_id

        idem = payload.get("idempotency_key")
        if idem is not None and idem in self._seen:
            status, detail = self._seen[idem]
            log.info("idempotent replay req_id=%s key=%s -> %s/%s",
                     req_id, idem, status, detail)
            return status, detail, command_id

        try:
            result = self._adapter.write(tag, value)
            status = "done" if result.ok else "denied"
            detail = result.detail
        except Exception as exc:
            status, detail = "error", f"write_failed:{exc}"

        if idem is not None:
            self._seen[idem] = (status, detail)
            while len(self._seen) > _IDEMPOTENCY_MAX:
                self._seen.popitem(last=False)
        return status, detail, command_id


def _parse_ts(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
