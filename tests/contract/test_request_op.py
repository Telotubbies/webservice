"""CommandManager.request_op / resolve_op: in-memory RPC, no commands rows."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.commands import CommandManager  # noqa: E402


class FakeMqtt:
    def __init__(self, ok=True):
        self.ok, self.sent = ok, []

    def publish_command(self, topic, payload):
        self.sent.append((topic, payload))
        return self.ok


def _mgr(mqtt):
    # pools/ws/registry are never touched by the op path
    return CommandManager(None, None, mqtt, None)


def _ids():
    return uuid4(), uuid4(), uuid4()


def test_request_op_resolves_and_never_touches_db():
    async def go():
        org, site, edge = _ids()
        mqtt = FakeMqtt()
        mgr = _mgr(mqtt)
        task = asyncio.ensure_future(
            mgr.request_op(org, site, edge, "test_source", {"source": {"x": 1}}))
        await asyncio.sleep(0)
        topic, payload = mqtt.sent[0]
        rid = topic.rsplit("/", 1)[-1]
        assert topic == f"v2/{org}/{site}/{edge}/cmd/{rid}"
        assert payload["op"] == "test_source" and payload["command_id"] == rid
        assert payload["source"] == {"x": 1} and payload["ttl_s"] >= 1
        json.dumps(payload)
        # wrong edge: swallowed, not resolved
        assert mgr.resolve_op(rid, uuid4(), {"status": "acknowledged"}) is True
        assert not task.done()
        assert mgr.resolve_op(rid, edge, {"status": "acknowledged",
                                          "result": {"ok": True}}) is True
        assert await task == {"ok": True}
        assert mgr.resolve_op(rid, edge, {}) is False  # cleaned up -> falls to DB path
        assert mgr._pending_ops == {}

    asyncio.run(go())


def test_request_op_timeout_and_failure():
    async def go():
        org, site, edge = _ids()
        mgr = _mgr(FakeMqtt())
        with pytest.raises(TimeoutError):
            await mgr.request_op(org, site, edge, "browse", {}, timeout_s=0.05)
        assert mgr._pending_ops == {}
        with pytest.raises(TimeoutError):
            await _mgr(FakeMqtt(ok=False)).request_op(org, site, edge, "browse", {})

        mqtt = FakeMqtt()
        mgr = _mgr(mqtt)
        task = asyncio.ensure_future(mgr.request_op(org, site, edge, "browse", {}))
        await asyncio.sleep(0)
        rid = mqtt.sent[0][0].rsplit("/", 1)[-1]
        mgr.resolve_op(rid, edge, {"status": "failed", "reason": "browse_requires_opcua"})
        with pytest.raises(RuntimeError, match="browse_requires_opcua"):
            await task

    asyncio.run(go())
