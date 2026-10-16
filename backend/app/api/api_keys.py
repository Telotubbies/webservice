"""v2 admin API: api keys routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..auth import Principal
from ..db import audit
from ..db.util import iso_z
from ..db.util import utcnow
from ..security import API_KEY_PREFIX
from ..security import ForbiddenError
from datetime import timedelta
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
import hashlib
import secrets
import uuid
from ..deps import (
    _CONFIG,
    _mutation_gate,
    _uuid_or_404,
    _v2_org,
    org_tx,
    require_user,
)
from fastapi import APIRouter

router = APIRouter()

API_KEY_MAX = 100


# ---------------------------------------------------------------------------
# API keys — service accounts for machine callers (config:write). The secret is
# shown once at creation; only its sha256 is stored. A key authenticates as a
# service user with an ordinary membership, so role checks apply unchanged.
# ---------------------------------------------------------------------------
API_KEY_ROLES = frozenset({"viewer", "operator", "admin"})  # never owner


class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    role: str = "viewer"
    expires_days: int | None = Field(default=None, ge=1, le=730)


def _key_json(r) -> dict:
    return {"id": str(r["id"]), "name": r["name"], "prefix": r["prefix"],
            "role": r["role"], "created_at": iso_z(r["created_at"]),
            "expires_at": iso_z(r["expires_at"]) if r["expires_at"] else None,
            "last_used_at": iso_z(r["last_used_at"]) if r["last_used_at"] else None,
            "revoked_at": iso_z(r["revoked_at"]) if r["revoked_at"] else None}


def _no_service_accounts(p: Principal) -> None:
    if p.kind == "apikey":  # a leaked key must not be able to mint more keys
        raise ForbiddenError("service accounts cannot manage API keys")


@router.get("/api/v1/orgs/{org}/api-keys")
async def v2_list_api_keys(org: str, request: Request,
                           p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    _no_service_accounts(p)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT k.id, k.name, k.prefix, k.created_at, k.expires_at,"
            " k.last_used_at, k.revoked_at, m.role FROM api_keys k"
            " LEFT JOIN memberships m ON m.user_id = k.user_id"
            " ORDER BY k.created_at DESC LIMIT 500")
    return {"items": [_key_json({**dict(r), "role": r["role"] or "none"}) for r in rows],
            "next_cursor": None}


@router.post("/api/v1/orgs/{org}/api-keys", status_code=201)
async def v2_create_api_key(org: str, body: ApiKeyIn, request: Request,
                            p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    _no_service_accounts(p)
    if body.role not in API_KEY_ROLES:
        raise HTTPException(400, "invalid_request: role")
    await _mutation_gate(request, p.user_id)
    secret = API_KEY_PREFIX + secrets.token_urlsafe(32)
    expires = (utcnow() + timedelta(days=body.expires_days)) if body.expires_days else None
    async with org_tx(request, org_id, p.user_id) as tc:
        n = await tc.fetchval("SELECT count(*) FROM api_keys WHERE revoked_at IS NULL")
        if n >= API_KEY_MAX:
            raise HTTPException(409, "api key limit reached - revoke an unused key")
        uid = await tc.fetchval(
            "INSERT INTO users(sub, display_name) VALUES ($1,$2) RETURNING id",
            f"svc:{uuid.uuid4()}", body.name)
        await tc.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,$3)",
                         org_id, uid, body.role)
        row = await tc.fetchrow(
            "INSERT INTO api_keys(org_id, user_id, name, prefix, key_hash, created_by, expires_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7)"
            " RETURNING id, name, prefix, created_at, expires_at, last_used_at, revoked_at",
            org_id, uid, body.name, secret[:len(API_KEY_PREFIX) + 6],
            hashlib.sha256(secret.encode()).hexdigest(), p.user_id, expires)
        await audit.append(tc, f"user:{p.user_id}", "api_key.created",
                           {"key_id": str(row["id"])}, {"name": body.name, "role": body.role})
    return {"key": _key_json({**dict(row), "role": body.role}), "secret": secret}


@router.delete("/api/v1/orgs/{org}/api-keys/{key_id}", status_code=204)
async def v2_revoke_api_key(org: str, key_id: str, request: Request,
                            p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    _no_service_accounts(p)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        uid = await tc.fetchval(
            "UPDATE api_keys SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL"
            " RETURNING user_id", _uuid_or_404(key_id, "api key"))
        if uid is None:
            raise HTTPException(404, "api key not found")
        await tc.execute("DELETE FROM memberships WHERE user_id=$1", uid)
        await tc.execute("UPDATE users SET disabled_at = now() WHERE id=$1 AND sub LIKE 'svc:%'", uid)
        await audit.append(tc, f"user:{p.user_id}", "api_key.revoked", {"key_id": key_id}, {})
    return Response(status_code=204)
