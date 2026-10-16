"""Shared request dependencies: auth, org/site scope, tenant tx, mutation gate.

Extracted from main.py so routers import these directly instead of reaching
back into main (no import cycle). main re-exports every name for compat.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import HTTPException, Request

from . import config
from .auth import OPERATOR_ROLES, Principal
from .db.context import tenant_tx
from .db.pool import Pools
from .security import ForbiddenError

if TYPE_CHECKING:  # annotation only
    from .main import State


# ---------------------------------------------------------------------------
# Auth dependencies (v4 T5 — anonymous reads removed; ADR-12)
# ---------------------------------------------------------------------------
async def _authenticate(request: Request) -> Principal:
    """Authorization header -> verified Principal. AuthError -> 401."""
    header = request.headers.get("authorization", "")
    token = None
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    p = await st(request).auth.authenticate(token)
    # The access-log middleware reads this AFTER the request completes —
    # the sub, never the token (v4 T8).
    request.state.principal = p
    return p


async def require_user(request: Request) -> Principal:
    """Any verified caller — even without org membership (for /api/me)."""
    return await _authenticate(request)


async def require_principal(request: Request) -> Principal:
    """Verified caller WITH membership in the shim org — every /api/* read."""
    p = await _authenticate(request)
    if not p.member:
        raise ForbiddenError("not a member of this organization")
    return p


async def require_operator(request: Request) -> Principal:
    """Mutating endpoints: operator/admin/owner in the shim org."""
    p = await require_principal(request)
    if not p.can_operate:
        raise ForbiddenError("operator role required")
    return p


require_authenticated = require_operator  # ack is an operator-level mutation


@dataclass(frozen=True)
class Scope:
    """Org + site a v1 request acts on. Without `X-WDS-Org`/`X-WDS-Site`
    headers it is the seeded shim org (legacy clients); with them the caller
    must be a member of that org and the site must belong to it - anything
    else is the same flat 404 as the v2 routes (no existence oracle)."""
    p: Principal
    org_id: UUID
    site_id: UUID
    role: str

    @property
    def can_operate(self) -> bool:
        return self.role in OPERATOR_ROLES


async def _scope(request: Request) -> Scope:
    p = await _authenticate(request)
    org_h = request.headers.get("x-wds-org")
    site_h = request.headers.get("x-wds-site")
    if org_h is None and site_h is None:
        if not p.member:
            raise ForbiddenError("not a member of this organization")
        return Scope(p, config.V1_ORG_ID, config.V1_SITE_ID, p.role)
    if not (org_h and site_h):
        raise HTTPException(400, "x-wds-org and x-wds-site go together")
    org_id, site_id = _uuid_or_404(org_h, "organization"), _uuid_or_404(site_h, "site")
    role = _effective_org_roles(p).get(org_id)
    if role is None:
        raise HTTPException(404, "not found")
    reg = st(request).registry
    await reg.maybe_refresh()
    if reg.site_org(site_id) is None:
        await reg.refresh()  # a member's brand-new site isn't in the cache yet
    if reg.site_org(site_id) != org_id:
        raise HTTPException(404, "not found")
    return Scope(p, org_id, site_id, role)


async def v1_read(request: Request) -> Scope:
    return await _scope(request)


async def v1_operate(request: Request) -> Scope:
    sc = await _scope(request)
    if not sc.can_operate:
        raise ForbiddenError("operator role required")
    return sc


def st(request: Request) -> State:
    return request.app.state.st


def v1_tx(request: Request, user_id: UUID | None = None):
    """v1 COMPAT SHIM (v4 T9): the /api/* endpoints predate org routing, so
    they are pinned to the seeded dev org. Every v2 call site resolves the
    org from the path instead — this is the only org pin left on the
    request path."""
    return tenant_tx(st(request).pools.app, config.V1_ORG_ID, user_id)


def org_tx(request: Request, org_id: UUID, user_id: UUID | None = None):
    """Tenant transaction for the org the v2 ROUTE resolved (membership
    already checked by the _v2_* scope helpers)."""
    return tenant_tx(st(request).pools.app, org_id, user_id)


def _effective_org_roles(p: Principal) -> dict[UUID, str]:
    """org_id -> role from the principal's hydrated memberships.

    Dev tokens hydrate org_roles from the `memberships` table at
    authenticate() time (v4 T6), so a dev user IS a member of every org the
    table says — including non-shim orgs created by tests/admin paths.
    Fallback: a principal whose memberships couldn't hydrate (pools
    unavailable) keeps only its nominal shim-org role."""
    roles = dict(p.org_roles)
    if not roles and p.member:
        roles = {config.V1_ORG_ID: p.role}
    return roles


# CONTRACT.v2 §1 permission levels used by the v2 scope helpers.
_READ = "read"        # any member
_OPERATE = "operate"  # alarm:ack / command:issue / command:read
_CONFIG = "config"    # config:write


def _v2_org(org: str, p: Principal, need: str = _READ) -> UUID:
    """Resolve + authorize the /api/v1/orgs/{org} segment (v4 T9).

    Non-member OR non-existent org -> 404 — the same response either way,
    so the route is never an existence oracle (CONTRACT.v2 §1, ADR-13 §1).
    A member without the permission level -> 403."""
    org_id = _uuid_or_404(org, "organization")
    role = _effective_org_roles(p).get(org_id)
    if role is None:
        raise HTTPException(404, "not found")
    if need == _OPERATE and role not in OPERATOR_ROLES:
        raise ForbiddenError("operator role required in this org")
    if need == _CONFIG and role not in CONFIG_ROLES:
        raise ForbiddenError("config:write requires admin or owner")
    return org_id


def _v2_scope(org: str, site: str, p: Principal,
              need: str = _READ) -> tuple[UUID, UUID]:
    """Resolve + authorize an /api/v1/orgs/{org}/sites/{site} path."""
    return _v2_org(org, p, need), _uuid_or_404(site, "site")


def _uuid_or_404(s: str, what: str) -> UUID:
    try:
        return UUID(s)
    except ValueError:
        raise HTTPException(404, f"{what} not found") from None


async def _mutation_gate(request: Request, uid: UUID) -> None:
    """Per-user write budget (v4 T4): mutations other than POST /api/commands,
    which carries its own stricter per-tag bucket in CommandManager.issue."""
    s = st(request)
    if not await s.mutation_limiter.allow(str(uid)):
        retry = await s.mutation_limiter.retry_after(str(uid))
        raise HTTPException(status_code=429, detail="rate_limited",
                            headers={"Retry-After": str(max(1, math.ceil(retry)))})


# ---------------------------------------------------------------------------
# Edge provisioning (doc 17 §5 + CONTRACT.v2 §3 site-scoped routes)
#
# v4 T9: these take `require_user` (any authenticated principal), NOT
# require_principal — the org check is the PATH org's membership via
# _v2_scope. A principal who belongs only to a non-shim org can manage its
# own edges; a member of org A hitting org B's routes sees 404.
# ---------------------------------------------------------------------------
CONFIG_ROLES = frozenset({"admin", "owner"})  # CONTRACT.v2 §1 config:write


async def _site_or_404(pools: Pools, org_id: UUID, site_id: UUID) -> None:
    async with tenant_tx(pools.app, org_id) as tc:
        # RLS does the hiding: a site of ANOTHER org is simply not found —
        # identical response to a site that doesn't exist at all (no oracle).
        exists = await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id)
    if not exists:
        raise HTTPException(404, "site not found")


async def _v2_tag_or_404(request: Request, org_id: UUID, site_id: UUID,
                         tag_s: str):
    """Resolve a path tag_id against the registry AND the route's org+site —
    a valid tag id of another tenant is a 404, never a leak."""
    s = st(request)
    tid = _uuid_or_404(tag_s, "tag")
    await s.registry.maybe_refresh()
    t = s.registry.by_id(tid)
    if t is None or t.org_id != org_id or t.site_id != site_id:
        await s.registry.refresh()          # cold-cache retry once
        t = s.registry.by_id(tid)
    if t is None or t.org_id != org_id or t.site_id != site_id:
        raise HTTPException(404, "tag not found")
    return t
