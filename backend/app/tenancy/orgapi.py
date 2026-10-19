"""Tenant-facing org surface (roadmap §5 1.6, §9 5.5, §10 6.2, §12 8.2).

Mounted from main.py next to the other v2 routers. Auth helpers come from
main.py lazily (`_m()`), same convention as app/vision/* and
app/datasources/routes.py — the OrgGuard middleware (orgguard.py) has
already refused suspended writes and deleted-org traffic by the time a
handler here runs.

Routes: org list with lifecycle markers, per-org usage vs plan caps, site
creation (plan-capped), leave / soft-delete / restore, owner data exports,
feature flags, announcements, support-session visibility, webhook endpoint
CRUD + delivery log, and a per-org filtered OpenAPI document.
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator

from ..core import config, jobs
from ..iam import orgguard
from . import plans
from ..datasources import secretbox
from ..db import audit
from ..db.context import global_tx, tenant_tx, user_tx
from ..db.util import iso_z, utcnow
from ..iam.security import ForbiddenError

log = logging.getLogger("wds.orgapi")
router = APIRouter()

_ORGS = "/api/v1/orgs"
_O = "/api/v1/orgs/{org}"

WEBHOOK_EVENTS = ("alarm_raised", "alarm_cleared",
                  "downtime_classified", "incident_opened")


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def _role(org_id: UUID, p) -> str:
    return _m()._effective_org_roles(p)[org_id]


def _need_owner(org_id: UUID, p) -> None:
    if _role(org_id, p) != "owner":
        raise ForbiddenError("owner role required")


# ---------------------------------------------------------------------------
# org list with lifecycle markers (§11 7.1 "suspended" marker; §5 1.6)
# ---------------------------------------------------------------------------
@router.get(_ORGS)
async def list_orgs(request: Request, p=Depends(_user)):
    """Member orgs of the caller, each with its plan + lifecycle state — the
    org switcher / suspended page reads this."""
    if p.user_id is None:
        raise ForbiddenError("a signed-in user is required")
    async with user_tx(_m().st(request).pools.app, p.user_id) as conn:
        rows = await conn.fetch(
            "SELECT o.id, o.name, o.slug, o.plan, o.suspended_at, o.deleted_at,"
            " m.role FROM organizations o"
            " JOIN memberships m ON m.org_id = o.id AND m.user_id = $1"
            " ORDER BY o.name", p.user_id)
    return {"items": [{
        "org_id": str(r["id"]), "name": r["name"], "slug": r["slug"],
        "plan": r["plan"], "role": r["role"],
        "suspended": r["suspended_at"] is not None,
        "deleted": r["deleted_at"] is not None,
    } for r in rows]}


# ---------------------------------------------------------------------------
# usage vs plan caps (§10 6.2 settings -> plan)
# ---------------------------------------------------------------------------
@router.get(_O + "/usage")
async def org_usage(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        out = await plans.usage_summary(tc, org_id)
    out["trial_ends_at"] = (iso_z(out["trial_ends_at"])
                            if out["trial_ends_at"] else None)
    return out


# ---------------------------------------------------------------------------
# sites (plan-capped create; the member list lives in main.py)
# ---------------------------------------------------------------------------
class SiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    timezone: str = "UTC"


@router.post(_O + "/sites", status_code=201)
async def create_site(org: str, body: SiteIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await plans.check_limit(tc, org_id, "max_sites")
        try:
            sid = await tc.fetchval(
                "INSERT INTO sites(org_id, name, code, timezone)"
                " VALUES ($1,$2,$3,$4) RETURNING id",
                org_id, body.name, body.code, body.timezone)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "site_code_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "site.created",
                           {"site_id": str(sid)}, {"name": body.name, "code": body.code})
    return {"site": {"id": str(sid), "name": body.name,
                     "code": body.code, "timezone": body.timezone}}


# ---------------------------------------------------------------------------
# leave / soft-delete / restore (§5 1.6, §12 8.3)
# ---------------------------------------------------------------------------
@router.post(_O + "/leave")
async def leave_org(org: str, request: Request, p=Depends(_user)):
    """A member leaves an org. The last owner cannot leave (§1.4 rule) —
    they must transfer ownership or delete the org."""
    m = _m()
    org_id = m._v2_org(org, p)
    if p.user_id is None:
        raise ForbiddenError("a signed-in user is required")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "SELECT role FROM memberships WHERE user_id=$1", p.user_id)
        if row is None:
            raise HTTPException(404, "not found")
        if row["role"] == "owner":
            owners = await tc.fetchval(
                "SELECT count(*) FROM memberships WHERE role='owner'")
            if owners <= 1:
                raise HTTPException(409, "org must keep at least one owner")
        await tc.execute("DELETE FROM memberships WHERE user_id=$1", p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "member.left",
                           {"user_id": str(p.user_id)}, {"role": row["role"]})
    m.st(request).auth.forget(p.sub)
    async with global_tx(m.st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "membership_changed", "sub": p.sub}))
    return {"org_id": str(org_id), "left": True}


@router.delete(_O)
async def delete_org(org: str, request: Request, p=Depends(_user)):
    """Owner-initiated soft delete (§1.6/8.3): the org becomes unreachable at
    once (OrgGuard 404s every tenant route), is restorable for
    ORG_PURGE_AFTER_DAYS days, then the org_purge job removes the rows."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    _need_owner(org_id, p)
    await m._mutation_gate(request, p.user_id)
    purge_at = utcnow() + timedelta(days=config.ORG_PURGE_AFTER_DAYS)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        n = await tc.execute(
            "UPDATE organizations SET deleted_at=now()"
            " WHERE id=$1 AND deleted_at IS NULL", org_id)
        if n == "UPDATE 0":
            raise HTTPException(404, "not found")
        await audit.append(tc, f"user:{p.user_id}", "org.deleted",
                           {"org_id": str(org_id)}, {"purge_at": iso_z(purge_at)})
        await jobs.enqueue(tc, "org_purge", {"org_id": str(org_id)},
                           org_id=org_id, run_at=purge_at, max_attempts=10)
    orgguard.forget(org_id)
    return {"org_id": str(org_id), "deleted": True, "purge_at": iso_z(purge_at)}


@router.post(_O + "/restore")
async def restore_org(org: str, request: Request, p=Depends(_user)):
    """Undo a soft delete inside the purge window. The OrgGuard lets this one
    POST through for a deleted org; the caller must still be an owner."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    _need_owner(org_id, p)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "SELECT deleted_at FROM organizations WHERE id=$1", org_id)
        if row is None or row["deleted_at"] is None:
            raise HTTPException(404, "not found")
        if row["deleted_at"] <= utcnow() - timedelta(days=config.ORG_PURGE_AFTER_DAYS):
            raise HTTPException(410, "purge window expired")
        await tc.execute(
            "UPDATE organizations SET deleted_at=NULL WHERE id=$1", org_id)
        await tc.execute(
            "DELETE FROM jobs WHERE org_id=$1 AND kind='org_purge'"
            " AND status='pending'", org_id)
        await audit.append(tc, f"user:{p.user_id}", "org.restored",
                           {"org_id": str(org_id)}, {})
    orgguard.forget(org_id)
    return {"org_id": str(org_id), "restored": True}


# ---------------------------------------------------------------------------
# owner data export (§12 8.2) — queued zip on the job runner
# ---------------------------------------------------------------------------
EXPORT_PENDING_MAX = 3


def _export_json(r) -> dict:
    return {"id": str(r["id"]), "status": r["status"],
            "size_bytes": r["size_bytes"],
            "created_at": iso_z(r["created_at"]),
            "ready_at": iso_z(r["ready_at"]) if r["ready_at"] else None,
            "expires_at": iso_z(r["expires_at"]) if r["expires_at"] else None}


class SecurityPatch(BaseModel):
    mfa_required: bool


@router.get(_O + "/security")
async def get_security(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        req = await tc.fetchval(
            "SELECT mfa_required FROM organizations WHERE id=$1", org_id)
    return {"mfa_required": bool(req), "you_have_mfa": p.acr == "mfa"}


@router.patch(_O + "/security")
async def patch_security(org: str, body: SecurityPatch, request: Request,
                         p=Depends(_user)):
    """Org-wide two-factor policy (spec 2026-10-19 §4). Turning it on needs
    the caller's own token to be acr=mfa, so an admin can't lock themselves
    out with a policy they can't satisfy."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    if p.kind == "apikey":
        raise ForbiddenError("service accounts cannot change security policy")
    m.step_up(p)
    if body.mfa_required and p.kind == "oidc" and p.acr != "mfa":
        raise HTTPException(401, "step_up_required")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await tc.execute("UPDATE organizations SET mfa_required=$2 WHERE id=$1",
                         org_id, body.mfa_required)
        await audit.append(tc, f"user:{p.user_id}", "mfa.policy_changed",
                           {"org_id": str(org_id)}, {"mfa_required": body.mfa_required})
    return {"mfa_required": body.mfa_required}


@router.post(_O + "/export", status_code=202)
async def request_export(org: str, request: Request, p=Depends(_user)):
    """Enqueue an export_zip job; the worker writes org data to EXPORT_DIR
    and flips this row to done. Owner-only (§8.2)."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    _need_owner(org_id, p)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        n = await tc.fetchval(
            "SELECT count(*) FROM org_exports WHERE status IN ('queued','running')")
        if n >= EXPORT_PENDING_MAX:
            raise HTTPException(429, "too many exports in flight")
        eid = uuid4()
        row = await tc.fetchrow(
            "INSERT INTO org_exports(id, org_id, requested_by)"
            " VALUES ($1,$2,$3) RETURNING *", eid, org_id, p.user_id)
        await jobs.enqueue(tc, "export_zip",
                           {"export_id": str(eid), "org_id": str(org_id)},
                           org_id=org_id)
        await audit.append(tc, f"user:{p.user_id}", "org.export_requested",
                           {"export_id": str(eid)}, {})
    return {"export": _export_json(row)}


@router.get(_O + "/exports")
async def list_exports(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM org_exports ORDER BY created_at DESC LIMIT 20")
    return {"items": [_export_json(r) for r in rows]}


@router.get(_O + "/exports/{export_id}/download")
async def download_export(org: str, export_id: str, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    _need_owner(org_id, p)
    eid = m._uuid_or_404(export_id, "export")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "SELECT * FROM org_exports WHERE id=$1", eid)
        if row is None or row["status"] != "done" or not row["file_path"]:
            raise HTTPException(404, "export not found")
        if row["expires_at"] and row["expires_at"] <= utcnow():
            raise HTTPException(410, "export expired")
        path = Path(row["file_path"]).resolve()
    # path was written by the worker under EXPORT_DIR/<org>/ — verify the
    # prefix so a tampered row can't read arbitrary disk
    if Path(config.EXPORT_DIR).resolve() not in path.parents:
        raise HTTPException(404, "export not found")
    if not path.is_file():
        raise HTTPException(404, "export file missing")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await audit.append(tc, f"user:{p.user_id}", "org.export_downloaded",
                           {"export_id": str(eid)}, {})
    return FileResponse(path, media_type="application/zip",
                        filename=f"wds-export-{org_id}.zip")


# ---------------------------------------------------------------------------
# ops reads (§11 7.3): feature flags + announcements + support sessions
# ---------------------------------------------------------------------------
@router.get(_O + "/feature-flags")
async def org_flags(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT flag, enabled FROM org_feature_flags ORDER BY flag")
    return {"flags": {r["flag"]: r["enabled"] for r in rows}}


@router.get(_O + "/announcements")
async def org_announcements(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, title, body, severity, starts_at, ends_at"
            " FROM announcements WHERE revoked_at IS NULL AND starts_at <= now()"
            " AND (ends_at IS NULL OR ends_at > now())"
            " ORDER BY severity DESC, starts_at DESC LIMIT 20")
    return {"items": [{"id": str(r["id"]), "title": r["title"], "body": r["body"],
                       "severity": r["severity"],
                       "starts_at": iso_z(r["starts_at"]),
                       "ends_at": iso_z(r["ends_at"]) if r["ends_at"] else None}
                      for r in rows]}


@router.get(_O + "/support-sessions")
async def org_support_sessions(org: str, request: Request, p=Depends(_user)):
    """The tenant's view of back-office support access (§11 7.2) — owners
    see who is in their org, why, and until when."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    _need_owner(org_id, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT s.id, s.reason, s.read_only, s.created_at, s.expires_at,"
            " s.revoked_at, u.display_name, u.sub FROM support_sessions s"
            " LEFT JOIN users u ON u.id = s.admin_user_id"
            " ORDER BY s.created_at DESC LIMIT 50")
    return {"items": [{
        "id": str(r["id"]), "admin": r["display_name"] or r["sub"],
        "reason": r["reason"], "read_only": r["read_only"],
        "created_at": iso_z(r["created_at"]),
        "expires_at": iso_z(r["expires_at"]),
        "active": r["revoked_at"] is None and r["expires_at"] > utcnow(),
    } for r in rows]}


# ---------------------------------------------------------------------------
# outbound webhooks (§9 5.5) — secret write-only, signed deliveries
# ---------------------------------------------------------------------------
class WebhookIn(BaseModel):
    url: str = Field(min_length=8, max_length=1000)
    events: list[str] = Field(min_length=1)
    enabled: bool = True
    secret: str | None = Field(default=None, min_length=16, max_length=200)

    @field_validator("url")
    @classmethod
    def _http(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("url must be http(s)")
        return v

    @field_validator("events")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        bad = [e for e in v if e not in WEBHOOK_EVENTS]
        if bad:
            raise ValueError(f"unknown events: {bad}")
        return v


class WebhookPatch(BaseModel):
    url: str | None = Field(default=None, min_length=8, max_length=1000)
    events: list[str] | None = None
    enabled: bool | None = None
    secret: str | None = Field(default=None, min_length=16, max_length=200)


def _webhook_json(r) -> dict:
    return {"id": str(r["id"]), "url": r["url"], "events": r["events"],
            "enabled": r["enabled"], "created_at": iso_z(r["created_at"]),
            "updated_at": iso_z(r["updated_at"])}


@router.get(_O + "/webhooks")
async def list_webhooks(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, org_id, url, events, enabled, created_by, created_at,"
            " updated_at FROM webhook_endpoints ORDER BY created_at LIMIT 100")
    return {"items": [_webhook_json(r) for r in rows]}


@router.post(_O + "/webhooks", status_code=201)
async def create_webhook(org: str, body: WebhookIn, request: Request,
                         p=Depends(_user)):
    """Register an endpoint. The signing secret is returned ONCE (like API
    keys); the DB stores it sealed and no SELECT grant ever reads it back."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    secret = body.secret or secrets.token_hex(32)
    enc = secretbox.seal({"secret": secret})
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT count(*) FROM webhook_endpoints") >= 25:
            raise HTTPException(409, "webhook endpoint limit reached")
        row = await tc.fetchrow(
            "INSERT INTO webhook_endpoints(org_id, url, secret_enc, events,"
            " enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6)"
            " RETURNING id, org_id, url, events, enabled, created_at, updated_at",
            org_id, body.url, enc, body.events, body.enabled, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "webhook.created",
                           {"endpoint_id": str(row["id"])},
                           {"url": body.url, "events": body.events})
    return {"webhook": _webhook_json(row), "secret": secret}


@router.patch(_O + "/webhooks/{endpoint_id}")
async def patch_webhook(org: str, endpoint_id: str, body: WebhookPatch,
                        request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    eid = m._uuid_or_404(endpoint_id, "webhook")
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(400, "invalid_request: nothing to update")
    if "url" in ch and not ch["url"].startswith(("http://", "https://")):
        raise HTTPException(422, "url must be http(s)")
    if "events" in ch:
        bad = [e for e in (ch["events"] or []) if e not in WEBHOOK_EVENTS]
        if bad or not ch["events"]:
            raise HTTPException(422, f"unknown events: {bad}")
    await m._mutation_gate(request, p.user_id)
    new_secret = ch.get("secret")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow(
            "SELECT id FROM webhook_endpoints WHERE id=$1", eid)
        if cur is None:
            raise HTTPException(404, "webhook not found")
        sets, args = [], []
        for f, col in (("url", "url"), ("events", "events"), ("enabled", "enabled")):
            if f in ch and ch[f] is not None:
                args.append(ch[f]); sets.append(f"{col}=${len(args)}")
        if new_secret:
            args.append(secretbox.seal({"secret": new_secret}))
            sets.append(f"secret_enc=${len(args)}")
        args.append(eid)
        row = await tc.fetchrow(
            f"UPDATE webhook_endpoints SET {', '.join(sets)}, updated_at=now()"
            f" WHERE id=${len(args)} RETURNING id, org_id, url, events, enabled,"
            " created_at, updated_at", *args)
        await audit.append(tc, f"user:{p.user_id}", "webhook.updated",
                           {"endpoint_id": str(eid)},
                           {"fields": sorted(k for k in ch if k != "secret")
                            + (["secret"] if new_secret else [])})
    out = {"webhook": _webhook_json(row)}
    if new_secret:
        out["secret"] = new_secret
    return out


@router.delete(_O + "/webhooks/{endpoint_id}", status_code=204)
async def delete_webhook(org: str, endpoint_id: str, request: Request,
                         p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    eid = m._uuid_or_404(endpoint_id, "webhook")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM webhook_endpoints WHERE id=$1 RETURNING id", eid)
        if gone is None:
            raise HTTPException(404, "webhook not found")
        await audit.append(tc, f"user:{p.user_id}", "webhook.deleted",
                           {"endpoint_id": str(eid)}, {})
    return Response(status_code=204)


@router.get(_O + "/webhook-deliveries")
async def webhook_deliveries(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, endpoint_id, event, status, attempts, last_code,"
            " last_error, at FROM webhook_deliveries"
            " ORDER BY at DESC LIMIT 200")
    return {"items": [{
        "id": r["id"], "endpoint_id": str(r["endpoint_id"]),
        "event": r["event"], "status": r["status"], "attempts": r["attempts"],
        "last_code": r["last_code"], "last_error": r["last_error"],
        "at": iso_z(r["at"])} for r in rows]}


# ---------------------------------------------------------------------------
# per-org OpenAPI document (§9 5.5 public API docs for API-key users)
# ---------------------------------------------------------------------------
@router.get(_O + "/openapi.json")
async def org_openapi(org: str, request: Request, p=Depends(_user)):
    """The tenant's public REST surface as OpenAPI: every
    /api/v1/orgs/{org}/... route plus /api/v1/me — nothing internal (edge
    capability URLs, platform back-office, auth plumbing)."""
    m = _m()
    m._v2_org(org, p)
    spec = request.app.openapi() or {}
    keep = {path for path in spec.get("paths", {})
            if path.startswith("/api/v1/orgs/{org}/")
            or path == "/api/v1/me"}
    return {**spec,
            "info": {**spec.get("info", {}),
                     "title": "WDS tenant API",
                     "description": "Authenticate with a wds_sk_ API key"
                                    " (Authorization: Bearer)."},
            "paths": {k: v for k, v in spec["paths"].items() if k in keep}}
