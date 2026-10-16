"""Organization creation (roadmap 1.2): slug/timezone/language validation and
the single-transaction `create_org` (org + default site + owner membership)."""

from __future__ import annotations

import re
import uuid
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

from .db import audit
from .db.context import tenant_tx, user_tx

RESERVED_SLUGS = frozenset({"admin", "api", "app", "new", "www", "support", "status"})
LANGUAGES = frozenset({"en", "th"})
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class OrgError(Exception):
    """Domain error with a stable machine code (`slug_taken`, `email_not_verified`…)."""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


def validate_slug(raw: str) -> str:
    slug = (raw or "").strip().lower()
    if not (3 <= len(slug) <= 40) or not _SLUG_RE.fullmatch(slug):
        raise ValueError("slug_format")
    if slug in RESERVED_SLUGS:
        raise ValueError("slug_reserved")
    return slug


def validate_timezone(raw: str) -> str:
    try:
        ZoneInfo(raw)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ValueError("timezone") from None
    if not raw or raw.startswith("/") or ".." in raw:
        raise ValueError("timezone")
    return raw


def validate_language(raw: str) -> str:
    if raw not in LANGUAGES:
        raise ValueError("language")
    return raw


async def create_org(pools, user_id: UUID, *, name: str, slug: str,
                     timezone: str = "Asia/Bangkok", language: str = "en") -> dict:
    """Create org + default site `main` + owner membership atomically.

    Requires a verified email (roadmap 1.1). The slug's unique index is the
    arbiter for concurrent creates — no pre-check race."""
    name = (name or "").strip()
    if not (1 <= len(name) <= 120):
        raise ValueError("name")
    slug, timezone, language = validate_slug(slug), validate_timezone(timezone), validate_language(language)

    async with user_tx(pools.app, user_id) as conn:
        verified = await conn.fetchval("SELECT email_verified FROM users WHERE id=$1", user_id)
    if not verified:
        raise OrgError("email_not_verified", 403)

    org_id = uuid.uuid4()
    try:
        async with tenant_tx(pools.app, org_id, user_id) as tc:
            await tc.execute(
                "INSERT INTO organizations(id, name, slug, timezone, language)"
                " VALUES ($1,$2,$3,$4,$5)", org_id, name, slug, timezone, language)
            site_id = await tc.fetchval(
                "INSERT INTO sites(org_id, name, code, timezone) VALUES ($1,$2,'main',$3) RETURNING id",
                org_id, name, timezone)
            await tc.execute(
                "INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,'owner')",
                org_id, user_id)
            await audit.append(tc, f"user:{user_id}", "org.create",
                               {"org": str(org_id)}, {"slug": slug})
    except asyncpg.UniqueViolationError:
        raise OrgError("slug_taken", 409) from None
    return {"org": {"id": str(org_id), "name": name, "slug": slug,
                    "timezone": timezone, "language": language},
            "site": {"id": str(site_id), "name": name, "code": "main"},
            "role": "owner"}
