"""Offline contract for backend/app/workers.py — the webhook sweeper
(per-org cursor + enqueue) and signed delivery (X-WDS-Signature HMAC-SHA256,
X-WDS-Delivery-Id) through the egress guard. HTTP POST is stubbed via
workers._post where a live request isn't under test; the sealed secret
round-trips through the real secretbox (dev key). Async workers are driven
with asyncio.run — pytest-asyncio is not part of the test env.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")

from app import egress, jobs, workers  # noqa: E402
from app.datasources import secretbox  # noqa: E402

ORG = uuid.uuid4()
EP = uuid.uuid4()
ALARM = uuid.uuid4()
SECRET = "s" * 48


class FakeConn:
    """Global-tx org list, then per-org tenant reads keyed by SQL.

    `endpoints`/`alarms_by_org`/`cursor_rows` kwargs make the fake org-aware:
    the endpoints query sets self._org (mirroring tenant_tx + RLS scoping the
    source tables) so subsequent source fetches return only that org's rows.
    """

    def __init__(self, **kw):
        self.kw = kw
        self.jobs = []                # (sql_args) of INSERT INTO jobs
        self.deliveries = []          # (sql, args) of delivery INSERT/UPDATE
        self.cursors = []             # args of webhook_cursor upserts
        self.cursor_rows = dict(kw.get("cursor_rows", {}))
        self.executed = []            # every execute() call: (sql, args)
        self._org = None

    @asynccontextmanager
    async def transaction(self):
        yield self

    def _k(self, name, default=None):
        return self.kw.get(name, default)

    async def fetch(self, sql, *args):
        if "UPDATE jobs SET status='running'" in sql:      # claim_due
            return self._k("jobs_due", [])
        if "DISTINCT org_id FROM webhook_endpoints" in sql:
            return self._k("orgs", [{"org_id": ORG}])
        if "SELECT id, events FROM webhook_endpoints" in sql:
            assert "org_id=$1" in sql                     # the isolation fix
            self._org = args[0]
            eps = self._k("endpoints")
            if isinstance(eps, dict):
                return eps.get(args[0], [])
            return eps if eps is not None else \
                [{"id": EP, "events": ["alarm_raised"]}]
        if "FROM alarms" in sql and "raised_at" in sql:
            by_org = self._k("alarms_by_org")
            if by_org is not None:
                return by_org.get(self._org, [])
            return self._k("alarms", [{
                "id": ALARM, "tag_id": uuid.uuid4(), "rule_id": uuid.uuid4(),
                "severity": "critical",
                "ts": datetime.now(timezone.utc)}])
        if "FROM alarms" in sql or "FROM incidents" in sql \
                or "FROM downtimes" in sql:
            return []
        if "FROM org_exports" in sql:
            return self._k("exports", [])
        if "information_schema" in sql:
            return []
        return []

    async def fetchrow(self, sql, *args):
        if "FROM webhook_cursor" in sql:
            assert "org_id=$1" in sql and "source=$2" in sql
            cur = self._k("cursor")
            return cur if cur is not None else \
                self.cursor_rows.get((args[0], args[1]))
        if "webhook_deliveries d" in sql:
            return self._k("delivery", {
                "id": 1, "attempts": 0, "url": "https://hook.example/x",
                "secret_enc": secretbox.seal({"secret": SECRET}),
                "enabled": True})
        return None

    async def fetchval(self, sql, *args):
        if "INSERT INTO jobs" in sql:
            self.jobs.append(args)
            return len(self.jobs)
        if "information_schema" in sql:
            return None
        if "INSERT INTO webhook_deliveries" in sql:
            self.deliveries.append((sql, args))
            return 7
        if "RETURNING id" in sql:
            return 7
        return 0

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        if "webhook_deliveries" in sql:
            self.deliveries.append((sql, args))
        elif "webhook_cursor" in sql:
            self.cursors.append(args)
            self.cursor_rows[(args[0], args[1])] = \
                {"last_ts": args[2], "last_id": args[3]}
        return "UPDATE 1"


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _st(conn):
    return SimpleNamespace(pools=SimpleNamespace(system=FakePool(conn)))


def _alarm(aid, ts=None):
    return {"id": aid, "tag_id": uuid.uuid4(), "rule_id": uuid.uuid4(),
            "severity": "critical",
            "ts": ts or datetime.now(timezone.utc)}


def test_sweep_enqueues_delivery_for_new_alarm():
    conn = FakeConn()
    n = asyncio.run(workers.webhook_sweep(_st(conn)))
    assert n == 1
    kind, payload = conn.jobs[0][1], json.loads(conn.jobs[0][2])
    assert kind == "webhook_deliver"
    assert payload["event"] == "alarm_raised"
    assert payload["data"]["id"] == str(ALARM)
    assert conn.deliveries and "INSERT INTO webhook_deliveries" in conn.deliveries[0][0]
    assert conn.cursors                                   # cursor advanced


def test_sweep_isolates_orgs_endpoints_and_cursors():
    """Two orgs, one endpoint each, one alarm each: each org's sweep must
    deliver only its own events to only its own endpoint and advance only
    its own (org_id, source) cursor row."""
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    ep_a, ep_b = uuid.uuid4(), uuid.uuid4()
    alarm_a, alarm_b = uuid.uuid4(), uuid.uuid4()
    conn = FakeConn(
        orgs=[{"org_id": org_a}, {"org_id": org_b}],
        endpoints={org_a: [{"id": ep_a, "events": ["alarm_raised"]}],
                   org_b: [{"id": ep_b, "events": ["alarm_raised"]}]},
        alarms_by_org={org_a: [_alarm(alarm_a)], org_b: [_alarm(alarm_b)]})

    n = asyncio.run(workers.webhook_sweep(_st(conn)))
    assert n == 2

    # one delivery row + one job per org, carrying that org's endpoint/event
    ins = [a for s, a in conn.deliveries if "INSERT INTO webhook_deliveries" in s]
    by_org = {a[0]: a for a in ins}                     # arg0 = org_id
    assert by_org[org_a][1] == ep_a and by_org[org_b][1] == ep_b
    payloads = {json.loads(j[2])["org_id"]: json.loads(j[2]) for j in conn.jobs}
    assert payloads[str(org_a)]["data"]["id"] == str(alarm_a)
    assert payloads[str(org_b)]["data"]["id"] == str(alarm_b)
    # cursors keyed (org_id, source) — org A advancing must not skip org B
    keys = {c[:2] for c in conn.cursors}
    assert keys == {(org_a, "alarm_raised"), (org_b, "alarm_raised")}


def test_sweep_org_cursor_does_not_skip_other_orgs():
    """Org A's cursor already past the only alarm; org B has no cursor —
    B must still pick the row up (independent cursors)."""
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    ep = uuid.uuid4()
    alarm = _alarm(uuid.uuid4())
    conn = FakeConn(
        orgs=[{"org_id": org_a}, {"org_id": org_b}],
        endpoints={org_a: [{"id": ep, "events": ["alarm_raised"]}],
                   org_b: [{"id": ep, "events": ["alarm_raised"]}]},
        alarms_by_org={org_a: [], org_b: [alarm]},      # RLS: each org sees own
        cursor_rows={(org_a, "alarm_raised"):
                     {"last_ts": datetime.now(timezone.utc),
                      "last_id": uuid.uuid4()}})
    n = asyncio.run(workers.webhook_sweep(_st(conn)))
    assert n == 1                                       # only org B's row
    assert json.loads(conn.jobs[0][2])["org_id"] == str(org_b)


def test_sweep_skips_orgs_without_enabled_endpoints():
    conn = FakeConn(orgs=[])
    assert asyncio.run(workers.webhook_sweep(_st(conn))) == 0
    assert conn.jobs == []


def test_sweep_skips_events_no_endpoint_subscribes():
    conn = FakeConn(alarms=[{
        "id": ALARM, "tag_id": uuid.uuid4(), "rule_id": uuid.uuid4(),
        "severity": "info", "ts": datetime.now(timezone.utc)}])
    # endpoint only listens for alarm_cleared — alarm_raised rows advance
    # the cursor but enqueue nothing
    class NoSub(FakeConn):
        async def fetch(self, sql, *args):
            if "SELECT id, events FROM webhook_endpoints" in sql:
                self._org = args[0]
                return [{"id": EP, "events": ["alarm_cleared"]}]
            return await super().fetch(sql, *args)
    conn2 = NoSub()
    assert asyncio.run(
        workers._sweep_org(_st(conn2), ORG, {"alarm_raised": ""})) == 0


def test_deliver_posts_signed_json(monkeypatch):
    conn = FakeConn()
    captured = {}

    def fake_post(url, body, headers):
        captured.update(url=url, body=body, headers=headers)
        return 200

    monkeypatch.setattr(workers, "_post", fake_post)
    asyncio.run(workers._deliver_webhook(_st(conn), {
        "delivery_id": 1, "org_id": str(ORG),
        "event": "alarm_raised", "data": {"id": str(ALARM)}}, job_id=42))

    assert captured["url"] == "https://hook.example/x"
    expect = hmac.new(SECRET.encode(), captured["body"], hashlib.sha256).hexdigest()
    assert captured["headers"]["X-WDS-Signature"] == f"sha256={expect}"
    assert captured["headers"]["X-WDS-Event"] == "alarm_raised"
    assert captured["headers"]["X-WDS-Delivery-Id"] == "1"
    body = json.loads(captured["body"])
    assert body["event"] == "alarm_raised" and body["data"]["id"] == str(ALARM)
    upd = [x for x in conn.deliveries if "UPDATE webhook_deliveries" in x[0]]
    assert upd and "delivered" in str(upd[-1][1]) and upd[-1][1][-1] == 42


def test_deliver_non_2xx_raises_for_retry(monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(workers, "_post", lambda *a: 500)
    with pytest.raises(RuntimeError):
        asyncio.run(workers._deliver_webhook(_st(conn), {
            "delivery_id": 1, "org_id": str(ORG),
            "event": "alarm_raised", "data": {}}))


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data",          # cloud metadata
    "http://127.0.0.1:9090/internal",                   # loopback
])
def test_deliver_ssrf_url_marked_failed_not_retried(monkeypatch, url):
    """A tampered/legacy endpoint URL that fails egress policy must flip the
    delivery to 'failed' and NOT raise — raising would burn job retries."""
    monkeypatch.delenv("WDS_EGRESS_ALLOW_PRIVATE", raising=False)
    conn = FakeConn(delivery={
        "id": 1, "attempts": 0, "url": url,
        "secret_enc": secretbox.seal({"secret": SECRET}), "enabled": True})
    asyncio.run(workers._deliver_webhook(_st(conn), {   # no raise
        "delivery_id": 1, "org_id": str(ORG),
        "event": "alarm_raised", "data": {}}))
    upd = [x for x in conn.deliveries if "UPDATE webhook_deliveries" in x[0]]
    assert upd and "status='failed'" in upd[-1][0]


def test_deliver_disabled_endpoint_marks_failed_not_retried():
    conn = FakeConn(delivery={
        "id": 1, "attempts": 0, "url": "https://hook.example/x",
        "secret_enc": secretbox.seal({"secret": SECRET}), "enabled": False})
    asyncio.run(workers._deliver_webhook(_st(conn), {   # no raise
        "delivery_id": 1, "org_id": str(ORG),
        "event": "alarm_raised", "data": {}}))
    upd = [x for x in conn.deliveries if "UPDATE webhook_deliveries" in x[0]]
    assert upd and "status='failed'" in upd[-1][0]


def test_post_guards_egress_and_skips_redirects(monkeypatch):
    """workers._post must run the egress check then post_no_redirect."""
    monkeypatch.delenv("WDS_EGRESS_ALLOW_PRIVATE", raising=False)
    with pytest.raises(egress.EgressError):
        workers._post("http://169.254.169.254/x", b"{}", {})
    sent = {}
    monkeypatch.setattr(egress, "check_url", lambda u, **kw: u)
    monkeypatch.setattr(egress, "post_no_redirect",
                        lambda u, b, h, timeout: sent.update(
                            url=u, body=b, headers=h, t=timeout) or 204)
    assert workers._post("https://hook.example/x", b"{}", {}) == 204
    assert sent["t"] > 0


def test_reaper_requeues_stale_running_job():
    """A 'running' job whose locked_at is >10min old goes back to 'pending'
    (worker crashed mid-job); claims stamp locked_at."""
    assert "locked_at=now()" in jobs._CLAIM
    conn = FakeConn()
    n = asyncio.run(jobs.reap_stuck(conn))
    sql = conn.executed[-1][0]
    assert "status='pending'" in sql and "locked_at" in sql \
        and "10 minutes" in sql
    assert n == 1                                       # FakeConn: "UPDATE 1"


def test_runner_calls_reaper_and_completes():
    conn = FakeConn(jobs_due=[])                        # nothing due
    ran = asyncio.run(workers.job_runner(_st(conn)))
    assert ran == 0
    assert any("interval '10 minutes'" in s for s, _ in conn.executed)


def test_runner_marks_delivery_failed_when_attempts_exhausted(monkeypatch):
    """webhook_deliver job dying on its last attempt -> terminal 'failed'."""
    conn = FakeConn(jobs_due=[{
        "id": 9, "kind": "webhook_deliver",
        "payload": json.dumps({"delivery_id": 5, "org_id": str(ORG),
                               "event": "alarm_raised", "data": {}}),
        "attempts": 8, "max_attempts": 8}])
    monkeypatch.setattr(workers, "_post", lambda *a: 500)
    ran = asyncio.run(workers.job_runner(_st(conn)))
    assert ran == 1
    assert any("status='failed'" in s for s, _ in conn.deliveries)
