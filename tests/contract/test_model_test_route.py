"""Offline HTTP contract for POST .../vision/models/{m}/versions/{v}/test
(plan M1-05 Task 4). Real router + real _v2_org permission check; the DB is a
fake connection keyed by the SQL the route actually issues; request_op is a
fake command channel that records the payload.
"""

from __future__ import annotations

import base64
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")
cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.auth import Principal  # noqa: E402
from app.security import AuthError, ForbiddenError  # noqa: E402
from app.vision import models as models_mod  # noqa: E402

ORG = uuid.uuid4()
OTHER_ORG = uuid.uuid4()
SITE = uuid.uuid4()
EDGE = uuid.uuid4()
MODEL = uuid.uuid4()
VID = uuid.uuid4()
UID = uuid.uuid4()
SHA = "b" * 64

MODEL_ROW = {"id": MODEL, "org_id": ORG, "name": "belt", "task": "detect"}
VERSION_ROW = {"id": VID, "model_id": MODEL, "status": "draft", "sha256": SHA,
               "size_bytes": 1234, "imgsz": 640, "stride": 32,
               "classes": ["person", "bus"], "class_config": {}}
def _edge_row():
    # fresh heartbeat per test — last_hb_at ages past EDGE_STALE_AFTER_S during the suite
    return {"id": EDGE, "site_id": SITE, "status": "active",
            "last_hb_at": datetime.now(timezone.utc)}


EDGE_ROW = _edge_row()
_MISSING = object()


def _jpeg() -> bytes:
    ok, buf = cv2.imencode(".jpg", np.zeros((60, 80, 3), np.uint8))
    assert ok
    return buf.tobytes()


class FakeConn:
    """Canned fetchrow by SQL subject; everything else is a recorded no-op."""

    def __init__(self, model_row=MODEL_ROW, version_row=VERSION_ROW, edge_row=_MISSING):
        self.model_row, self.version_row = model_row, version_row
        self.edge_row = _edge_row() if edge_row is _MISSING else edge_row
        self.audit = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def execute(self, sql, *args):
        if "audit_log" in sql:                       # INSERT INTO audit_log(...)
            self.audit.append(args)
        return "OK"

    async def fetch(self, sql, *args):
        return []

    async def fetchval(self, sql, *args):
        return None

    async def fetchrow(self, sql, *args):
        if "vision_model_versions" in sql:
            v = self.version_row
            return v if v is not None and v["model_id"] == args[1] else None
        if "vision_models" in sql:
            return self.model_row
        if "FROM edges" in sql:
            return self.edge_row if self.edge_row and self.edge_row["id"] == args[0] else None
        return None


class FakePool:
    def __init__(self, conn: FakeConn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class FakeAuth:
    def __init__(self, p: Principal):
        self.p = p

    async def authenticate(self, token):
        return self.p


class FakeLimiter:
    async def allow(self, key):
        return True

    async def retry_after(self, key):
        return 0.0


class FakeCommands:
    def __init__(self, result=None, exc: Exception | None = None):
        self.result = result or {"ms": 7.5, "engine": "CPUExecutionProvider",
                                 "detections": [{"class_id": 0, "class": "person", "score": 0.9,
                                                 "bbox": [0.1, 0.1, 0.3, 0.3]}]}
        self.exc = exc
        self.calls = []

    async def request_op(self, org_id, site_id, edge_id, op, payload, timeout_s=10.0):
        self.calls.append({"org_id": org_id, "site_id": site_id, "edge_id": edge_id,
                           "op": op, "payload": payload, "timeout_s": timeout_s})
        if self.exc is not None:
            raise self.exc
        return self.result


def _principal(role="admin", org=ORG) -> Principal:
    return Principal(user="tester", role="admin", kind="dev", sub="tester",
                     user_id=UID, org_roles=((org, role),))


def _app(p: Principal, conn: FakeConn, commands: FakeCommands) -> TestClient:
    app = FastAPI()

    @app.exception_handler(AuthError)
    async def _auth(_: Request, exc: AuthError):
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    @app.exception_handler(ForbiddenError)
    async def _forbid(_: Request, exc: ForbiddenError):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    app.include_router(models_mod.router)
    app.state.st = SimpleNamespace(
        auth=FakeAuth(p), pools=SimpleNamespace(app=FakePool(conn)),
        commands=commands, mutation_limiter=FakeLimiter())
    return TestClient(app, raise_server_exceptions=True)


def _url(m=MODEL, v=VID, edge=EDGE) -> str:
    return f"/api/v1/orgs/{ORG}/vision/models/{m}/versions/{v}/test?edge={edge}"


def _post(c: TestClient, url=None, **kw):
    return c.post(url or _url(), content=_jpeg(),
                  headers={"Content-Type": "image/jpeg"}, **kw)


# ------------------------------------------------------------------ happy path
@pytest.mark.parametrize("status", ["draft", "active"])
def test_draft_and_active_version_run_on_edge(status):
    conn = FakeConn(version_row={**VERSION_ROW, "status": status})
    cmds = FakeCommands()
    c = _app(_principal(), conn, cmds)
    r = _post(c)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ms"] == 7.5 and body["engine"] == "CPUExecutionProvider"
    assert body["detections"][0]["class_id"] == 0
    call = cmds.calls[0]
    assert call["op"] == "model_test" and call["edge_id"] == EDGE
    mb = call["payload"]["model"]
    assert mb["version_id"] == str(VID) and mb["sha256"] == SHA
    # server-built signed URL — never anything the client sent
    assert mb["url"].startswith(f"{config.EDGE_MEDIA_BASE_URL}/api/v1/edge-models/{VID}")
    assert "sig=" in mb["url"] and f"edge={EDGE}" in mb["url"]
    assert base64.b64decode(call["payload"]["image_b64"]) == _jpeg()
    assert call["timeout_s"] == 10
    # audit: action + target ids + outcome code, never image bytes or URLs
    assert conn.audit and conn.audit[0][2] == "vision.model.tested"
    detail = str(conn.audit[0][3]) + str(conn.audit[0][4])
    assert SHA not in detail and "http" not in detail


# ------------------------------------------------------------------ edge state
def test_offline_edge_409_and_no_command():
    conn = FakeConn(edge_row={**_edge_row(), "status": "disabled"})
    cmds = FakeCommands()
    r = _post(_app(_principal(), conn, cmds))
    assert r.status_code == 409 and r.json()["detail"] == "edge_offline"
    assert cmds.calls == []


def test_stale_edge_409():
    stale = datetime(2020, 1, 1, tzinfo=timezone.utc)
    conn = FakeConn(edge_row={**_edge_row(), "last_hb_at": stale})
    r = _post(_app(_principal(), conn, FakeCommands()))
    assert r.status_code == 409 and r.json()["detail"] == "edge_offline"


def test_edge_from_another_scope_404():
    conn = FakeConn(edge_row=None)                     # fake DB: no such edge in this org
    r = _post(_app(_principal(), conn, FakeCommands()))
    assert r.status_code == 404


# ------------------------------------------------------------------ image bounds
def test_non_image_422():
    conn, cmds = FakeConn(), FakeCommands()
    c = _app(_principal(), conn, cmds)
    r = c.post(_url(), content=b"PK\x03\x04" + b"x" * 100,
               headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 422 and r.json()["detail"] == "invalid_image"
    assert cmds.calls == []


def test_declared_too_large_413():
    c = _app(_principal(), FakeConn(), FakeCommands())
    r = c.post(_url(), content=b"ab",
               headers={"Content-Type": "image/jpeg", "Content-Length": "20000000"})
    assert r.status_code == 413


def test_chunked_body_over_cap_413():
    c = _app(_principal(), FakeConn(), FakeCommands())

    def gen():
        yield _jpeg()
        yield b"\xff\xd8\xff" + b"0" * (6 * 1024 * 1024)   # pushes total over 5 MiB

    r = c.post(_url(), content=gen(),
               headers={"Content-Type": "image/jpeg", "Transfer-Encoding": "chunked"})
    assert r.status_code == 413


# ------------------------------------------------------------------ op failures
def test_edge_timeout_504():
    conn, cmds = FakeConn(), FakeCommands(exc=TimeoutError("command timeout"))
    r = _post(_app(_principal(), conn, cmds))
    assert r.status_code == 504 and r.json()["detail"] == "edge_timeout"
    assert conn.audit and conn.audit[0][4]["outcome"] == "edge_timeout"


def test_failed_reason_never_leaks_urls_502():
    leaky = RuntimeError("failed:download http://user:pw@evil.example/x.onnx timed out")
    conn = FakeConn()
    r = _post(_app(_principal(), conn, FakeCommands(exc=leaky)))
    assert r.status_code == 502 and r.json()["detail"] == "edge_op_failed"
    assert "evil.example" not in r.text and "user:pw" not in r.text
    assert conn.audit[0][4]["outcome"] == "edge_op_failed"
    assert "evil.example" not in str(conn.audit)


def test_invalid_image_reason_422():
    r = _post(_app(_principal(), FakeConn(),
                   FakeCommands(exc=RuntimeError("failed:invalid_image"))))
    assert r.status_code == 422 and r.json()["detail"] == "invalid_image"


# ------------------------------------------------------------------ state gates
def test_archived_version_not_testable():
    conn = FakeConn(version_row={**VERSION_ROW, "status": "archived"})
    r = _post(_app(_principal(), conn, FakeCommands()))
    assert r.status_code == 409


def test_version_without_classes_not_testable():
    conn = FakeConn(version_row={**VERSION_ROW, "classes": []})
    r = _post(_app(_principal(), conn, FakeCommands()))
    assert r.status_code == 409


def test_version_of_another_model_404():
    conn = FakeConn(version_row={**VERSION_ROW, "model_id": uuid.uuid4()})
    r = _post(_app(_principal(), conn, FakeCommands()))
    assert r.status_code == 404


def test_viewer_forbidden():
    r = _post(_app(_principal("viewer"), FakeConn(), FakeCommands()))
    assert r.status_code == 403


def test_nonmember_404():
    p = Principal(user="x", role="none", kind="dev", user_id=uuid.uuid4(), org_roles=())
    r = _post(_app(p, FakeConn(), FakeCommands()))
    assert r.status_code == 404
