"""Offline HTTP contract for backend/app/tenancy/platform.py — the /api/v1/platform
back-office gate (platform_admins) + suspend/support-session/health paths.
Fake-DB pattern per test_model_test_route.py.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.iam.auth import Principal
from app.iam.security import AuthError, ForbiddenError
from app.tenancy import platform as platform_mod

ORG = uuid.uuid4()
UID = uuid.uuid4()
SESS = uuid.uuid4()


class FakeConn:
    def __init__(self, **kw):
        self.kw = kw
        self.audit = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    def _k(self, name, default=None):
        return self.kw.get(name, default)

    async def fetchrow(self, sql, *args):
        if "FROM platform_admins" in sql:
            return {"user_id": UID} if self._k("is_admin", True) else None
        if "support_sessions" in sql and "RETURNING" in sql:
            return {"id": SESS, "org_id": ORG, "reason": "dbg",
                    "read_only": True, "created_at": datetime.now(timezone.utc),
                    "expires_at": datetime.now(timezone.utc) + timedelta(minutes=30),
                    "revoked_at": None}
        if "FROM organizations" in sql:
            return self._k("org_row", {
                "id": ORG, "name": "Acme", "slug": "acme", "plan": "trial",
                "plan_limits": {}, "timezone": "UTC",
                "created_at": datetime.now(timezone.utc),
                "trial_ends_at": None, "suspended_at": None,
                "suspended_reason": None, "deleted_at": None})
        if "FROM jobs" in sql:
            return {"pending": 0, "running": 0, "dead": 0, "done_last_hour": 0}
        if "notification_deliveries" in sql:
            return {"sent": 3, "failed": 0, "retrying": 0, "suppressed": 0}
        if "FROM edges" in sql:
            return {"active": 1, "pending": 0, "disabled": 0, "online": 1,
                    "last_hb_at": datetime.now(timezone.utc)}
        return None

    async def fetchval(self, sql, *args):
        if "to_regclass" in sql:
            return self._k("has_deliveries", True)
        if "count(*)" in sql.lower() or "SELECT 1 FROM organizations" in sql:
            return 1
        if "FROM plans" in sql or "FROM organizations" in sql:
            return None
        if "FROM sites" in sql or "FROM edges" in sql or "FROM tags" in sql \
                or "memberships m JOIN users" in sql or "FROM invites" in sql \
                or "FROM cameras" in sql or "FROM vision_models" in sql \
                or "inference_usage" in sql or "FROM audit_log" in sql:
            return 0
        return 0

    async def fetch(self, sql, *args):
        if "FROM organizations" in sql:
            return self._k("orgs", [])
        if "FROM support_sessions" in sql:
            return []
        if "FROM announcements" in sql:
            return []
        if "FROM memberships" in sql or "FROM org_feature_flags" in sql:
            return []
        return []

    async def execute(self, sql, *args):
        if "audit_log" in sql:
            self.audit.append(args)
            return "INSERT 0 1"
        return "UPDATE 1"


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
        return self.p

    def forget(self, sub):
        return None


def _app(conn, pools_system=None) -> TestClient:
    app = FastAPI()

    @app.exception_handler(AuthError)
    async def _a(_: Request, exc: AuthError):
        return JSONResponse(status_code=401, content={"detail": exc.detail})

    @app.exception_handler(ForbiddenError)
    async def _f(_: Request, exc: ForbiddenError):
        return JSONResponse(status_code=403, content={"detail": exc.detail})

    app.include_router(platform_mod.router)
    p = Principal(user="staff", role="admin", kind="dev", sub="staff",
                  user_id=UID, org_roles=())
    pool = FakePool(conn)
    app.state.st = SimpleNamespace(
        auth=FakeAuth(p), pools=SimpleNamespace(app=pool, system=pool),
        counters={}, mqtt=SimpleNamespace(connected=True))
    return TestClient(app, raise_server_exceptions=True)


AUTH = {"Authorization": "Bearer dev"}


def test_orgs_list_403_for_non_admin():
    c = _app(FakeConn(is_admin=False))
    assert c.get("/api/v1/platform/orgs", headers=AUTH).status_code == 403


def test_orgs_list_200_for_admin():
    c = _app(FakeConn(is_admin=True))
    r = c.get("/api/v1/platform/orgs", headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


def test_suspend_200_and_audited():
    conn = FakeConn()
    c = _app(conn)
    r = c.post(f"/api/v1/platform/orgs/{ORG}/suspend", headers=AUTH,
               json={"reason": "billing"})
    assert r.status_code == 200, r.text
    assert conn.audit and "platform.org_suspended" == conn.audit[0][2]


def test_unsuspend_not_suspended_409():
    conn = FakeConn()

    class NoRow(FakeConn):
        async def execute(self, sql, *args):
            if "UPDATE organizations SET suspended_at=NULL" in sql:
                return "UPDATE 0"
            return await super().execute(sql, *args)

    c = _app(NoRow())
    r = c.post(f"/api/v1/platform/orgs/{ORG}/unsuspend", headers=AUTH)
    assert r.status_code == 409


def test_issue_support_session_201():
    conn = FakeConn()
    c = _app(conn)
    r = c.post(f"/api/v1/platform/orgs/{ORG}/support-sessions", headers=AUTH,
               json={"reason": "customer asked", "minutes": 30})
    assert r.status_code == 201, r.text
    assert r.json()["session"]["read_only"] is True
    assert "platform.support_session_started" == conn.audit[0][2]


def test_health_shape():
    c = _app(FakeConn())
    r = c.get("/api/v1/platform/health", headers=AUTH)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["mqtt_connected"] is True
    assert b["jobs"] == {"pending": 0, "running": 0, "dead": 0, "done_last_hour": 0}
    assert b["notification_deliveries_1h"]["sent"] == 3
    assert "orgs" in b and "support_sessions_active" in b
