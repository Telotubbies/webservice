"""Offline HTTP contract for backend/app/orgapi.py — usage, site create
(402 plan cap), leave, soft-delete/restore, exports, webhook CRUD. Real
router + real main._v2_org / require_user; the DB is a fake connection
keyed by the SQL each route issues.
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

from app.auth import Principal  # noqa: E402
from app.security import AuthError, ForbiddenError  # noqa: E402
from app import orgapi  # noqa: E402

ORG = uuid.uuid4()
UID = uuid.uuid4()
SITE = uuid.uuid4()
EP = uuid.uuid4()
SESS = uuid.uuid4()
EXP = uuid.uuid4()

PLAN_ROW = {
    "plan": "trial", "trial_ends_at": None, "suspended_at": None,
    "suspended_reason": None, "plan_limits": {},
    "trial_days": 14, "max_sites": 1, "max_edges": 1, "max_tags": 100,
    "max_users": 5, "max_cameras": 1, "max_vision_models": 1,
    "retention_days": 7, "gpu_hours_monthly": 2, "sso": False,
    "audit_export": False, "sms": False, "assistant": False,
    "api_rate_per_min": 60,
}

ENDPOINT_ROW = {
    "id": EP, "org_id": ORG, "url": "https://hook.example/x",
    "events": ["alarm_raised"], "enabled": True,
    "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc),
}


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
        if "FROM organizations" in sql and "plans p" in sql:
            return self._k("plan_row", dict(PLAN_ROW))
        if "FROM organizations" in sql:
            return self._k("org_row", {"deleted_at": self._k("deleted_at")})
        if "FROM memberships" in sql:
            return self._k("member_row", {"role": self._k("role", "owner")})
        if "FROM support_sessions" in sql:
            return None
        if "webhook_endpoints" in sql and "RETURNING" in sql:
            return ENDPOINT_ROW
        if "FROM webhook_endpoints" in sql:
            return {"id": EP}
        if "INSERT INTO org_exports" in sql or "FROM org_exports" in sql:
            return self._k("export_row", {
                "id": EXP, "status": "queued", "size_bytes": None,
                "created_at": datetime.now(timezone.utc), "ready_at": None,
                "expires_at": None, "file_path": None})
        return None

    async def fetchval(self, sql, *args):
        if "count(*) FROM sites" in sql:
            return self._k("n_sites", 0)
        if "count(*) FROM edges" in sql:
            return 0
        if "count(*) FROM tags" in sql:
            return 0
        if "FROM memberships m JOIN users" in sql or "FROM invites" in sql:
            return self._k("n_users", 1)
        if "count(*) FROM memberships WHERE role='owner'" in sql:
            return self._k("n_owners", 2)
        if "count(*) FROM webhook_endpoints" in sql:
            return 0
        if "inference_usage" in sql:
            return 0
        if "RETURNING id" in sql:
            return uuid.uuid4()
        return 0

    async def fetch(self, sql, *args):
        if "FROM organizations o" in sql and "JOIN memberships" in sql:
            return self._k("my_orgs", [])
        if "FROM org_feature_flags" in sql:
            return []
        if "FROM announcements" in sql:
            return []
        if "FROM support_sessions" in sql:
            return self._k("sessions", [{
                "id": SESS, "reason": "dbg", "read_only": True,
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
                "revoked_at": None, "display_name": "staff", "sub": "staff"}])
        if "FROM webhook_endpoints" in sql:
            return [ENDPOINT_ROW]
        if "FROM webhook_deliveries" in sql:
            return []
        if "FROM org_exports" in sql:
            return [self._k("export_row", {
                "id": EXP, "status": "queued", "size_bytes": None,
                "created_at": datetime.now(timezone.utc), "ready_at": None,
                "expires_at": None, "file_path": None})]
        return []

    async def execute(self, sql, *args):
        if "audit_log" in sql:
            self.audit.append(args)
            return "INSERT 0 1"
        if "UPDATE organizations SET deleted_at=now()" in sql:
            return "UPDATE 0" if self._k("already_deleted") else "UPDATE 1"
        return "UPDATE 1"

    async def executemany(self, sql, args):
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
        return self.p

    def forget(self, sub):
        return None


class FakeLimiter:
    async def allow(self, key):
        return True


def _principal(role="owner") -> Principal:
    return Principal(user="tester", role="admin", kind="dev", sub="tester",
                     user_id=UID, org_roles=((ORG, role),))


def _app(conn, role="owner") -> TestClient:
    app = FastAPI()

    @app.exception_handler(AuthError)
    async def _a(_: Request, exc: AuthError):
        return JSONResponse(status_code=401, content={"detail": exc.detail})

    @app.exception_handler(ForbiddenError)
    async def _f(_: Request, exc: ForbiddenError):
        return JSONResponse(status_code=403, content={"detail": exc.detail})

    app.include_router(orgapi.router)
    p = _principal(role)
    app.state.st = SimpleNamespace(
        auth=FakeAuth(p), pools=SimpleNamespace(app=FakePool(conn)),
        mutation_limiter=FakeLimiter())
    return TestClient(app, raise_server_exceptions=True)


AUTH = {"Authorization": "Bearer dev"}


# ------------------------------------------------------------------- usage
def test_usage_returns_caps_and_usage():
    c = _app(FakeConn())
    r = c.get(f"/api/v1/orgs/{ORG}/usage", headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"] == "trial"
    assert body["usage"]["max_sites"]["cap"] == 1
    assert body["features"]["retention_days"] == 7


def test_usage_404_for_nonmember():
    c = _app(FakeConn(), role="viewer")
    other = uuid.uuid4()
    r = c.get(f"/api/v1/orgs/{other}/usage", headers=AUTH)
    assert r.status_code == 404


# ------------------------------------------------------------------- sites
def test_create_site_201_under_cap():
    conn = FakeConn(n_sites=0)
    c = _app(conn)
    r = c.post(f"/api/v1/orgs/{ORG}/sites", headers=AUTH,
               json={"name": "Line 2", "code": "line2"})
    assert r.status_code == 201, r.text
    assert r.json()["site"]["code"] == "line2"


def test_create_site_402_at_cap():
    c = _app(FakeConn(n_sites=1))
    r = c.post(f"/api/v1/orgs/{ORG}/sites", headers=AUTH,
               json={"name": "Line 2", "code": "line2"})
    assert r.status_code == 402, r.text
    d = r.json()["detail"]
    assert d["error"] == "plan_limit" and d["limit"] == "max_sites"
    assert d["usage"] == 1 and d["cap"] == 1


def test_create_site_403_for_viewer():
    c = _app(FakeConn(), role="viewer")
    r = c.post(f"/api/v1/orgs/{ORG}/sites", headers=AUTH,
               json={"name": "x", "code": "x"})
    assert r.status_code == 403


# ------------------------------------------------------------------- leave
def test_leave_member_ok():
    conn = FakeConn(role="viewer")
    c = _app(conn, role="viewer")
    r = c.post(f"/api/v1/orgs/{ORG}/leave", headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["left"] is True


def test_leave_last_owner_409():
    conn = FakeConn(role="owner", n_owners=1)
    c = _app(conn, role="owner")
    r = c.post(f"/api/v1/orgs/{ORG}/leave", headers=AUTH)
    assert r.status_code == 409, r.text


# ------------------------------------------------------------- delete/restore
def test_delete_org_soft_200():
    conn = FakeConn()
    c = _app(conn)
    r = c.delete(f"/api/v1/orgs/{ORG}", headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True and r.json()["purge_at"]


def test_delete_org_owner_only():
    c = _app(FakeConn(), role="admin")
    r = c.delete(f"/api/v1/orgs/{ORG}", headers=AUTH)
    assert r.status_code == 403


def test_restore_deleted_org_200():
    conn = FakeConn(org_row={"deleted_at": datetime.now(timezone.utc)})
    c = _app(conn)
    r = c.post(f"/api/v1/orgs/{ORG}/restore", headers=AUTH)
    assert r.status_code == 200, r.text


def test_restore_live_org_404():
    c = _app(FakeConn(org_row={"deleted_at": None}))
    r = c.post(f"/api/v1/orgs/{ORG}/restore", headers=AUTH)
    assert r.status_code == 404


# ------------------------------------------------------------------ exports
def test_request_export_202():
    conn = FakeConn()
    c = _app(conn)
    r = c.post(f"/api/v1/orgs/{ORG}/export", headers=AUTH)
    assert r.status_code == 202, r.text
    assert r.json()["export"]["status"] == "queued"


def test_export_owner_only():
    c = _app(FakeConn(), role="admin")
    r = c.post(f"/api/v1/orgs/{ORG}/export", headers=AUTH)
    assert r.status_code == 403


# ------------------------------------------------------------------ webhooks
def test_webhook_create_returns_secret_once():
    conn = FakeConn()
    c = _app(conn)
    r = c.post(f"/api/v1/orgs/{ORG}/webhooks", headers=AUTH,
               json={"url": "https://hook.example/x",
                     "events": ["alarm_raised"]})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["secret"] and len(body["secret"]) == 64
    assert body["webhook"]["url"] == "https://hook.example/x"


def test_webhook_create_rejects_bad_event():
    c = _app(FakeConn())
    r = c.post(f"/api/v1/orgs/{ORG}/webhooks", headers=AUTH,
               json={"url": "https://hook.example/x", "events": ["bogus"]})
    assert r.status_code == 422


def test_webhook_list_hides_secret():
    c = _app(FakeConn())
    r = c.get(f"/api/v1/orgs/{ORG}/webhooks", headers=AUTH)
    assert r.status_code == 200
    item = r.json()["items"][0]
    assert "secret" not in item and "secret_enc" not in item


# --------------------------------------------------------- support sessions
def test_support_sessions_owner_only():
    c = _app(FakeConn(), role="admin")
    assert c.get(f"/api/v1/orgs/{ORG}/support-sessions", headers=AUTH).status_code == 403


def test_support_sessions_owner_lists():
    c = _app(FakeConn())
    r = c.get(f"/api/v1/orgs/{ORG}/support-sessions", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["items"][0]["admin"] == "staff"
