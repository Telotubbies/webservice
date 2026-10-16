"""v2 admin API: members routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..iam import consents
from ..iam.auth import Principal
from ..db import audit
from ..db.context import global_tx
from ..db.context import invite_tx
from ..db.context import tenant_tx
from ..db.context import user_tx
from ..db.util import iso_z
from ..db.util import utcnow
from ..iam.security import ForbiddenError
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator
from uuid import UUID
import hashlib
import json
import secrets
import uuid
from ..deps import (
    _CONFIG,
    _effective_org_roles,
    _mutation_gate,
    _uuid_or_404,
    _v2_org,
    org_tx,
    require_user,
    st,
)
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------------------
# v2 admin (v4 T10, CONTRACT.v2 §3): alarm-rule CRUD, memberships, invites,
# audit export.
#
# Permission mapping (CONTRACT.v2 §1 table): config:write, member:manage and
# audit:read ALL sit in the admin|owner band — the _CONFIG check is the same
# gate for each. Operators get read access where the table allows
# (alarm-rules list is site:read) and a flat 403 on mutations.
# ---------------------------------------------------------------------------
MEMBER_ROLES = frozenset({"owner", "admin", "operator", "viewer"})
INVITABLE_ROLES = frozenset({"admin", "operator", "viewer"})  # schema CHECK
INVITE_TTL_D = 7
MEMBER_LIST_MAX = 5000  # T10-review F9 — same bound as the audit export


class MemberPatch(BaseModel):
    role: str | None = None
    disabled: bool | None = None


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: str

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("invalid email")
        return v


class InviteAcceptIn(BaseModel):
    # T10-review F1: the token travels in the body, never the URL path —
    # a path token lands in access logs and proxy traces.
    token: str = Field(min_length=1, max_length=128)


# ---------------------------------------------------------------------------
# Memberships — member:manage (admin|owner)
# ---------------------------------------------------------------------------
def _member_json(r) -> dict:
    return {"user_id": str(r["user_id"]), "role": r["role"],
            "sub": r["sub"], "display_name": r["display_name"],
            "email": r["email"],
            "disabled": r["disabled_at"] is not None}


async def _membership_or_404(tc, user_id: str):
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(404, "member not found") from None
    row = await tc.fetchrow(
        "SELECT m.user_id, m.role, u.sub, u.display_name, u.email, u.disabled_at"
        " FROM memberships m JOIN users u ON u.id = m.user_id"
        " WHERE m.user_id=$1", uid)
    if row is None:
        raise HTTPException(404, "member not found")
    return row


@router.get("/api/v1/orgs/{org}/members")
async def v2_list_members(org: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT m.user_id, m.role, u.sub, u.display_name, u.email,"
            " u.disabled_at FROM memberships m JOIN users u ON u.id = m.user_id"
            " WHERE u.sub NOT LIKE 'svc:%'"  # service accounts live under /api-keys
            " ORDER BY u.display_name LIMIT $1", MEMBER_LIST_MAX)
    return {"items": [_member_json(r) for r in rows], "next_cursor": None}


@router.patch("/api/v1/orgs/{org}/members/{user_id}")
async def v2_patch_member(org: str, user_id: str, body: MemberPatch,
                          request: Request,
                          p: Principal = Depends(require_user)):
    """Role change and/or user disable (CONTRACT.v2 §3 member:manage).

    Guards: an admin cannot touch an owner row (demote OR disable), nobody
    can demote the last owner, and only an owner can grant 'owner'. A
    membership change NOTIFYs wds_authz so the ≤5s revocation path applies.
    """
    org_id = _v2_org(org, p, need=_CONFIG)
    if body.role is None and body.disabled is None:
        raise HTTPException(400, "invalid_request: empty patch")
    if body.role is not None and body.role not in MEMBER_ROLES:
        raise HTTPException(400, "invalid_request: role")
    caller_role = _effective_org_roles(p)[org_id]
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        target = await _membership_or_404(tc, user_id)
        if target["user_id"] == p.user_id and (
                body.disabled or (body.role and body.role != target["role"])):
            raise HTTPException(400, "cannot change your own role or disable yourself")
        if caller_role != "owner":
            # an admin may not demote/disable an owner, nor mint a new one
            if target["role"] == "owner" or body.role == "owner":
                raise ForbiddenError("owner rows are managed by owners")
        if body.role is not None and target["role"] == "owner" \
                and body.role != "owner":
            owners = await tc.fetchval(
                "SELECT count(*) FROM memberships WHERE role='owner'")
            if owners <= 1:
                raise HTTPException(409, "org must keep at least one owner")
        if body.role is not None and body.role != target["role"]:
            await tc.execute(
                "UPDATE memberships SET role=$2 WHERE user_id=$1",
                target["user_id"], body.role)
        if body.disabled is not None:
            if body.disabled and target["role"] == "owner":
                owners_active = await tc.fetchval(
                    "SELECT count(*) FROM memberships m JOIN users u"
                    " ON u.id=m.user_id WHERE m.role='owner'"
                    " AND u.disabled_at IS NULL")
                if owners_active <= 1:
                    raise HTTPException(409, "org must keep at least one active owner")
            await tc.execute(
                "UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END"
                " WHERE id=$1", target["user_id"], body.disabled)
        await audit.append(tc, f"user:{p.user_id}", "member.updated",
                           {"user_id": str(target["user_id"])},
                           body.model_dump(exclude_unset=True))
    # local eviction now, NOTIFY for other replicas/listeners (same pattern
    # as Security.record_logout — no need to wait the listener round-trip)
    st(request).auth.on_notify(json.dumps(
        {"type": "user_disabled" if body.disabled else "membership_changed",
         "sub": target["sub"]}))
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "user_disabled" if body.disabled
                        else "membership_changed", "sub": target["sub"]}))
    async with org_tx(request, org_id) as tc:
        row = await _membership_or_404(tc, str(target["user_id"]))
    return {"member": _member_json(row)}


@router.delete("/api/v1/orgs/{org}/members/{user_id}")
async def v2_delete_member(org: str, user_id: str, request: Request,
                           p: Principal = Depends(require_user)):
    """Remove the membership. The user row survives — it is global and may
    hold memberships elsewhere; this revokes THIS org only (wds_authz)."""
    org_id = _v2_org(org, p, need=_CONFIG)
    caller_role = _effective_org_roles(p)[org_id]
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        target = await _membership_or_404(tc, user_id)
        if target["user_id"] == p.user_id and target["role"] == "owner":
            raise HTTPException(400, "an owner cannot remove themselves")
        if caller_role != "owner" and target["role"] == "owner":
            raise ForbiddenError("owner rows are managed by owners")
        if target["role"] == "owner":
            owners = await tc.fetchval(
                "SELECT count(*) FROM memberships WHERE role='owner'")
            if owners <= 1:
                raise HTTPException(409, "org must keep at least one owner")
        await tc.execute("DELETE FROM memberships WHERE user_id=$1",
                         target["user_id"])
        await audit.append(tc, f"user:{p.user_id}", "member.removed",
                           {"user_id": str(target["user_id"])},
                           {"role": target["role"]})
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "membership_changed", "sub": target["sub"]}))
    return {"user_id": str(target["user_id"]), "removed": True}


# ---------------------------------------------------------------------------
# Invites — member:manage; accept is a global route (CONTRACT.v2 §3 identity)
# ---------------------------------------------------------------------------
def _invite_json(r) -> dict:
    return {"id": str(r["id"]), "email": r["email"], "role": r["role"],
            "expires_at": iso_z(r["expires_at"]),
            "accepted_at": iso_z(r["accepted_at"]) if r["accepted_at"] else None}


@router.get("/api/v1/orgs/{org}/invites")
async def v2_list_invites(org: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, email, role, expires_at, accepted_at FROM invites"
            " ORDER BY created_at DESC LIMIT 200")
    return {"items": [_invite_json(r) for r in rows], "next_cursor": None}


@router.post("/api/v1/orgs/{org}/invites", status_code=201)
async def v2_create_invite(org: str, body: InviteIn, request: Request,
                           p: Principal = Depends(require_user)):
    """Mint an invite; the raw token is returned ONCE and only its sha256 is
    stored (CONTRACT.v2 §3: 32 random bytes, single-use, 7-day expiry)."""
    org_id = _v2_org(org, p, need=_CONFIG)
    if body.role not in INVITABLE_ROLES:
        raise HTTPException(400, "invalid_request: role")
    await _mutation_gate(request, p.user_id)
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    iid = uuid.uuid4()
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO invites(id, org_id, email, role, token_hash, invited_by,"
            " expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + $7::int * interval '1 day')"
            " RETURNING id, email, role, expires_at, accepted_at",
            iid, org_id, body.email, body.role, token_hash, p.user_id,
            INVITE_TTL_D)
        await audit.append(tc, f"user:{p.user_id}", "invite.created",
                           {"invite_id": str(iid)},
                           {"email": body.email, "role": body.role})
    return {"invite": _invite_json(row), "token": token}


@router.delete("/api/v1/orgs/{org}/invites/{invite_id}")
async def v2_revoke_invite(org: str, invite_id: str, request: Request,
                           p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    iid = _uuid_or_404(invite_id, "invite")
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "DELETE FROM invites WHERE id=$1 AND accepted_at IS NULL"
            " RETURNING id, email", iid)
        if row is None:
            raise HTTPException(404, "invite not found")
        await audit.append(tc, f"user:{p.user_id}", "invite.revoked",
                           {"invite_id": str(iid)}, {"email": row["email"]})
    return {"id": str(iid), "revoked": True}


@router.post("/api/v1/invites/accept")
async def v2_accept_invite(body: InviteAcceptIn, request: Request,
                           p: Principal = Depends(require_user)):
    """Accept an invite (CONTRACT.v2 §3): the token resolves to exactly one
    invite via the invite_hash RLS context; the caller's VERIFIED email must
    match the invite email. Single-use — accepted/expired/unknown all 404 so
    the endpoint is not an existence oracle."""
    if len(body.token) != 64:
        raise HTTPException(404, "invite not found")
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    await _mutation_gate(request, p.user_id)
    async with invite_tx(st(request).pools.app, token_hash) as conn:
        invite = await conn.fetchrow(
            "SELECT id, org_id, email, role, expires_at, accepted_at"
            " FROM invites")
    if invite is None or invite["accepted_at"] is not None \
            or invite["expires_at"] <= utcnow():
        raise HTTPException(404, "invite not found")
    async with global_tx(st(request).pools.app) as conn:
        user = await conn.fetchrow(
            "SELECT email, email_verified, disabled_at FROM users WHERE id=$1",
            p.user_id)
    if user is None or user["disabled_at"] is not None:
        raise ForbiddenError("account cannot accept invites")
    if not user["email_verified"] or (user["email"] or "").lower() \
            != invite["email"].lower():
        raise ForbiddenError("invite email does not match your verified email")
    # Roadmap 8.1 — same gate as orgs.create_org: crossing into a tenant
    # (the membership insert below) requires current ToS/Privacy consent on
    # file. consent_self RLS needs the user_tx context (app.user_id).
    async with user_tx(st(request).pools.app, p.user_id) as conn:
        if not await consents.has_current_consent(conn, p.user_id):
            raise HTTPException(403, "consent_required")
    async with tenant_tx(st(request).pools.app, invite["org_id"], p.user_id) as tc:
        # OrgGuard can't see this global route (no /orgs/{id} path segment),
        # so the lifecycle check lives here: deleted -> 404 like every other
        # route into the org; suspended -> 403 (a write it could never use).
        org = await tc.fetchrow(
            "SELECT deleted_at, suspended_at FROM organizations WHERE id=$1",
            invite["org_id"])
        if org is None or org["deleted_at"] is not None:
            raise HTTPException(404, "invite not found")
        if org["suspended_at"] is not None:
            raise HTTPException(403, "org_suspended")
        # T10-review F2: the single-use claim is the row UPDATE itself —
        # a racing second accept gets UPDATE 0 → 404, not a double-write.
        n = await tc.execute(
            "UPDATE invites SET accepted_at=now(), accepted_by=$2"
            " WHERE id=$1 AND accepted_at IS NULL", invite["id"], p.user_id)
        if n == "UPDATE 0":
            raise HTTPException(404, "invite not found")
        # T10-review F3: an EXISTING member keeps their current role — the
        # invite only confirms membership. A blind upsert would let an admin
        # demote (e.g.) the last owner by inviting their email.
        cur = await tc.fetchrow(
            "SELECT role FROM memberships WHERE user_id=$1", p.user_id)
        if cur is None:
            await tc.execute(
                "INSERT INTO memberships(org_id, user_id, role)"
                " VALUES ($1,$2,$3)", invite["org_id"], p.user_id,
                invite["role"])
        await audit.append(tc, f"user:{p.user_id}", "invite.accepted",
                           {"invite_id": str(invite["id"])},
                           {"role": invite["role"],
                            "membership": "created" if cur is None
                            else "existing"})
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "membership_changed", "sub": p.sub}))
    return {"status": "accepted", "org_id": str(invite["org_id"]),
            "role": invite["role"] if cur is None else cur["role"]}
