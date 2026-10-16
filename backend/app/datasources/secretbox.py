"""AES-256-GCM seal/open for data-source secrets (spec 5.6).

Blob layout: 12-byte random nonce || ciphertext+tag. The key is
config.DATA_SOURCE_KEY (32 bytes); tampering or a wrong key raises
cryptography.exceptions.InvalidTag.
"""

from __future__ import annotations

import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..core import config

MAX_PLAIN_BYTES = 4096


def _key(key: bytes | None) -> bytes:
    k = key if key is not None else config.DATA_SOURCE_KEY
    if not isinstance(k, bytes) or len(k) != 32:
        raise ValueError("data source key must be 32 bytes")
    return k


def seal(plain: dict, key: bytes | None = None) -> bytes:
    raw = json.dumps(plain, separators=(",", ":"), sort_keys=True).encode()
    if len(raw) > MAX_PLAIN_BYTES:
        raise ValueError(f"secrets exceed {MAX_PLAIN_BYTES} bytes")
    nonce = os.urandom(12)
    return nonce + AESGCM(_key(key)).encrypt(nonce, raw, None)


def open_(blob: bytes, key: bytes | None = None) -> dict:
    blob = bytes(blob)
    return json.loads(AESGCM(_key(key)).decrypt(blob[:12], blob[12:], None))
