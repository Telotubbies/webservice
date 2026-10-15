"""One-time gateway enrollment codes (spec 5.1).

A code is 8 chars of the RFC 4648 base32 alphabet (no padding), shown as
XXXX-XXXX. Only sha256(normalised code) is stored; the code itself is shown
once. Normalisation (strip dashes/space, upper-case) makes hand-typing forgiving.
"""

from __future__ import annotations

import hashlib
import re
import secrets

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
CODE_LEN = 8
CODE_TTL_S = 30 * 60
_VALID = re.compile(r"^[A-Z2-7]{8}$")


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
    return f"{raw[:4]}-{raw[4:]}"


def normalize(code: str) -> str | None:
    """Canonical form (8 upper-case base32 chars) or None when malformed."""
    n = re.sub(r"[\s-]", "", code or "").upper()
    return n if _VALID.match(n) else None


def hash_code(code: str) -> str | None:
    n = normalize(code)
    return hashlib.sha256(n.encode()).hexdigest() if n else None
