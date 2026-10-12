"""OIDC live integration — v4 T5 (ADR-12).

Requires the full compose stack (`make up-test`) AND `make seed-dev` —
the realm users' passwords + org memberships are provisioned by seed_oidc.

Revocation tests also need WDS_TEST_APP_DSN (the test overlay publishes
Postgres on 127.0.0.1:5433): they write revoked_sessions and fire the
wds_authz NOTIFY exactly like the back-channel logout endpoint does.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.slow]

from conftest import (
    KC_DEMO_PASSWORD, TAGS, kc_password_token, wait_until,
)  # noqa: E402

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")


def _payload(token: str) -> dict:
    """Decode a JWT payload WITHOUT verifying — introspection only."""
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


@pytest.fixture()
def op_token() -> str:
    # function-scoped: KC access tokens live 300 s — a module token could
    # expire mid-suite on a slow run
    token = kc_password_token("operator@demo")
    if not token:
        pytest.skip("keycloak realm not reachable / demo user not "
                    "provisioned (run `make seed-dev`)")
    return token


@pytest.fixture()
def view_token() -> str:
    token = kc_password_token("viewer@demo")
    if not token:
        pytest.skip("viewer@demo not provisioned (run `make seed-dev`)")
    return token


@pytest.fixture(scope="module")
def db():
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set — revocation tests need the "
                    "test-overlay Postgres (make up-test)")
    asyncpg = pytest.importorskip("asyncpg")
    return asyncpg


async def _revoke(dsn: str, *, sid: str | None = None, sub: str | None = None,
                  etype: str = "session_revoked") -> None:
    """The same write+NOTIFY the back-channel logout endpoint performs."""
    import asyncpg
    conn = await asyncpg.connect(dsn)
    try:
        async with conn.transaction():
            if sid:
                await conn.execute(
                    "INSERT INTO revoked_sessions(sid) VALUES ($1)"
                    " ON CONFLICT (sid) DO NOTHING", sid)
            await conn.execute(
                "SELECT pg_notify('wds_authz', $1)",
                json.dumps({"type": etype, "sid": sid, "sub": sub}))
    finally:
        await conn.close()


# ------------------------------------------------------------- token shape

def test_realm_issues_wds_api_tokens(op_token):
    claims = _payload(op_token)
    assert claims["iss"].endswith("/realms/wds"), claims["iss"]
    aud = claims.get("aud")
    assert "wds-api" in (aud if isinstance(aud, list) else [aud])
    assert claims.get("sub")
    assert claims.get("sid"), "access token must carry a session id"
    assert claims.get("exp") and claims.get("iat")


def test_oidc_token_reads_api(api, op_token):
    h = {"Authorization": f"Bearer {op_token}"}
    r = api.get("/api/me", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "oidc"
    # memberships table is authoritative — operator@demo maps to operator
    assert body["role"] == "operator", body
    assert api.get("/api/tags", headers=h).status_code == 200


def test_oidc_viewer_cannot_command(api, view_token):
    h = {"Authorization": f"Bearer {view_token}"}
    r = api.post("/api/commands", headers=h,
                 json={"tag": TAGS["running"], "value": True, "ttl_s": 5})
    assert r.status_code == 403
    # viewer IS a member — reads pass
    assert api.get("/api/tags", headers=h).status_code == 200


def test_oidc_token_commands_lifecycle(api, op_token):
    h = {"Authorization": f"Bearer {op_token}"}
    r = api.post("/api/commands", headers=h,
                 json={"tag": TAGS["speed_sp"], "value": 30.0, "ttl_s": 10})
    assert r.status_code == 201, r.text


# ------------------------------------------------------- revocation (≤5 s)

def _fresh_op_token() -> str:
    """Fresh password-grant session — each grant carries a NEW sid, so
    revocation tests can't poison the shared module token."""
    token = kc_password_token("operator@demo")
    if not token:
        pytest.skip("operator@demo not provisioned (run `make seed-dev`)")
    return token


def test_revoked_sid_rest_401(api, db):
    """revoked_sessions + wds_authz NOTIFY -> the next REST call 401s within
    the 5 s SLA even though the JWT itself is still valid."""
    token = _fresh_op_token()
    sid = _payload(token)["sid"]

    async def go():
        await _revoke(APP_DSN, sid=sid)
    asyncio.run(go())

    h = {"Authorization": f"Bearer {token}"}
    def rejected():
        r = api.get("/api/me", headers=h)
        return r.status_code == 401 or None
    wait_until(rejected, 5.0, interval_s=0.25,
               desc="REST 401 after sid revocation")


def test_revoked_sid_ws_closes_4401(ws_base, db):
    """A connected WS bound to the revoked sid is evicted 4401 by the
    NOTIFY listener — not at some later reconnect."""
    websockets = pytest.importorskip("websockets")
    token = _fresh_op_token()
    sid = _payload(token)["sid"]

    async def go():
        try:
            async with websockets.connect(f"{ws_base}/ws",
                                          open_timeout=10) as ws:
                await ws.send(json.dumps(
                    {"type": "auth", "token": token}))
                # confirm the socket is live (health event arrives first)
                first = json.loads(await asyncio.wait_for(ws.recv(), 10))
                assert first.get("type") == "health", first
                await _revoke(APP_DSN, sid=sid)
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=8)
        except Exception as e:
            return getattr(getattr(e, "rcvd", None), "code", None) or \
                getattr(e, "code", None)
        return None

    code = asyncio.run(go())
    assert code == 4401, f"revoked session should close WS 4401, got {code}"


def test_revoked_sid_ws_closes_by_sweep_without_notify(ws_base, db):
    """Missed-NOTIFY backstop (v4 T14, ADR-12 §7): a revoked_sessions row
    written WITHOUT the wds_authz NOTIFY — exactly what happens when the
    LISTEN connection is mid-reconnect — is still caught: the periodic
    revalidation sweep closes the bound socket 4401 within the sweep
    interval (AUTHZ_SWEEP_S, default 5 s)."""
    websockets = pytest.importorskip("websockets")
    token = _fresh_op_token()
    sid = _payload(token)["sid"]

    async def go():
        import asyncpg
        t0 = None
        try:
            async with websockets.connect(f"{ws_base}/ws",
                                          open_timeout=10) as ws:
                await ws.send(json.dumps(
                    {"type": "auth", "token": token}))
                first = json.loads(await asyncio.wait_for(ws.recv(), 10))
                assert first.get("type") == "health", first
                conn = await asyncpg.connect(APP_DSN)
                try:
                    # INSERT ONLY — deliberately no pg_notify: this is the
                    # hole the sweep exists to close
                    await conn.execute(
                        "INSERT INTO revoked_sessions(sid) VALUES ($1)"
                        " ON CONFLICT (sid) DO NOTHING", sid)
                finally:
                    await conn.close()
                t0 = time.monotonic()
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=15)
        except Exception as e:
            code = getattr(getattr(e, "rcvd", None), "code", None) or \
                getattr(e, "code", None)
            return code, (time.monotonic() - t0) if t0 is not None else None
        return None, None

    code, elapsed = asyncio.run(go())
    assert code == 4401, f"sweep should close revoked WS 4401, got {code}"
    assert elapsed is None or elapsed < 15, \
        f"sweep close took {elapsed:.1f}s — expected within the sweep interval"


def test_disabled_user_rest_401(api, db):
    """users.disabled_at set -> wds_authz 'user_disabled' drops the authz
    cache and the next call 401s (≤5 s)."""
    token = kc_password_token("viewer@demo")
    if not token:
        pytest.skip("viewer@demo not provisioned")
    sub = _payload(token)["sub"]

    async def go():
        import asyncpg
        conn = await asyncpg.connect(APP_DSN)
        try:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE users SET disabled_at=now() WHERE sub=$1", sub)
                await conn.execute(
                    "SELECT pg_notify('wds_authz', $1)",
                    json.dumps({"type": "user_disabled", "sub": sub}))
        finally:
            await conn.close()
    asyncio.run(go())

    h = {"Authorization": f"Bearer {token}"}
    def rejected():
        return api.get("/api/me", headers=h).status_code == 401 or None
    try:
        wait_until(rejected, 5.0, interval_s=0.25,
                   desc="REST 401 after user disabled")
    finally:
        async def restore():
            import asyncpg
            conn = await asyncpg.connect(APP_DSN)
            try:
                async with conn.transaction():
                    await conn.execute(
                        "UPDATE users SET disabled_at=NULL WHERE sub=$1", sub)
                    await conn.execute(
                        "SELECT pg_notify('wds_authz', $1)",
                        json.dumps({"type": "membership_changed", "sub": sub}))
            finally:
                await conn.close()
        asyncio.run(restore())


def test_backchannel_logout_endpoint_rejects_garbage(api):
    """Unauthenticated IdP-facing endpoint — a bad logout_token -> 401."""
    r = api.post("/api/auth/backchannel-logout",
                 data={"logout_token": "garbage"})
    assert r.status_code == 401
    r = api.post("/api/auth/backchannel-logout", json={})
    assert r.status_code == 401
