"""JWT forgery + Keycloak admin helpers for the live security sweep.

Nothing here touches the realm's private keys: forged tokens are signed
with keys generated IN THE TEST (wrong key), with the realm's PUBLIC key
misused as an HMAC secret (classic RS256->HS256 confusion), or left
unsigned (alg=none). Claim-level checks (expired / wrong-aud) get REAL
Keycloak-signed tokens minted through short-lived admin-API mutations —
the token is genuine, its claims are wrong.

KC admin calls go to the loopback admin API (KC_URL, port 8080 — the web
origin does not proxy /admin/). The admin password is the mounted secret
infra/secrets/kc_admin_pw, same file the backend's seed_oidc reads.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
KC_URL = os.environ.get("KC_URL", "http://localhost:8080")
KC_REALM = os.environ.get("KC_REALM", "wds")


def _http(method: str, url: str, *, token: str = "", data=None,
          form: dict | None = None, timeout: float = 8.0):
    body = None
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def decode_payload(token: str) -> dict:
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


def decode_header(token: str) -> dict:
    part = token.split(".")[0]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


# ------------------------------------------------------------------ realm JWKS

def realm_jwks() -> dict:
    """The wds realm's published JWKS (public material only)."""
    return _http("GET", f"{KC_URL}/realms/{KC_REALM}"
                        f"/protocol/openid-connect/certs")


def realm_signing_key() -> tuple[str, str]:
    """(kid, PEM public key) of the realm's active RS256 signing key."""
    import jwt as pyjwt
    from cryptography.hazmat.primitives import serialization
    jwks = realm_jwks()
    for jwk in jwks["keys"]:
        if jwk.get("kty") == "RSA" and jwk.get("use", "sig") == "sig":
            pem = pyjwt.PyJWK(jwk).key.public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo).decode()
            return jwk["kid"], pem
    raise RuntimeError("no RSA signing key in realm JWKS")


# ------------------------------------------------------------------- forgeries

def alg_none_token(iss: str, aud: str) -> str:
    """Well-formed unsigned JWT — the verifier's fixed RS256 allowlist must
    reject it even though the claims are correct."""
    now = int(time.time())
    head = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = _b64(json.dumps({"iss": iss, "aud": aud, "sub": "attacker",
                            "sid": "s1", "exp": now + 300, "iat": now}).encode())
    return f"{head}.{body}."


def hs256_confusion_token(iss: str, aud: str, kid: str, pub_pem: str) -> str:
    """RS256->HS256 confusion: sign with the realm's PUBLIC key as an HMAC
    secret. Only a verifier that derives the algorithm from the token's own
    header falls for this — ours pins RS256."""
    now = int(time.time())
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": kid}).encode())
    body = _b64(json.dumps({"iss": iss, "aud": aud, "sub": "attacker",
                            "sid": "s1", "exp": now + 300, "iat": now}).encode())
    sig = hmac.new(pub_pem.encode(), f"{head}.{body}".encode(),
                   hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(sig)}"


def rs256_wrong_key_token(iss: str, aud: str, kid: str) -> str:
    """RS256-signed by a test-generated key, stamped with the realm's real
    kid — signature verification must fail."""
    import jwt as pyjwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    return pyjwt.encode(
        {"iss": iss, "aud": aud, "sub": "attacker", "sid": "s1",
         "exp": now + 300, "iat": now}, key, algorithm="RS256",
        headers={"kid": kid})


def tampered_token(real: str) -> str:
    """A REAL token with the payload swapped (sub -> attacker) and the
    original signature kept — must fail signature verification."""
    head, body, sig = real.split(".")
    claims = decode_payload(real)
    claims["sub"] = "attacker"
    claims.setdefault("realm_access", {})["roles"] = ["admin"]
    return f"{head}.{_b64(json.dumps(claims).encode())}.{sig}"


# ------------------------------------------------------------------ KC admin

def kc_admin_token() -> str:
    """Master-realm admin token (also doubles as a wrong-iss token for the
    bypass matrix: iss=…/realms/master, signed by a different realm key)."""
    try:
        pw = (REPO / "infra" / "secrets" / "kc_admin_pw").read_text().strip()
    except OSError:
        return ""
    try:
        d = _http("POST",
                  f"{KC_URL}/realms/master/protocol/openid-connect/token",
                  form={"grant_type": "password", "client_id": "admin-cli",
                        "username": "admin", "password": pw})
        return d.get("access_token", "")
    except Exception:  # noqa: BLE001
        return ""


def kc_client_id(admin: str, client_id: str) -> str:
    rows = _http("GET", f"{KC_URL}/admin/realms/{KC_REALM}/clients"
                        f"?clientId={client_id}", token=admin)
    return rows[0]["id"] if rows else ""


def kc_get_client(admin: str, cid: str) -> dict:
    return _http("GET", f"{KC_URL}/admin/realms/{KC_REALM}/clients/{cid}",
                 token=admin)


def kc_put_client(admin: str, cid: str, rep: dict) -> None:
    _http("PUT", f"{KC_URL}/admin/realms/{KC_REALM}/clients/{cid}",
          token=admin, data=rep)


def kc_create_client(admin: str, rep: dict) -> str:
    """Create a client; returns its internal id."""
    req = urllib.request.Request(
        f"{KC_URL}/admin/realms/{KC_REALM}/clients",
        data=json.dumps(rep).encode(), method="POST",
        headers={"Authorization": f"Bearer {admin}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        loc = r.headers.get("Location", "")
    return loc.rstrip("/").rsplit("/", 1)[-1]


def kc_delete_client(admin: str, cid: str) -> None:
    _http("DELETE", f"{KC_URL}/admin/realms/{KC_REALM}/clients/{cid}",
          token=admin)


def password_token(client_id: str, username: str,
                   password: str | None = None) -> str:
    """Password grant against the wds realm for an arbitrary client."""
    from conftest import KC_DEMO_PASSWORD
    try:
        d = _http("POST",
                  f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect/token",
                  form={"grant_type": "password", "client_id": client_id,
                        "username": username,
                        "password": password or KC_DEMO_PASSWORD})
        return d.get("access_token", "")
    except Exception:  # noqa: BLE001
        return ""


def fresh_probe_id(prefix: str = "wds-probe") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"
