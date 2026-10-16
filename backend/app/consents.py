"""Legal consent records (roadmap 8.1).

Terms of Service + Privacy Policy (PDPA) consent is recorded per user with
the document version and timestamp. `config.CONSENT_VERSION` names the
current versions; a user whose recorded version is older — or who never
consented — must POST again before org access (enforced as a gate inside
`orgs.create_org`, the one place a user crosses into tenant access).

Mounted from main.py (`app.include_router(consents.router)`); auth helpers
are resolved lazily at call time so this module has no import-time
dependency on main.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import config
from .db.context import user_tx
from .db.util import iso_z

log = logging.getLogger("wds.consents")

router = APIRouter()

DOCS = tuple(config.CONSENT_VERSION.keys())  # ('tos', 'privacy')


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def version_key(v: str) -> tuple[int, ...]:
    """'2026-10-16' -> (2026,10,16); unparsable versions sort oldest."""
    try:
        return tuple(int(p) for p in v.split("-"))
    except ValueError:
        return (0,)


def missing_docs(given: dict[str, str], required: dict[str, str] | None = None) -> list[str]:
    """Docs whose recorded version is older than (or absent vs) required."""
    req = required or config.CONSENT_VERSION
    return [d for d, v in req.items()
            if version_key(given.get(d, "")) < version_key(v)]


async def current_versions(conn, user_id: UUID) -> dict[str, str]:
    rows = await conn.fetch(
        "SELECT doc, version FROM consents WHERE user_id=$1", user_id)
    return {r["doc"]: r["version"] for r in rows}


async def has_current_consent(conn, user_id: UUID) -> bool:
    """True when every required doc has a current-version row — or when the
    consents table doesn't exist yet (pre-0044 deploys must not wedge org
    creation on an unapplied migration)."""
    if not await conn.fetchval("SELECT to_regclass('consents') IS NOT NULL"):
        return True
    return not missing_docs(await current_versions(conn, user_id))


class ConsentIn(BaseModel):
    doc: str = Field(min_length=1, max_length=40)
    version: str = Field(min_length=1, max_length=40)


@router.get("/api/v1/consents")
async def get_consents(request: Request, p=Depends(_user)):
    """Current required versions + what this user has on file."""
    if p.user_id is None:
        raise HTTPException(404, "not found")
    async with user_tx(_m().st(request).pools.app, p.user_id) as conn:
        rows = await conn.fetch(
            "SELECT doc, version, consented_at FROM consents WHERE user_id=$1",
            p.user_id)
    given = {r["doc"]: {"version": r["version"],
                        "at": iso_z(r["consented_at"])} for r in rows}
    missing = missing_docs({d: g["version"] for d, g in given.items()})
    return {"required": dict(config.CONSENT_VERSION), "given": given,
            "missing": missing, "current": not missing}


@router.post("/api/v1/consents", status_code=201)
async def post_consent(body: ConsentIn, request: Request, p=Depends(_user)):
    """Record acceptance of the CURRENT version of a document. Recording an
    older version is rejected — consent to a stale doc is no consent."""
    if p.user_id is None or p.kind not in ("oidc", "dev"):
        raise HTTPException(403, "a signed-in user is required")
    want = config.CONSENT_VERSION.get(body.doc)
    if want is None:
        raise HTTPException(422, "unknown_document")
    if body.version != want:
        raise HTTPException(422, "stale_version")
    m = _m()
    await m._mutation_gate(request, p.user_id)
    async with user_tx(m.st(request).pools.app, p.user_id) as conn:
        row = await conn.fetchrow(
            "INSERT INTO consents(user_id, doc, version) VALUES ($1,$2,$3)"
            " ON CONFLICT (user_id, doc) DO UPDATE SET version=EXCLUDED.version,"
            " consented_at=now() RETURNING doc, version, consented_at",
            p.user_id, body.doc, body.version)
    return {"consent": {"doc": row["doc"], "version": row["version"],
                        "at": iso_z(row["consented_at"])}}
