"""Dev-token auth — DEMO ONLY, not production security.

Tokens are injected via env so a deployment can rotate them without a code
change (and demo defaults are never the only line of defence):

  API_TOKEN_OPERATOR -> operator role (read + command + ack)
  API_TOKEN_VIEWER   -> viewer role  (read only)

Unset env falls back to the well-known demo values for local dev/tests.
Missing/unknown token -> anonymous (GET allowed, POST 401).

Tokens are compared with hmac.compare_digest (constant-time) to avoid leaking
valid prefixes via timing. In prod this would be JWT signature verification
(SDLC 06 §5, Cognito) — see README.
"""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

log = logging.getLogger("backend.auth")

TOKENS = {
    os.environ.get("API_TOKEN_OPERATOR", "demo-operator"): "operator",
    os.environ.get("API_TOKEN_VIEWER", "demo-viewer"): "viewer",
}

if "demo-operator" in TOKENS:
    log.warning(
        "API_TOKEN_OPERATOR unset — using well-known demo token. "
        "Set API_TOKEN_OPERATOR/API_TOKEN_VIEWER outside local dev."
    )

ROLE_ANONYMOUS = "anonymous"


@dataclass(frozen=True)
class Principal:
    user: str          # token name ("demo-operator") or "anonymous"
    role: str          # operator | viewer | anonymous

    @property
    def authenticated(self) -> bool:
        return self.role != ROLE_ANONYMOUS


def resolve_token(token: str | None) -> Principal:
    """Resolve a raw bearer token to a Principal (also used by /ws auth frame)."""
    if token:
        for known, role in TOKENS.items():
            if hmac.compare_digest(token, known):
                return Principal(user=known, role=role)
    return Principal(user=ROLE_ANONYMOUS, role=ROLE_ANONYMOUS)


def principal(request: Request) -> Principal:
    """FastAPI dependency: parse Authorization header -> Principal."""
    header = request.headers.get("authorization", "")
    token = None
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    return resolve_token(token)


def require_operator(p: Principal = Depends(principal)) -> Principal:
    """Mutating endpoints: anonymous -> 401, viewer -> 403, operator -> ok."""
    if p.role == ROLE_ANONYMOUS:
        raise HTTPException(status_code=401, detail="authentication required")
    if p.role != "operator":
        raise HTTPException(status_code=403, detail="operator role required")
    return p


def require_authenticated(p: Principal = Depends(principal)) -> Principal:
    """Endpoints that need any authenticated role (e.g. alarm ack)."""
    if p.role == ROLE_ANONYMOUS:
        raise HTTPException(status_code=401, detail="authentication required")
    if p.role == "viewer":
        # viewers are read-only; ack is a mutation -> 403 (contract: operator
        # has read+command+ack, viewer is read only)
        raise HTTPException(status_code=403, detail="operator role required")
    return p
