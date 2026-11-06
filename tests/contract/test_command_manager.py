"""Offline tests for the command lifecycle guards (CommandManager) and the
tenant_tx context writer. A fake tenant_tx stands in for Postgres.
"""

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.db import context
from app.edge import commands as cm

ORG, EDGE, CID = uuid4(), uuid4(), uuid4()
POOLS = type("P", (), {"system": None, "app": None})()


class FakeTC:
    """Records writes; fetchrow/fetchval answers come from `answers`."""
    org_id = ORG

    def __init__(self, answers):
        self.answers, self.writes = answers, []

    async def fetchrow(self, sql, *a): return self.answers.get("row")
    async def fetchval(self, sql, *a): return self.answers.get("val")
    async def execute(self, sql, *a): self.writes.append((sql, a))


def _patch_tx(monkeypatch, tc):
    @asynccontextmanager
    async def fake_tx(*a, **k):
        yield tc

    monkeypatch.setattr(cm, "tenant_tx", fake_tx)


def _resp(monkeypatch, status, cid=str(CID), row=None):
    _patch_tx(monkeypatch, FakeTC({"row": row}))
    m = cm.CommandManager(POOLS, None, None, None)
    calls = []

    async def transition(*a):
        calls.append(a)
        return True

    m.transition = transition
    asyncio.run(m.handle_response(cid, status, None, ORG, EDGE))
    return calls


def test_response_from_wrong_edge_is_dropped(monkeypatch):
    assert _resp(monkeypatch, "acknowledged", row={"edge_id": uuid4()}) == []
    assert _resp(monkeypatch, "acknowledged", row=None) == []  # unknown to this org


def test_response_from_owning_edge_transitions(monkeypatch):
    calls = _resp(monkeypatch, "rejected", row={"edge_id": EDGE})
    assert calls[0][1] == "rejected" and calls[0][3] == f"edge:{EDGE}"


def test_unknown_status_and_bad_id_never_touch_state(monkeypatch):
    assert _resp(monkeypatch, "dispatched", row={"edge_id": EDGE}) == []
    assert _resp(monkeypatch, "acknowledged", cid="nope", row={"edge_id": EDGE}) == []


def test_late_edge_response_is_event_only(monkeypatch):
    """Terminal states never change: a response after timeout only logs."""
    tc = FakeTC({"row": None, "val": "timeout"})
    _patch_tx(monkeypatch, tc)
    m = cm.CommandManager(POOLS, None, None, None)
    assert asyncio.run(m.transition(CID, "acknowledged", "ok", f"edge:{EDGE}", ORG)) is False
    assert "late_response:acknowledged" in tc.writes[0][1][-1]
    tc.writes.clear()
    asyncio.run(m.transition(CID, "failed", None, "sweeper", ORG))
    assert tc.writes == []  # a non-edge actor leaves no event on a terminal row


def test_list_v2_cursor_only_when_page_full():
    row = {"id": CID, "tag_id": CID, "value": 1, "status": "accepted", "reason": None,
           "ttl_s": 5, "idempotency_key": None, "note": None, "actor_user_id": CID,
           "actor_name": "a", "version": 1, "issued_at": cm.utcnow(), "updated_at": cm.utcnow()}

    class TC:
        async def fetch(self, sql, *a): return [row, row]

    m = cm.CommandManager(POOLS, None, None, None)
    items, nxt = asyncio.run(m.list_v2(TC(), uuid4(), 2, "garbage"))
    assert nxt == str(CID) and len(items) == 2
    assert asyncio.run(m.list_v2(TC(), uuid4(), 5, None))[1] is None


def test_tenant_tx_refuses_non_uuid_and_sets_local_context():
    sql_seen = []

    class Conn:
        async def execute(self, sql, *a): sql_seen.append(sql)

        @asynccontextmanager
        async def transaction(self): yield

    class Pool:
        @asynccontextmanager
        async def acquire(self): yield Conn()

    async def go(org, user=None):
        async with context.tenant_tx(Pool(), org, user) as tc:
            return tc

    with pytest.raises(TypeError):
        asyncio.run(go(str(ORG)))
    with pytest.raises(TypeError):
        asyncio.run(go(ORG, "u"))
    assert asyncio.run(go(ORG, CID)).org_id == ORG
    assert sql_seen and all("true" in s for s in sql_seen)  # is_local: no pooled-conn leak
