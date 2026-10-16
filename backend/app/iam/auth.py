"""Principal model + dev-token auth (APP_ENV=dev only).

Production authentication is OIDC JWT verification in `app.iam.security`
(ADR-12). This module keeps:

- ``Principal`` — the resolved caller: role in the v1 shim org, IdP ``sub``,
  session ``sid``, ``user_id``, org memberships, token ``exp``.
- ``dev_principal`` — the demo bearer-token path. It returns a Principal only
  when ``APP_ENV=dev``; in any other env it returns ``None`` so a demo token
  falls through to JWT verification and fails like any other bad token.
  Read ``config.APP_ENV`` lazily so tests can flip it.

Token comparison uses hmac.compare_digest (constant-time).
"""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import dataclass, field
from uuid import UUID

from ..core import config

log = logging.getLogger("backend.auth")

TOKENS = {
    os.environ.get("API_TOKEN_OPERATOR", "demo-operator"): "operator",
    os.environ.get("API_TOKEN_VIEWER", "demo-viewer"): "viewer",
    os.environ.get("API_TOKEN_ADMIN", "demo-admin"): "admin",
}

ROLE_ANONYMOUS = "anonymous"
ROLE_NONE = "none"          # authenticated but no membership in the org
OPERATOR_ROLES = frozenset({"operator", "admin", "owner"})

if "demo-operator" in TOKENS and config.APP_ENV != "dev":
    log.warning(
        "demo token present but APP_ENV != dev — dev-token path disabled")


@dataclass(frozen=True)
class Principal:
    user: str          # display key: IdP sub or token name
    role: str          # owner|admin|operator|viewer|none in the shim org
    kind: str = "anonymous"        # "dev" | "oidc" | "anonymous"
    sub: str = ""
    sid: str = ""
    user_id: UUID | None = None
    org_roles: tuple = field(default_factory=tuple)  # ((org_id, role), ...)
    exp: float = 0.0   # JWT exp (epoch s); 0 = never expires (dev tokens)

    ROLE_NONE = ROLE_NONE

    @property
    def authenticated(self) -> bool:
        return self.kind != ROLE_ANONYMOUS

    @property
    def member(self) -> bool:
        return self.role != ROLE_NONE

    @property
    def can_operate(self) -> bool:
        return self.role in OPERATOR_ROLES


def dev_principal(token: str) -> Principal | None:
    """Resolve a dev bearer token — only under APP_ENV=dev (ADR-12 §10)."""
    if config.APP_ENV != "dev":
        return None
    for known, role in TOKENS.items():
        if hmac.compare_digest(token, known):
            from ..ops.seed import DEMO_USERS
            by_role = {r: uid for uid, r in DEMO_USERS.values()}
            return Principal(user=token, role=role, kind="dev",
                             sub=f"dev:{role}", user_id=by_role.get(role))
    return None
