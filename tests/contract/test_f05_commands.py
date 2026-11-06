"""F05 auditable commands — server-side gates and edge read-back.

The guards live in CommandManager.preflight/issue (a trust boundary), so these
tests drive them directly with a fake tenant transaction instead of going
through the UI. The edge read-back is driven through the real CommandHandler.
"""

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "edge-bridge"))

from app.edge import commands as cm  # noqa: E402
from edge_bridge.adapters.base import Quality, TagValue, WriteResult  # noqa: E402
from edge_bridge.commands import CommandHandler  # noqa: E402

ORG, SITE, EDGE, USER = uuid4(), uuid4(), uuid4(), uuid4()
POOLS = SimpleNamespace(app=None, system=None)
GUARD = "sort/line1/guard/door_closed"


def _tag(**kw):
    base = dict(id=uuid4(), org_id=ORG, site_id=SITE, edge_id=EDGE,
                path="sort/line1/motor1/speed_sp", name="speed_sp", type="number",
                unit="Hz", writable=True, min_value=0.0, max_value=60.0)
    base.update(kw)
    return SimpleNamespace(**base)


class _NoopTx:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False


class FakeTC:
    org_id = ORG

    def __init__(self, requires=None, latest=None, in_flight=None):
        self.requires, self.latest, self.in_flight = requires or [], latest or {}, in_flight
        self.writes = []
        self.conn = SimpleNamespace(transaction=lambda: _NoopTx())

    async def fetchval(self, sql, *a):
        if "SELECT requires" in sql:
            return self.requires
        if "FROM commands WHERE tag_id" in sql:
            return self.in_flight
        return None

    async def fetch(self, sql, *a):
        return [{"path": p, **row} for p, row in self.latest.items()]

    async def fetchrow(self, sql, *a): return None
    async def execute(self, sql, *a): self.writes.append((sql, a))


@pytest.fixture
def mgr(monkeypatch):
    async def allowed(tc, user, tag_id): return True
    monkeypatch.setattr(cm, "area_allowed", allowed)
    reg = SimpleNamespace(edge=lambda eid: SimpleNamespace(status="active"))
    return cm.CommandManager(POOLS, None, None, reg)


def _use(monkeypatch, tc):
    @asynccontextmanager
    async def tx(*a, **k):
        yield tc
    monkeypatch.setattr(cm, "tenant_tx", tx)


def _pre(mgr, tc, tag, value, note="Catch up on plan"):
    return asyncio.run(mgr.preflight(tc, tag=tag, user_id=USER, value=value, note=note))


def _failed(checks):
    return {c["id"]: c["error"] for c in checks if not c["ok"]}


def _issue(mgr, monkeypatch, tc, tag, value, **kw):
    _use(monkeypatch, tc)
    return asyncio.run(mgr.issue(tag=tag, org_id=ORG, site_id=SITE, value=value, ttl_s=10,
                                 idempotency_key=None, user_id=USER, **kw))


def _latest(v=True, q="good", age_s=1):
    return {"v": v, "q": q, "ts": datetime.now(timezone.utc) - timedelta(seconds=age_s)}


# ----------------------------------------------------------------- limits
@pytest.mark.parametrize("value", [-0.1, 60.5, 1e9])
def test_limit_is_enforced_on_the_server(mgr, monkeypatch, value):
    assert _failed(_pre(mgr, FakeTC(), _tag(), value)) == {"range": "out_of_range"}
    code, body = _issue(mgr, monkeypatch, FakeTC(), _tag(), value, note="x")
    assert (code, body["detail"], body["min"], body["max"]) == (422, "out_of_range", 0.0, 60.0)


def test_value_inside_limits_passes_every_gate(mgr):
    assert _failed(_pre(mgr, FakeTC(), _tag(), 32.0)) == {}


@pytest.mark.parametrize("tag,value", [
    (_tag(), True), (_tag(), float("nan")), (_tag(), float("inf")),
    (_tag(type="bool", min_value=None, max_value=None), 1.0),
])
def test_wrong_type_or_non_finite_is_invalid(mgr, tag, value):
    assert _failed(_pre(mgr, FakeTC(), tag, value)).get("type") == "invalid_value"


def test_read_only_tag_is_refused_server_side(mgr, monkeypatch):
    code, body = _issue(mgr, monkeypatch, FakeTC(), _tag(writable=False), 10.0, note="x")
    assert (code, body["detail"]) == (403, "not_writable")


# ------------------------------------------------------------- permissive
@pytest.mark.parametrize("latest,why", [  # lazy: ts must be fresh at run time
    (lambda: {GUARD: _latest(False)}, "not_satisfied"),
    (lambda: {GUARD: _latest(True, q="bad")}, "bad_quality"),
    (lambda: {GUARD: _latest(True, age_s=600)}, "stale"),
    (lambda: {}, "missing"),
    (lambda: {GUARD: {"v": None, "q": None, "ts": None}}, "missing"),
])
def test_permissive_not_met_refuses_and_fails_closed(mgr, monkeypatch, latest, why):
    tc = FakeTC(requires=[GUARD], latest=latest())
    code, body = _issue(mgr, monkeypatch, tc, _tag(), 32.0, note="x")
    assert (code, body["detail"], body["why"], body["tag"]) == (409, "permissive_not_met", why, GUARD)
    assert not any("INSERT INTO commands" in w[0] for w in tc.writes)


def test_permissive_satisfied_passes(mgr):
    tc = FakeTC(requires=[GUARD], latest={GUARD: _latest(True)})
    assert _failed(_pre(mgr, tc, _tag(), 32.0)) == {}


# ----------------------------------------------------------------- reason
@pytest.mark.parametrize("note", [None, "", "   ", "\n\t"])
def test_reason_is_required_on_issue(mgr, monkeypatch, note):
    tc = FakeTC()
    code, body = _issue(mgr, monkeypatch, tc, _tag(), 32.0, note=note)
    assert (code, body["detail"]) == (422, "reason_required")
    assert tc.writes == []  # nothing inserted, nothing audited as sent


def test_reason_too_long_is_refused_before_the_db_check(mgr):
    assert _failed(_pre(mgr, FakeTC(), _tag(), 32.0, note="x" * 201)) == {"reason": "reason_too_long"}


def test_v1_shim_without_reason_field_is_marked_not_blank(mgr, monkeypatch):
    """v1 body has no reason yet: the row must say so, never stay empty."""
    tc = FakeTC()
    seen = {}

    async def insert_probe(sql, *a):
        if "INSERT INTO commands" in sql:
            seen["note"] = a[8]
            raise RuntimeError("stop after insert")
    tc.execute = insert_probe
    with pytest.raises(RuntimeError):
        _issue(mgr, monkeypatch, tc, _tag(), 32.0)
    assert seen["note"] == cm.V1_NO_REASON


# ------------------------------------------------------------------ dry run
def test_dry_run_reports_all_gates_and_never_sends(mgr, monkeypatch):
    tc = FakeTC(requires=[GUARD], latest={GUARD: _latest(False)})
    _use(monkeypatch, tc)
    mgr.mqtt = SimpleNamespace(publish_command=lambda *a: pytest.fail("dry run published"))
    code, out = asyncio.run(mgr.dry_run(tag=_tag(), org_id=ORG, value=99.0, note=None, user_id=USER))
    assert code == 200 and out["dry_run"] and out["sent"] is False and out["ok"] is False
    failed = {c["id"]: c["error"] for c in out["checks"] if not c["ok"]}
    assert failed == {"reason": "reason_required", "range": "out_of_range",
                      "permissive": "permissive_not_met"}  # all reported, none short-circuited
    assert not any("INSERT INTO commands" in w[0] for w in tc.writes)
    assert any("audit_log" in w[0] for w in tc.writes)  # the rehearsal itself is traced


def test_dry_run_ok_when_all_pass(mgr, monkeypatch):
    _use(monkeypatch, FakeTC())
    code, out = asyncio.run(mgr.dry_run(tag=_tag(), org_id=ORG, value=32.0, note="r", user_id=USER))
    assert out["ok"] is True and out["expected"]["value"] == 32.0


def test_unknown_is_terminal_and_never_success():
    assert "unknown" in cm.TERMINAL and cm.RESP_MAP["unknown"] == "unknown"
    assert cm.V1_STATUS["unknown"] == "unknown"


# ---------------------------------------------------------------- read-back
TAG = "plant1.sort.line1.motor1.speed_sp"


class Adapter:
    def __init__(self, readback, ok=True):
        self.readback, self.ok, self.reads = readback, ok, 0

    def write(self, tag, value):
        return WriteResult(ok=self.ok, detail="done" if self.ok else "out_of_range")

    def read_all(self):
        self.reads += 1
        rb = self.readback[min(self.reads - 1, len(self.readback) - 1)]
        if isinstance(rb, Exception):
            raise rb
        if rb is None:
            return []
        v, q = rb
        return [TagValue(name=TAG, v=v, q=q, ts=datetime.now(timezone.utc))]


def _edge(adapter):
    out = []
    bridge = SimpleNamespace(publish_json=lambda t, p: out.append(p))
    cfg = SimpleNamespace(site_code="plant1", cmd_resp_topic=lambda r: f"resp/{r}")
    clock = SimpleNamespace(clock_ok=True, now=lambda: datetime.now(timezone.utc))
    h = CommandHandler(cfg, SimpleNamespace(get=lambda: adapter), clock, bridge)
    h._sleep = lambda s: None
    return h, out


def _send(h, out, value=32.0):
    h.handle_message(SimpleNamespace(topic="v2/o/s/e/cmd/r1", retain=False, payload=json.dumps({
        "command_id": "r1", "tag_path": "sort/line1/motor1/speed_sp", "value": value,
        "issued_at": datetime.now(timezone.utc).isoformat(), "ttl_s": 10}).encode()))
    return out[-1]


def test_readback_match_is_the_only_success():
    h, out = _edge(Adapter([(32.0, Quality.GOOD)]))
    r = _send(h, out)
    assert r["status"] == "acknowledged" and r["reason"] == "readback_ok:32"


def test_readback_waits_out_plc_scan_lag():
    a = Adapter([(40.0, Quality.GOOD), (32.0, Quality.GOOD)])
    h, out = _edge(a)
    assert _send(h, out)["status"] == "acknowledged" and a.reads == 2


def test_readback_mismatch_is_failed_not_success():
    h, out = _edge(Adapter([(40.0, Quality.GOOD)]))
    r = _send(h, out)
    assert r["status"] == "failed" and r["reason"] == "readback_mismatch:expected=32,actual=40"


@pytest.mark.parametrize("rb,why", [
    ([(32.0, Quality.BAD)], "quality_bad"),
    ([None], "tag_not_readable"),
    ([OSError("link down")], "read_error:link down"),
])
def test_unconfirmable_write_is_unknown_not_success(rb, why):
    h, out = _edge(Adapter(rb))
    r = _send(h, out)
    assert r["status"] == "unknown" and r["reason"] == f"readback_unavailable:{why}"


def test_bool_readback_accepts_plc_zero_one():
    h, out = _edge(Adapter([(1, Quality.GOOD)]))
    assert _send(h, out, value=True)["status"] == "acknowledged"
    h, out = _edge(Adapter([(0, Quality.GOOD)]))
    assert _send(h, out, value=True)["status"] == "failed"


def test_rejected_write_is_never_read_back():
    a = Adapter([(32.0, Quality.GOOD)], ok=False)
    h, out = _edge(a)
    assert _send(h, out)["status"] == "rejected" and a.reads == 0


# -------------------------------------------------------------------- audit
def test_every_transition_audits_the_operators_reason(mgr):
    """command.<status> audit rows carry the note, so the reason is in the log."""
    class TC(FakeTC):
        async def fetchrow(self, sql, *a):
            return {"tag_id": uuid4(), "value": 32.0, "idempotency_key": None,
                    "note": "Catch up on plan"}
    tc = TC()
    asyncio.run(mgr._record(tc, uuid4(), "dispatched", "unknown", f"edge:{EDGE}",
                            "readback_unavailable:quality_bad"))
    row = [w for w in tc.writes if "audit_log" in w[0]][0][1]
    assert row[2] == "command.unknown"
    assert row[4]["note"] == "Catch up on plan"
    assert row[4]["reason"] == "readback_unavailable:quality_bad"


def test_earlier_mismatch_is_not_hidden_by_a_later_unreadable_read():
    h, out = _edge(Adapter([(40.0, Quality.GOOD), None]))
    r = _send(h, out)
    assert r["status"] == "failed" and r["reason"] == "readback_mismatch:expected=32,actual=40"
