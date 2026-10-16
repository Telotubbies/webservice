"""Offline contract for backend/app/orgguard.py — suspended orgs refuse
member writes (403 org_suspended) while reads pass; deleted orgs 404 except
/restore. The flag map comes from a fake conn; TTL is bypassed by calling
the coroutine directly per test.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import orgguard  # noqa: E402

ORG = uuid.uuid4()
OTHER = uuid.uuid4()


class FakeConn:
    def __init__(self, deleted=False, suspended=False):
        self.rows = [{
            "id": ORG,
            "deleted_at": datetime.now(timezone.utc) if deleted else None,
            "suspended_at": datetime.now(timezone.utc) if suspended else None,
        }]

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def fetch(self, sql, *args):
        return self.rows

    async def execute(self, sql, *args):
        return "OK"


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _app(conn) -> TestClient:
    app = FastAPI()
    app.add_middleware(orgguard.OrgGuardMiddleware)

    @app.get("/api/v1/orgs/{org}/things")
    async def _get(org: str):
        return {"ok": True}

    @app.post("/api/v1/orgs/{org}/things")
    async def _post(org: str):
        return {"ok": True}

    @app.post("/api/v1/orgs/{org}/leave")
    async def _leave(org: str):
        return {"ok": True}

    @app.post("/api/v1/orgs/{org}/restore")
    async def _restore(org: str):
        return {"ok": True}

    app.state.st = SimpleNamespace(pools=SimpleNamespace(system=FakePool(conn)))
    orgguard.forget()                                  # fresh flag map
    return TestClient(app, raise_server_exceptions=True)


def test_suspended_org_read_passes_write_403s():
    c = _app(FakeConn(suspended=True))
    assert c.get(f"/api/v1/orgs/{ORG}/things").status_code == 200
    r = c.post(f"/api/v1/orgs/{ORG}/things")
    assert r.status_code == 403 and r.json()["detail"] == "org_suspended"


def test_suspended_org_still_allows_leave():
    c = _app(FakeConn(suspended=True))
    assert c.post(f"/api/v1/orgs/{ORG}/leave").status_code == 200


def test_deleted_org_404s_but_restore_passes():
    c = _app(FakeConn(deleted=True))
    assert c.get(f"/api/v1/orgs/{ORG}/things").status_code == 404
    assert c.post(f"/api/v1/orgs/{ORG}/restore").status_code == 200


def test_live_org_unaffected():
    c = _app(FakeConn())
    assert c.get(f"/api/v1/orgs/{ORG}/things").status_code == 200
    assert c.post(f"/api/v1/orgs/{ORG}/things").status_code == 200


def test_unknown_org_unaffected():
    c = _app(FakeConn())
    assert c.get(f"/api/v1/orgs/{OTHER}/things").status_code == 200
