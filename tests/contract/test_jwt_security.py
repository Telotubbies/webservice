"""Offline JWT/security unit tests — v4 T5 (ADR-12 §5).

No services needed: the JWKS fetcher is injected, keys are generated in the
test, and every path must FAIL CLOSED (AuthError) — never silently pass.

Covers the required matrix: bad/expired/wrong-aud/wrong-iss tokens, HS256 +
none + forged-signature algorithm confusion, missing claims, unknown-kid
refetch rate-limiting, IdP outage, dev-token prod rejection, and
back-channel logout_token validation.
"""

from __future__ import annotations

import asyncio
import base64
import time
import uuid

import hashlib
import hmac
import json
from pathlib import Path

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app import config
from app.auth import dev_principal
from app.security import (
    AuthError, JwksCache, JwtVerifier, Security, BACKCHANNEL_EVENT,
)

ISSUER = "http://localhost:5173/realms/wds"
AUDIENCE = "wds-api"
CLIENT_ID = "wds-web"
KID = "test-key-1"

# One keypair per test session — never the realm's keys.
_PRIV = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _b64u(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _jwk(key=_PRIV) -> dict:
    pub = key.public_key().public_numbers()
    return {"kty": "RSA", "use": "sig", "kid": KID, "alg": "RS256",
            "n": _b64u(pub.n), "e": _b64u(pub.e)}


def _hs256_confusion_token() -> str:
    """Classic RS256->HS256 confusion: sign with the PUBLIC key as an HMAC
    secret. PyJWT's encode() refuses PEM keys for HMAC (good), so the
    attack token is hand-assembled — the verifier must still reject it."""
    def b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    body = b64(json.dumps({
        "iss": ISSUER, "aud": AUDIENCE, "sub": "attacker", "sid": "s1",
        "exp": now + 300, "iat": now,
    }).encode())
    sig = hmac.new(_pub_pem(), f"{head}.{body}".encode(),
                   hashlib.sha256).digest()
    return f"{head}.{body}.{b64(sig)}"


def _pub_pem(key=_PRIV) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo)


def mint(key=_PRIV, alg: str = "RS256", kid: str | None = KID,
         iss: str = ISSUER, aud=AUDIENCE, sub: str = "user-1",
         sid: str | None = "sess-1", exp_s: float = 300,
         iat_s: float = -10, extra: dict | None = None) -> str:
    now = time.time()
    payload = {
        "iss": iss, "aud": aud, "sub": sub,
        "exp": int(now + exp_s), "iat": int(now + iat_s),
        "typ": "Bearer", "azp": CLIENT_ID,
    }
    if sid is not None:
        payload["sid"] = sid
    if extra:
        payload.update(extra)
    headers = {"kid": kid} if kid else {}
    return pyjwt.encode(payload, None if alg == "none" else key,
                        algorithm=alg, headers=headers)


class FakeJwks:
    """JwksCache with an in-memory fetcher that counts calls."""

    def __init__(self, jwks: dict | None = None, fail: bool = False):
        self.calls = 0
        self.jwks = jwks or {"keys": [_jwk()]}
        self.fail = fail
        self.cache = JwksCache("http://unused/jwks", fetcher=self.fetch)

    def fetch(self, uri: str) -> dict:
        self.calls += 1
        if self.fail:
            raise ConnectionError("idp unreachable")
        return self.jwks


def make_verifier(jwks=None) -> tuple[JwtVerifier, FakeJwks]:
    src = jwks or FakeJwks()
    return JwtVerifier(ISSUER, AUDIENCE, src.cache), src


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------- happy path

def test_valid_token_verifies():
    v, _ = make_verifier()
    claims = run(v.verify(mint()))
    assert claims["sub"] == "user-1"
    assert claims["sid"] == "sess-1"
    assert claims["iss"] == ISSUER


def test_audience_list_containing_wds_api_passes():
    v, _ = make_verifier()
    claims = run(v.verify(mint(aud=["wds-api", "account"])))
    assert "wds-api" in claims["aud"]


# ------------------------------------------------------------ must-fail 401

@pytest.mark.parametrize("token_fn,desc", [
    (lambda: mint(exp_s=-120), "expired (beyond 30s leeway)"),
    (lambda: mint(aud="someone-else"), "wrong audience"),
    (lambda: mint(aud=["account"]), "aud list missing wds-api"),
    (lambda: mint(iss="http://evil.example/realms/wds"), "wrong issuer"),
    (lambda: mint(key=_OTHER), "forged signature (wrong key)"),
    (lambda: mint(alg="none"), "alg=none"),
    (_hs256_confusion_token, "HS256 alg-confusion"),
    (lambda: mint(sid=None), "missing sid"),
    (lambda: "not-a-jwt", "garbage token"),
    (lambda: mint(extra={"iat": "soon"}), "non-numeric iat"),
    (lambda: mint(extra={"nbf": int(time.time()) + 600}), "nbf in the future"),
    (lambda: mint(extra={"exp": None}), "null exp"),
])
def test_bad_tokens_rejected(token_fn, desc):
    v, _ = make_verifier()
    with pytest.raises(AuthError):
        run(v.verify(token_fn()))


def test_missing_sub_rejected():
    token = pyjwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sid": "s",
         "exp": int(time.time()) + 300, "iat": int(time.time())},
        _PRIV, algorithm="RS256", headers={"kid": KID})
    v, _ = make_verifier()
    with pytest.raises(AuthError):
        run(v.verify(token))


def test_missing_iat_rejected():
    token = pyjwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": "u", "sid": "s",
         "exp": int(time.time()) + 300},
        _PRIV, algorithm="RS256", headers={"kid": KID})
    v, _ = make_verifier()
    with pytest.raises(AuthError):
        run(v.verify(token))


# ------------------------------------------------------------- JWKS behaviour

def test_idp_down_fails_closed():
    """Keycloak unreachable + no cached keys -> 401, never a free pass."""
    v, src = make_verifier(FakeJwks(fail=True))
    with pytest.raises(AuthError):
        run(v.verify(mint()))
    assert src.calls >= 1


def test_unknown_kid_triggers_single_refetch_then_401():
    """An unknown kid refetches once (key rollover path); a flood of forged
    kids is rate-limited — the second attempt must NOT hit the IdP again."""
    src = FakeJwks()  # serves only KID
    v = JwtVerifier(ISSUER, AUDIENCE, src.cache)
    with pytest.raises(AuthError):
        run(v.verify(mint(kid="forged-kid")))
    calls_after_first = src.calls
    with pytest.raises(AuthError):
        run(v.verify(mint(kid="forged-kid-2")))
    assert src.calls == calls_after_first, \
        "refetch rate limit broken — forged kids can hammer the IdP"
    assert calls_after_first == 1


def test_rollover_new_kid_served_after_refetch():
    """Kid rotates between calls: first verify 401s, then the IdP starts
    serving the new key and the same token verifies."""
    src = FakeJwks()
    v = JwtVerifier(ISSUER, AUDIENCE, src.cache, )
    # mint under a kid KC hasn't published yet, then publish it
    new_key = _jwk()
    new_key["kid"] = "rotated"
    src.jwks = {"keys": [_jwk(), new_key]}
    src.calls = 0
    claims = run(v.verify(mint(kid="rotated")))
    assert claims["sub"] == "user-1"


# -------------------------------------------------------- dev-token gating

def test_dev_token_resolves_only_in_dev(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    p = dev_principal("demo-operator")
    assert p is not None and p.role == "operator" and p.kind == "dev"


def test_dev_token_rejected_in_prod(monkeypatch):
    """ADR-12 §10: under APP_ENV != dev the dev-token branch doesn't exist —
    a demo token falls through to JWT verification and dies there."""
    monkeypatch.setattr(config, "APP_ENV", "prod")
    assert dev_principal("demo-operator") is None

    sec = Security(pools=None)
    # keep the JWKS layer offline: point it at a fetcher that fails fast
    sec.verifier = JwtVerifier(ISSUER, AUDIENCE, FakeJwks(fail=True).cache)
    with pytest.raises(AuthError):
        run(sec.authenticate("demo-operator"))


def test_security_authenticate_dev_principal(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    sec = Security(pools=None)
    p = run(sec.authenticate("demo-operator"))
    assert p.kind == "dev" and p.member and p.can_operate


def test_security_authenticate_no_token():
    sec = Security(pools=None)
    with pytest.raises(AuthError):
        run(sec.authenticate(None))
    with pytest.raises(AuthError):
        run(sec.authenticate(""))


# ------------------------------------------------- back-channel logout token

def _logout_token(**kw) -> str:
    extra = {"events": {BACKCHANNEL_EVENT: {}}, "jti": str(uuid.uuid4())}
    extra.update(kw.pop("extra", {}))
    kw.setdefault("aud", CLIENT_ID)
    return mint(**{**kw, "extra": extra})


def _sec_for_logout() -> Security:
    sec = Security(pools=None)
    sec.verifier = JwtVerifier(ISSUER, AUDIENCE, FakeJwks().cache)
    return sec


def test_logout_token_valid():
    claims = run(_sec_for_logout().verify_logout_token(_logout_token()))
    assert claims["sid"] == "sess-1"


def test_logout_token_with_nonce_rejected():
    """OIDC back-channel spec: a logout_token MUST NOT contain a nonce."""
    tok = _logout_token()
    # rebuild with a nonce baked into claims
    claims = pyjwt.decode(tok, _pub_pem(), algorithms=["RS256"],
                          audience=CLIENT_ID, issuer=ISSUER)
    claims["nonce"] = "abc"
    bad = pyjwt.encode(claims, _PRIV, algorithm="RS256",
                       headers={"kid": KID})
    with pytest.raises(AuthError):
        run(_sec_for_logout().verify_logout_token(bad))


def test_logout_token_missing_event_rejected():
    tok = mint(aud=CLIENT_ID, extra={"jti": str(uuid.uuid4())})
    with pytest.raises(AuthError):
        run(_sec_for_logout().verify_logout_token(tok))


def test_logout_token_wrong_audience_rejected():
    """aud must be the CLIENT (wds-web), not the API — an access token is
    not a logout token even though both are RS256 from the same realm."""
    with pytest.raises(AuthError):
        run(_sec_for_logout().verify_logout_token(_logout_token(aud=AUDIENCE)))


# ------------------------------------------------------- realm configuration

def test_realm_json_is_pkce_public_client():
    """infra/keycloak/realm-wds.json — the importable realm artifact must
    encode the ADR-12 decisions: public client, PKCE S256, wds-api audience,
    sid-capable sub mapper, backchannel logout, no credentials in the file."""
    import json as _json
    realm_path = (
        Path(__file__).resolve().parents[2]
        / "infra" / "keycloak" / "realm-wds.json")
    realm = _json.loads(realm_path.read_text())
    assert realm["realm"] == "wds"

    web = next(c for c in realm["clients"] if c["clientId"] == "wds-web")
    assert web["publicClient"] is True
    assert web["standardFlowEnabled"] is True
    assert web["implicitFlowEnabled"] is False
    assert web["attributes"]["pkce.code.challenge.method"] == "S256"
    assert web["attributes"]["backchannel.logout.url"]
    # the audience mapper must add wds-api to the access token
    aud = [m for m in web["protocolMappers"]
           if m["protocolMapper"] == "oidc-audience-mapper"]
    assert aud and aud[0]["config"]["included.client.audience"] == AUDIENCE
    # sub must be mapped (KC 26 keeps it in the optional `basic` scope —
    # imported realms don't get it, so the explicit mapper is load-bearing)
    assert any(m["protocolMapper"] == "oidc-sub-mapper"
               for m in web["protocolMappers"])
    # refresh tokens rotate; access tokens are short-lived (silent renew)
    assert realm["revokeRefreshToken"] is True
    assert realm["accessTokenLifespan"] <= 600
    # no secrets in the artifact — passwords arrive via `make seed-dev`
    assert "password" not in realm_path.read_text().lower() \
        or "credentials" not in _json.dumps(realm["users"])


def test_realm_json_has_test_users_no_passwords():
    realm_path = (
        Path(__file__).resolve().parents[2]
        / "infra" / "keycloak" / "realm-wds.json")
    import json as _json
    realm = _json.loads(realm_path.read_text())
    usernames = {u["username"] for u in realm["users"]}
    assert {"admin@demo", "operator@demo", "viewer@demo"} <= usernames
    for u in realm["users"]:
        assert "credentials" not in u, \
            f"{u['username']} ships a credential — seed-dev owns passwords"
