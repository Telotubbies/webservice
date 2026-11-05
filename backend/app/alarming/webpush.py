"""Web Push without a third-party client: RFC 8291 (aes128gcm payload
encryption) + RFC 8292 (VAPID), on top of `cryptography`.

The payload never carries process values: only a short "new alarm in <area>"
line and a link. The real data is loaded after the app opens, behind login, so
what passes through Google's / Apple's push services is not plant data.

The VAPID key pair is derived from DATA_SOURCE_KEY (HKDF, fixed label), so it is
stable across restarts and replicas with no extra secret to provision.
"""

from __future__ import annotations

import base64
import json
import os
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from ..core import config

RECORD_SIZE = 4096
MAX_PAYLOAD = 3993          # 4096 - 16 (tag) - 86 (header) - 1 (delimiter)
VAPID_TTL_S = 12 * 3600
_CURVE_N = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
_ALLOWED_HOST_SUFFIXES = (
    "fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com",
    "notify.windows.com", "web.push.apple.com", "updates.push.services.mozilla.com",
)


def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def public_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962,
                                         serialization.PublicFormat.UncompressedPoint)


# ── VAPID key pair ───────────────────────────────────────────────────────

def vapid_private_key() -> ec.EllipticCurvePrivateKey:
    """Deterministic P-256 key from DATA_SOURCE_KEY (None configured -> a fixed
    dev-only key, so the dev stack works without any setup)."""
    seed = config.DATA_SOURCE_KEY or b"dev-only-vapid-seed-not-for-prod"
    d = int.from_bytes(_hkdf(b"wds-vapid", seed, b"vapid-p256", 48), "big") % (_CURVE_N - 1) + 1
    return ec.derive_private_key(d, ec.SECP256R1())


def vapid_public_key_b64() -> str:
    return b64e(public_bytes(vapid_private_key()))


def vapid_authorization(endpoint: str, subject: str, now: float | None = None,
                        key: ec.EllipticCurvePrivateKey | None = None) -> str:
    """`Authorization: vapid t=<jwt>,k=<public key>` for one push endpoint."""
    key = key or vapid_private_key()
    u = urlsplit(endpoint)
    header = b64e(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64e(json.dumps({"aud": f"{u.scheme}://{u.netloc}",
                              "exp": int((now or time.time()) + VAPID_TTL_S), "sub": subject},
                             separators=(",", ":")).encode())
    r, s = decode_dss_signature(key.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    sig = b64e(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={header}.{claims}.{sig},k={b64e(public_bytes(key))}"


# ── RFC 8291 payload encryption ──────────────────────────────────────────

def encrypt(payload: bytes, ua_public: bytes, auth_secret: bytes, *,
            as_private: ec.EllipticCurvePrivateKey | None = None,
            salt: bytes | None = None) -> bytes:
    """aes128gcm body for one subscription (single record)."""
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("payload too large")
    if len(ua_public) != 65 or ua_public[0] != 4 or len(auth_secret) != 16:
        raise ValueError("bad subscription keys")
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    as_public = public_bytes(as_private)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    secret = as_private.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, secret, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)   # 0x02 = last record
    return salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public + body


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    """The user agent's side — used by tests to prove the round trip."""
    salt, idlen = body[:16], body[20]
    as_public, ct = body[21:21 + idlen], body[21 + idlen:]
    secret = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), as_public))
    ikm = _hkdf(auth_secret, secret, b"WebPush: info\x00" + public_bytes(ua_private) + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ct, None)
    return plain.rstrip(b"\x00")[:-1]


# ── endpoint policy + send ───────────────────────────────────────────────

def endpoint_allowed(endpoint: str) -> bool:
    """Only https endpoints of the known push services. A subscription is
    user-supplied; without this the server would POST to any URL a member names
    (SSRF into the plant network)."""
    try:
        u = urlsplit(endpoint)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return (u.scheme == "https" and u.port in (None, 443) and not u.username
            and any(host == s or host.endswith("." + s) for s in _ALLOWED_HOST_SUFFIXES))


def build_request(sub: dict, message: dict, subject: str,
                  urgency: str = "high", ttl: int = 3600) -> tuple[str, bytes, dict]:
    """(url, body, headers) for one subscription row (endpoint, p256dh, auth)."""
    body = encrypt(json.dumps(message, separators=(",", ":")).encode(),
                   b64d(sub["p256dh"]), b64d(sub["auth"]))
    return sub["endpoint"], body, {
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        "TTL": str(ttl), "Urgency": urgency,
        "Authorization": vapid_authorization(sub["endpoint"], subject),
    }
