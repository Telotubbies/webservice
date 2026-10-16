"""Org lifecycle guard (roadmap §11 7.1, §5 1.6).

A suspended org keeps its gateways connected (the guard only gates the REST
API — nothing here touches the broker) but member writes and commands are
refused; a soft-deleted org is unreachable at once except for the owner's
``POST .../restore`` path inside the 30-day window.

Enforcement can't live in ``_v2_org`` (sync, no DB) so it is a small ASGI
middleware wired in main.py's middleware table:

    app.add_middleware(orgguard.OrgGuardMiddleware)

The flag lookup (``organizations.deleted_at`` / ``suspended_at``) needs
wds_system's cross-tenant read — a 5 s whole-map cache keeps it off the
request hot path; mutations also call :func:`forget` so the flip takes
effect on the next request. On a lookup failure the LAST GOOD map serves
(fail open on stale data rather than amplifying a DB blip into an outage —
same posture as the registry's maybe_refresh).

Reads (GET/HEAD/OPTIONS) stay allowed on suspended orgs: the console shows
the suspended page from the org's own data.
"""

from __future__ import annotations

import logging
import re
import time
from uuid import UUID

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..db.context import global_tx

log = logging.getLogger("wds.orgguard")

_ORG_PATH = re.compile(r"^/api/v1/orgs/([0-9a-fA-F-]{36})(/|$)")
_TTL_S = 5.0

# Paths that stay reachable past the lifecycle gate (suffix match on the
# path after the org segment). Restore must survive `deleted`; leave must
# survive `suspended` — a member can always walk out.
_ALLOW_DELETED = ("/restore",)
_ALLOW_SUSPENDED_WRITE = ("/leave", "/restore")

_flags: dict[UUID, tuple[bool, bool]] = {}   # org_id -> (deleted, suspended)
_fetched_at = 0.0


def forget(org_id: UUID | None = None) -> None:
    """Drop cached flags (called by suspend/restore/delete endpoints so the
    change applies at once, not after the TTL)."""
    global _fetched_at
    if org_id is None:
        _flags.clear()
    else:
        _flags.pop(org_id, None)
    _fetched_at = 0.0


async def _flags_now(pool) -> dict[UUID, tuple[bool, bool]]:
    global _fetched_at
    if time.monotonic() - _fetched_at < _TTL_S:
        return _flags
    try:
        async with global_tx(pool) as conn:
            rows = await conn.fetch(
                "SELECT id, deleted_at, suspended_at FROM organizations")
    except Exception:  # noqa: BLE001 — serve the stale map (fail open)
        log.exception("org flag refresh failed — serving stale map")
        return _flags
    _flags.clear()
    _flags.update({r["id"]: (r["deleted_at"] is not None,
                           r["suspended_at"] is not None) for r in rows})
    _fetched_at = time.monotonic()
    return _flags


def _org_of(request) -> tuple[UUID | None, str]:
    """(org_id, path_after_org) for /api/v1/orgs/{uuid}/... requests."""
    m = _ORG_PATH.match(request.url.path)
    if not m:
        return None, ""
    try:
        return UUID(m.group(1)), request.url.path[m.end(1):]
    except ValueError:
        return None, ""


class OrgGuardMiddleware(BaseHTTPMiddleware):
    """Refuse requests into deleted or suspended organizations."""

    async def dispatch(self, request, call_next):
        org_id, rest = _org_of(request)
        if org_id is None:
            return await call_next(request)
        st = getattr(request.app.state, "st", None)
        if st is None:                         # lifespan not up yet
            return await call_next(request)
        deleted, suspended = (await _flags_now(st.pools.system)).get(
            org_id, (False, False))
        if deleted:
            if rest in _ALLOW_DELETED:
                return await call_next(request)
            return JSONResponse(status_code=404,
                                content={"detail": "not found"})
        if suspended and request.method not in ("GET", "HEAD", "OPTIONS"):
            if rest in _ALLOW_SUSPENDED_WRITE:
                return await call_next(request)
            return JSONResponse(status_code=403,
                                content={"detail": "org_suspended"})
        return await call_next(request)
