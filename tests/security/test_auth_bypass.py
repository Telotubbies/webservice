"""OWASP API2 (broken authentication) — live auth-bypass sweep (v4 T13).

Every credential attack must produce REST 401 / WS close 4401. Where a
check can only be exercised by a correctly-signed token (expired,
wrong-aud) the suite mints a REAL Keycloak token through a short-lived
admin-API mutation instead of hand-forging — the signature is genuine,
the claim is wrong, and the live verifier's claim path is what rejects it.

Requires BASE_URL + KC_URL (`make test-security`). The slow expired-token
case temporarily shortens wds-web's access-token lifespan via the admin
API and restores it in finally.
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import OPERATOR_TOKEN, kc_password_token  # noqa: E402
from security import forge  # noqa: E402

LEEWAY_S = 30.0  # mirrors backend/app/security.py


def _ws_close(base_url, token, wait_s=8):
    """/ws auth frame carrying `token` -> close code (None if left open)."""
    websockets = pytest.importorskip("websockets")

    async def go():
        url = base_url.replace("http", "ws") + "/ws"
        try:
            async with websockets.connect(url, open_timeout=10) as ws:
                await ws.send(json.dumps({"type": "auth", "token": token}))
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=wait_s)
        except Exception as e:  # closed
            return getattr(getattr(e, "rcvd", None), "code", None) or \
                getattr(e, "code", None)
        return None

    return asyncio.run(go())


def _assert_rest_401(client, token, label):
    r = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401, f"{label}: REST -> {r.status_code} {r.text[:120]}"


# ---------------------------------------------------------- token fixtures

@pytest.fixture(scope="module")
def real_token() -> str:
    t = kc_password_token("operator@demo")
    if not t:
        pytest.skip("keycloak realm not reachable / demo user not provisioned")
    return t


@pytest.fixture(scope="module")
def realm_key() -> tuple[str, str]:
    try:
        return forge.realm_signing_key()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"realm JWKS unreachable: {e}")


@pytest.fixture(scope="module")
def claims(real_token) -> dict:
    return forge.decode_payload(real_token)


@pytest.fixture(scope="module")
def kc_admin() -> str:
    t = forge.kc_admin_token()
    if not t:
        pytest.skip("KC admin unreachable (infra/secrets/kc_admin_pw?)")
    return t


# ------------------------------------------------------------ trivial cases

def test_missing_token_401_rest(anon_api):
    assert anon_api.get("/api/me").status_code == 401
    assert anon_api.get("/api/tags").status_code == 401
    assert anon_api.get("/api/v1/me").status_code == 401


def test_missing_token_4401_ws(base_url):
    assert _ws_close(base_url, "") == 4401


@pytest.mark.parametrize("label,token_fn", [
    ("garbage string", lambda c, k: "not-a-jwt"),
    ("truncated jwt", lambda c, k: "e30.e30"),
    ("alg=none", lambda c, k: forge.alg_none_token(c["iss"], "wds-api")),
    ("HS256 confusion", lambda c, k: forge.hs256_confusion_token(
        c["iss"], "wds-api", k[0], k[1])),
    ("RS256 wrong key / real kid", lambda c, k: forge.rs256_wrong_key_token(
        c["iss"], "wds-api", k[0])),
    ("tampered payload", lambda c, k: forge.tampered_token(c["_raw"])),
    ("wrong iss (master realm)", lambda c, k: c["_master"]),
    ("dev token where JWT expected", lambda c, k: "demo-not-a-user"),
])
def test_bad_token_rejected(anon_api, base_url, claims, realm_key, real_token,
                            kc_admin, label, token_fn):
    """Each forgery -> REST 401 AND WS 4401. `claims` carries the real
    token's iss; `_raw`/`_master` are stashed extras."""
    ctx = dict(claims)
    ctx["_raw"] = real_token
    ctx["_master"] = kc_admin  # master-realm token: wrong iss AND wrong keys
    tok = token_fn(ctx, realm_key)
    _assert_rest_401(anon_api, tok, label)
    code = _ws_close(base_url, tok)
    assert code == 4401, f"{label}: WS close {code}, expected 4401"


def test_bare_scheme_header(anon_api):
    """`Authorization: Bearer` with no credential (httpx cannot emit the
    trailing-space 'Bearer ' form) → rejected. Empty WS auth token → 4401
    is already covered by test_missing_token_4401_ws."""
    r = anon_api.get("/api/me", headers={"Authorization": "Bearer"})
    assert r.status_code in (401, 403), r.status_code


def test_url_token_param_is_inert_rest(anon_api, real_token):
    """?token= must not authenticate on REST either — bearer only."""
    assert anon_api.get(f"/api/me?token={real_token}").status_code == 401
    assert anon_api.get(f"/api/tags?token={real_token}").status_code == 401


# ------------------------------------------------- REAL wrong-claim tokens

def test_wrong_audience_real_signature(anon_api, base_url, kc_admin):
    """A realm-signed token whose aud lacks wds-api — minted via a
    throwaway client that has no wds-api audience mapper (deleting it
    afterwards). This exercises the live aud check, not just signature."""
    cid_name = forge.fresh_probe_id()
    cid = forge.kc_create_client(kc_admin, {
        "clientId": cid_name, "enabled": True, "publicClient": True,
        "directAccessGrantsEnabled": True, "standardFlowEnabled": False,
        "implicitFlowEnabled": False, "serviceAccountsEnabled": False})
    assert cid, "probe client not created"
    try:
        tok = forge.password_token(cid_name, "operator@demo")
        assert tok, "password grant on probe client failed"
        aud = forge.decode_payload(tok).get("aud")
        auds = aud if isinstance(aud, list) else [aud]
        assert "wds-api" not in auds, f"probe token unexpectedly has aud {aud}"
        _assert_rest_401(anon_api, tok, "wrong-aud")
        code = _ws_close(base_url, tok)
        assert code == 4401, f"wrong-aud WS close {code}, expected 4401"
    finally:
        forge.kc_delete_client(kc_admin, cid)


@pytest.mark.slow
def test_expired_real_token_rejected(anon_api, base_url, kc_admin):
    """A realm-signed token that is genuinely past exp (+30 s leeway).

    Shortens wds-web's access.token.lifespan to 3 s via the admin API,
    mints, proves it works, waits it out, proves REST 401 + WS 4401, then
    restores the client config in finally. ~35 s — marked slow."""
    cid = forge.kc_client_id(kc_admin, "wds-web")
    assert cid, "wds-web client not found via admin API"
    rep = forge.kc_get_client(kc_admin, cid)
    orig = (rep.get("attributes") or {}).get("access.token.lifespan")
    rep.setdefault("attributes", {})["access.token.lifespan"] = "3"
    forge.kc_put_client(kc_admin, cid, rep)
    try:
        tok = forge.password_token("wds-web", "operator@demo")
        assert tok, "password grant failed under shortened lifespan"
        claims = forge.decode_payload(tok)
        assert 0 < claims["exp"] - claims["iat"] <= 5, claims["exp"] - claims["iat"]
        # valid right now — proves the reject below is the exp check
        r = anon_api.get("/api/me",
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        deadline = claims["exp"] + LEEWAY_S + 2 - time.time()
        if deadline > 0:
            time.sleep(deadline)
        _assert_rest_401(anon_api, tok, "expired")
        code = _ws_close(base_url, tok)
        assert code == 4401, f"expired WS close {code}, expected 4401"
    finally:
        # the admin token (60 s lifespan) may have expired during the ~35 s wait;
        # mint a fresh one or the restore fails and leaves wds-web at 3 s lifespans
        kc_admin = forge.kc_admin_token() or kc_admin
        rep = forge.kc_get_client(kc_admin, cid)
        # Keycloak MERGES attributes on PUT, so omitting the key leaves the 3 s
        # override in place; an empty string is what clears it.
        rep.setdefault("attributes", {})["access.token.lifespan"] = orig or ""
        forge.kc_put_client(kc_admin, cid, rep)


# --------------------------------------------------------------- env gating

def test_dev_tokens_absent_in_prod(anon_api, base_url):
    """Dev bearer tokens resolve ONLY under APP_ENV=dev (ADR-12 §10). On a
    prod stack this asserts 401; on the dev test stack it asserts the
    dev path is what we think it is (env advertised honestly)."""
    cfg = anon_api.get("/api/auth/config")
    assert cfg.status_code == 200
    env = cfg.json()["env"]
    if env == "prod":
        r = anon_api.get("/api/me",
                         headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"})
        assert r.status_code == 401, f"demo token accepted under APP_ENV=prod"
        assert _ws_close(base_url, OPERATOR_TOKEN) == 4401
    else:
        # dev stack: config must honestly advertise the dev-token path,
        # and a REAL dev token resolves (sanity that we are on the dev path)
        assert cfg.json()["dev_tokens"] is True
        r = anon_api.get("/api/me",
                         headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"})
        assert r.status_code == 200, r.text
        pytest.skip("dev stack — prod-mode dev-token rejection is gated "
                    "on APP_ENV=prod (covered offline in "
                    "contract/test_jwt_security.py)")
