"""Overflow -> `resync` notice (ADR-0003 §4). No services needed."""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

from app.edge import ws as wsmod
from app.edge.ws import Client, WSManager


class FakeWS:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def _client(maxsize=2):
    c = Client(ws=FakeWS(), role="operator", org_id=uuid4())
    c.queue = asyncio.Queue(maxsize)
    c.org_roles = {c.org_id: "operator"}
    return c


def test_drop_marks_resync_pending():
    m = WSManager()
    c = _client()
    m._clients.add(c)
    for i in range(3):
        m.broadcast({"type": "tag", "i": i}, c.org_id)
    assert c.dropped == 1 and c.resync_pending


def test_no_drop_no_resync():
    m = WSManager()
    c = _client()
    m._clients.add(c)
    m.broadcast({"type": "tag"}, c.org_id)
    assert not c.resync_pending


def test_pump_sends_one_resync_then_rate_limits():
    async def run():
        m = WSManager()
        c = _client()
        m._clients.add(c)
        for i in range(4):
            m.broadcast({"type": "tag", "i": i}, c.org_id)
        task = asyncio.create_task(m.pump(c))
        await asyncio.sleep(0.05)
        first = [e for e in c.ws.sent if e["type"] == "resync"]
        assert len(first) == 1 and first[0]["reason"] == "overflow"
        assert not c.resync_pending
        # a second overflow inside the window is held back...
        for i in range(4):
            m.broadcast({"type": "tag", "i": i}, c.org_id)
        await asyncio.sleep(0.05)
        assert len([e for e in c.ws.sent if e["type"] == "resync"]) == 1
        assert c.resync_pending
        # ...and delivered once the window has passed, with no further event
        c.last_resync -= wsmod.RESYNC_MIN_S
        task.cancel()
        task2 = asyncio.create_task(m.pump(c))
        await asyncio.sleep(0.05)
        task2.cancel()
        assert len([e for e in c.ws.sent if e["type"] == "resync"]) == 2

    asyncio.run(run())
