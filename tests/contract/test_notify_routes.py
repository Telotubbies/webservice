"""Offline HTTP contract for the notify router (roadmap §7 Phase 3):
channel CRUD never echoes secrets, delivery log lists, ack links mint +
consume (single-use, auth-required contract), lifecycle actions, rule
routing, on-call + escalation CRUD — all against the fake-DB pattern from
test_model_test_route.py.
"""

from __future__ import annotations

import re
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import notify  # noqa: E402
from app.auth import Principal  # noqa: E402
from app.security import AuthError, ForbiddenError  # noqa: E402

ORG = uuid.uuid4()
SITE = uuid.uuid4()
UID = uuid.uuid4()
CHANNEL = uuid.uuid4()
TEAM = uuid.uuid4()
RULE = uuid.uuid4()
ALARM = uuid.uuid4()

_MISSING = object()


def _channel_row(**over):
    row = {"id": CHANNEL, "org_id": ORG, "team_id": None, "name": "Ops",
           "type": "webhook", "config": {}, "secrets_enc": b"blob",
           "enabled": True, "created_by": UID,
           "created_at": datetime.now(timezone.utc),
           "updated_at": datetime.now(timezone.utc)}
    row.update(over)
    return row


class FakeConn:
    """Canned responses keyed by the SQL the routes actually issue."""

    def __init__(self, *, channel=_MISSING, alarm=True, team=True, rule=True):
        self.channel = _channel_row() if channel is _MISSING else channel
        self.alarm = alarm
        self.team = team
        self.rule = rule
        self.audit = []
        self.executed = []
        self.fetchrow_sql = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        if "audit_log" in sql:
            self.audit.append(args)
        return "UPDATE 1" if "UPDATE" in sql else "OK"

    async def fetch(self, sql, *args):
        if "secrets_enc FROM notification_channels" in sql:  # wds_system-only read
            self.sealed_reads = getattr(self, "sealed_reads", 0) + 1
            return ([{"id": self.channel["id"], "secrets_enc": self.channel["secrets_enc"]}]
                    if self.channel else [])
        return []

    async def fetchval(self, sql, *args):
        if "count(*) FROM notification_channels" in sql:
            return 0
        if "FROM notification_channels" in sql:
            return 1
        if "FROM teams" in sql:
            return 1 if self.team else None
        if "FROM memberships" in sql:
            return 1
        if "FROM alarm_rules" in sql:
            return 1 if self.rule else None
        if "FROM alarms" in sql and "SELECT 1" in sql:
            return 1 if self.alarm else None
        if "shelved_until FROM alarms" in sql:
            return datetime.now(timezone.utc) + timedelta(minutes=10)
        if "ack_tokens" in sql and "RETURNING" in sql:
            return args[0]           # jti — token consumed
        if "notification_channels" in sql and "type='email'" in sql:
            return None
        if "DELETE" in sql and "RETURNING" in sql:
            return args[0]
        return None

    async def fetchrow(self, sql, *args):
        self.fetchrow_sql.append(sql)
        if "notification_channels" in sql and "SELECT" in sql:
            return self.channel
        if "notification_channels" in sql and "INSERT" in sql:
            return self.channel
        if "alarm_rules" in sql and "notify_" in sql:
            return {"notify_channel_ids": [], "notify_team_ids": [],
                    "notify_oncall_team": None, "notify_min_severity": "info",
                    "notify_on_clear": False}
        return None


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class FakeAuth:
    def __init__(self, p):
        self.p = p

    async def authenticate(self, token):
        if self.p is None:
            raise AuthError("bad token")
        return self.p


class FakeLimiter:
    async def allow(self, key):
        return True

    async def retry_after(self, key):
        return 0.0


class FakeAlarms:
    def __init__(self):
        self.acked = []

    async def ack(self, tc, alarm_id, user_id, actor, site_id=None):
        self.acked.append((alarm_id, user_id))
        return {"id": str(alarm_id), "state": "acked"}


def _principal(role="admin", org=ORG):
    return Principal(user="tester", role="admin", kind="dev", sub="tester",
                     user_id=UID, org_roles=((org, role),))


def _app(p=_MISSING, conn=None, alarms=None):
    if p is _MISSING:
        p = _principal()
    app = FastAPI()

    @app.exception_handler(AuthError)
    async def _auth(_: Request, exc: AuthError):
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    @app.exception_handler(ForbiddenError)
    async def _forbid(_: Request, exc: ForbiddenError):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    app.include_router(notify.router)
    conn = conn or FakeConn()
    app.state.st = SimpleNamespace(
        auth=FakeAuth(p), pools=SimpleNamespace(app=FakePool(conn),
                                                system=FakePool(conn)),
        alarms=alarms or FakeAlarms(), mutation_limiter=FakeLimiter())
    return TestClient(app, raise_server_exceptions=True)


H = {"Authorization": "Bearer dev"}


# ------------------------------------------------------------- channel CRUD
def test_create_channel_never_returns_secrets():
    conn = FakeConn()
    c = _app(conn=conn)
    r = c.post(f"/api/v1/orgs/{ORG}/notification-channels", headers=H, json={
        "name": "Ops hook", "type": "webhook",
        "secrets": {"url": "https://hooks.example.com/secretpath", "secret": "s"}})
    assert r.status_code == 201, r.text
    body = r.json()["channel"]
    assert body["has_secrets"] is True
    assert "secretpath" not in r.text and '"secret"' not in r.text
    assert any("INSERT INTO notification_channels" in s for s in conn.fetchrow_sql)
    assert conn.audit and conn.audit[0][2] == "notify.channel.created"


def test_create_channel_validates_type_and_config():
    c = _app()
    r = c.post(f"/api/v1/orgs/{ORG}/notification-channels", headers=H,
               json={"name": "x", "type": "pagerduty"})
    assert r.status_code == 422
    r = c.post(f"/api/v1/orgs/{ORG}/notification-channels", headers=H,
               json={"name": "x", "type": "webhook", "secrets": {"url": "nope"}})
    assert r.status_code == 422


def test_create_channel_viewer_forbidden_nonmember_404():
    assert _app(_principal("viewer")).post(
        f"/api/v1/orgs/{ORG}/notification-channels", headers=H,
        json={"name": "x", "type": "email", "config": {"to": ["a@b.c"]}}).status_code == 403
    p = Principal(user="x", role="none", kind="dev", user_id=uuid.uuid4(), org_roles=())
    assert _app(p).post(f"/api/v1/orgs/{ORG}/notification-channels", headers=H,
                        json={"name": "x", "type": "email",
                              "config": {"to": ["a@b.c"]}}).status_code == 404


def test_list_channels_is_redacted():
    r = _app().get(f"/api/v1/orgs/{ORG}/notification-channels", headers=H)
    assert r.status_code == 200 and r.json()["items"] == []


def test_test_send_failure_is_generic_502(monkeypatch):
    async def boom(ch, subject, text):
        raise RuntimeError("smtp://user:pw@evil.example refused")
    monkeypatch.setattr(notify, "send_channel", boom)
    r = _app().post(
        f"/api/v1/orgs/{ORG}/notification-channels/{CHANNEL}/test", headers=H,
        json={"text": "hi"})
    assert r.status_code == 502 and r.json()["detail"] == "send_failed"
    assert "evil.example" not in r.text and "pw" not in r.text


def test_test_send_success_records_delivery(monkeypatch):
    async def ok(ch, subject, text):
        return "hooks.example.com"
    monkeypatch.setattr(notify, "send_channel", ok)
    conn = FakeConn()
    r = _app(conn=conn).post(
        f"/api/v1/orgs/{ORG}/notification-channels/{CHANNEL}/test", headers=H,
        json={"text": "hi"})
    assert r.status_code == 200 and r.json()["status"] == "sent"
    assert any("notification_deliveries" in s and "test" in args
               for s, args in conn.executed)


def test_deliveries_list():
    r = _app().get(
        f"/api/v1/orgs/{ORG}/notification-deliveries", headers=H)
    assert r.status_code == 200 and "items" in r.json()


# ----------------------------------------------------------------- rule notify
def test_rule_notify_roundtrip():
    conn = FakeConn()
    c = _app(conn=conn)
    r = c.put(f"/api/v1/orgs/{ORG}/alarm-rules/{RULE}/notify", headers=H, json={
        "channel_ids": [str(CHANNEL)], "team_ids": [str(TEAM)],
        "min_severity": "critical", "on_clear": True})
    assert r.status_code == 200, r.text
    assert any("notify_channel_ids" in s for s, _ in conn.executed)
    assert any("pg_notify" in s for s, _ in conn.executed)
    g = c.get(f"/api/v1/orgs/{ORG}/alarm-rules/{RULE}/notify", headers=H)
    assert g.status_code == 200 and g.json()["notify"]["min_severity"] == "info"


def test_rule_notify_unknown_rule_404():
    r = _app(conn=FakeConn(rule=False)).put(
        f"/api/v1/orgs/{ORG}/alarm-rules/{RULE}/notify", headers=H,
        json={"channel_ids": []})
    assert r.status_code == 404


# -------------------------------------------------------------------- ack link
def test_ack_link_issue_and_consume():
    conn = FakeConn()
    alarms = FakeAlarms()
    c = _app(conn=conn, alarms=alarms)
    r = c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/ack-link", headers=H, json={})
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert url.startswith("/api/v1/ack/v1.")
    assert any("INSERT INTO ack_tokens" in s for s, _ in conn.executed)
    # consume: token row marked used + engine ack called
    r2 = c.post(url, headers=H)
    assert r2.status_code == 200, r2.text
    assert r2.json()["alarm"]["state"] == "acked"
    assert alarms.acked and alarms.acked[0][0] == ALARM and alarms.acked[0][1] == UID


def test_ack_token_requires_auth():
    """Expired session -> 401 auth_required (client signs in, retries link)."""
    c = _app(p=None)                      # FakeAuth raises on authenticate
    exp = int(time.time()) + 3600
    tok = notify.make_ack_token(ORG, ALARM, uuid.uuid4(), exp)
    r = c.post(f"/api/v1/ack/{tok}")
    assert r.status_code == 401 and r.json()["detail"] == "auth_required"


def test_ack_token_garbage_404():
    assert _app().post("/api/v1/ack/not-a-token", headers=H).status_code == 404


def test_ack_token_viewer_403():
    exp = int(time.time()) + 3600
    tok = notify.make_ack_token(ORG, ALARM, uuid.uuid4(), exp)
    r = _app(_principal("viewer")).post(f"/api/v1/ack/{tok}", headers=H)
    assert r.status_code == 403


# ------------------------------------------------------------------ lifecycle
def test_shelve_unshelve_comment_assign():
    conn = FakeConn()
    c = _app(conn=conn)
    r = c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/shelve", headers=H,
               json={"minutes": 60, "reason": "maintenance"})
    assert r.status_code == 200 and "shelved_until" in r.json()
    r = c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/unshelve", headers=H)
    assert r.status_code == 200
    r = c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/comments", headers=H,
               json={"body": "investigating"})
    assert r.status_code == 201
    r = c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/assign", headers=H,
               json={"user_id": str(UID)})
    assert r.status_code == 200
    kinds = [re.search(r"VALUES \(\$1,\$2,'(\w+)'", s).group(1)
             for s, _ in conn.executed if "alarm_events" in s]
    assert {"shelve", "unshelve", "comment", "assign"} <= set(kinds)
    actions = {a[2] for a in conn.audit}
    assert {"alarm.shelved", "alarm.unshelved", "alarm.commented",
            "alarm.assigned"} <= actions


def test_lifecycle_viewer_forbidden():
    r = _app(_principal("viewer")).post(
        f"/api/v1/orgs/{ORG}/alarms/{ALARM}/comments", headers=H,
        json={"body": "x"})
    assert r.status_code == 403


def test_shelve_bounds():
    c = _app()
    assert c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/shelve", headers=H,
                  json={"minutes": 0}).status_code == 422
    assert c.post(f"/api/v1/orgs/{ORG}/alarms/{ALARM}/shelve", headers=H,
                  json={"minutes": 99999999}).status_code == 422


def test_alarm_events_listing():
    assert _app().get(
        f"/api/v1/orgs/{ORG}/alarms/{ALARM}/events", headers=H).status_code == 200


# --------------------------------------------------------------------- on-call
def test_oncall_rotation_and_override():
    conn = FakeConn()
    c = _app(conn=conn)
    r = c.put(f"/api/v1/orgs/{ORG}/teams/{TEAM}/oncall", headers=H,
              json={"user_ids": [str(UID)]})
    assert r.status_code == 200
    now = datetime.now(timezone.utc)
    r = c.post(f"/api/v1/orgs/{ORG}/teams/{TEAM}/oncall/overrides", headers=H,
               json={"user_id": str(UID),
                     "starts_at": now.isoformat(),
                     "ends_at": (now + timedelta(hours=2)).isoformat()})
    assert r.status_code == 201, r.text
    r = c.delete(
        f"/api/v1/orgs/{ORG}/teams/{TEAM}/oncall/overrides/{uuid.uuid4()}",
        headers=H)
    assert r.status_code == 204
    assert c.get(f"/api/v1/orgs/{ORG}/oncall", headers=H).status_code == 200


def test_override_window_validated():
    now = datetime.now(timezone.utc)
    r = _app().post(f"/api/v1/orgs/{ORG}/teams/{TEAM}/oncall/overrides",
                    headers=H, json={"user_id": str(UID),
                                     "starts_at": now.isoformat(),
                                     "ends_at": (now - timedelta(hours=1)).isoformat()})
    assert r.status_code == 422


# ------------------------------------------------------------------ escalation
def test_escalation_policy_crud():
    conn = FakeConn()
    # policy create reads RETURNING * — give the fake a row
    conn.channel = _channel_row()
    c = _app(conn=conn)

    class PC(FakeConn):
        async def fetchrow(self, sql, *args):
            if "escalation_policies" in sql and "INSERT" in sql:
                return {"id": uuid.uuid4(), "name": "esc", "rule_id": None,
                        "levels": [{"after_minutes": 5, "channel_ids": [],
                                    "team_ids": [], "oncall_team": None}],
                        "enabled": True,
                        "created_at": datetime.now(timezone.utc)}
            return await super().fetchrow(sql, *args)

    c = _app(conn=PC())
    r = c.post(f"/api/v1/orgs/{ORG}/escalation-policies", headers=H, json={
        "name": "esc", "levels": [{"after_minutes": 5, "channel_ids": [str(CHANNEL)]}]})
    assert r.status_code == 201, r.text
    assert r.json()["policy"]["levels"][0]["after_minutes"] == 5
    r = _app().post(f"/api/v1/orgs/{ORG}/escalation-policies", headers=H, json={
        "name": "x", "levels": [{"after_minutes": 30}, {"after_minutes": 5}]})
    assert r.status_code == 422


# -------------------------------------------------------------- alarm quality
def test_alarm_quality_endpoint_shape():
    r = _app().get(f"/api/v1/orgs/{ORG}/alarm-quality", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("alarms_per_hour", "alarms_per_operator_hour", "peak_10m",
              "standing", "unacked", "hourly", "rules", "top10_share"):
        assert k in body
    assert len(body["hourly"]) == 24


# ------------------------------------------------------------------ worker fns
def test_dedup_semantics():
    """_dedup returns True when the row already exists (INSERT..DO NOTHING)."""

    class C(FakeConn):
        def __init__(self, exists):
            super().__init__()
            self.exists = exists

        async def fetchval(self, sql, *args):
            if "alarm_notify_state" in sql:
                return None if self.exists else 1
            return await super().fetchval(sql, *args)

    import asyncio
    from app.db.context import TenantConn
    tc = TenantConn(conn=C(False), org_id=ORG)
    assert asyncio.run(notify._dedup(tc, "ep", CHANNEL, "raised")) is False
    tc2 = TenantConn(conn=C(True), org_id=ORG)
    assert asyncio.run(notify._dedup(tc2, "ep", CHANNEL, "raised")) is True
