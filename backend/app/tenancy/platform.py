"""Platform back-office (roadmap §11 7.1–7.3) — WDS staff only.

Every route runs behind :func:`_admin` (platform_admins row for the caller,
checked per request on the app pool so revoking a row takes effect on the
next call). Cross-tenant reads/writes go through the SYSTEM pool — the
admin holds no membership in the tenant orgs, so RLS tenant_isolation would
hide everything; the system role's org-list/update policies exist exactly
for this surface.

Routes: tenant list + detail with usage and edge health, plan/limit/trial
patching, suspend/restore, support sessions (issue/list/revoke + read-only
org snapshot), feature flags, announcements, platform health.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..core import config
from ..iam import orgguard
from ..iam.auth import Principal
from ..db import audit
from ..db.context import global_tx, tenant_tx, user_tx
from ..db.util import iso_z, utcnow
from ..iam.security import ForbiddenError

log = logging.getLogger("wds.platform")
router = APIRouter()

_P = "/api/v1/platform"
PLANS = ("trial", "starter", "pro", "enterprise")


def _m():
    from .. import main
    return main


async def _admin(request: Request) -> Principal:
    """Any verified caller whose user_id is on platform_admins."""
    p = await _m().require_user(request)
    if p.user_id is None:
        raise ForbiddenError("a signed-in user is required")
    try:
        async with user_tx(_m().st(request).pools.app, p.user_id) as conn:
            row = await conn.fetchrow(
                "SELECT user_id FROM platform_admins WHERE user_id=$1",
                p.user_id)
    except Exception:  # noqa: BLE001 — fail closed
        raise ForbiddenError("platform admin store unavailable") from None
    if row is None:
        raise ForbiddenError("platform admin required")
    return p


def _org404(org: str):
    m = _m()
    return m._uuid_or_404(org, "organization")


def _org_json(r) -> dict:
    return {"id": str(r["id"]), "name": r["name"], "slug": r["slug"],
            "plan": r["plan"], "plan_limits": r["plan_limits"],
            "trial_ends_at": iso_z(r["trial_ends_at"]) if r["trial_ends_at"] else None,
            "suspended": r["suspended_at"] is not None,
            "suspended_reason": r["suspended_reason"],
            "deleted": r["deleted_at"] is not None,
            "deleted_at": iso_z(r["deleted_at"]) if r["deleted_at"] else None,
            "created_at": iso_z(r["created_at"])}


_ORG_COLS = ("id, name, slug, plan, plan_limits, timezone, created_at,"
             " trial_ends_at, suspended_at, suspended_reason, deleted_at")


async def _org_row(system_pool, org_id: UUID):
    async with global_tx(system_pool) as conn:
        return await conn.fetchrow(
            f"SELECT {_ORG_COLS} FROM organizations WHERE id=$1", org_id)


async def _org_usage(system_pool, org_id: UUID) -> dict:
    """Counts for one tenant — inside tenant_tx so RLS stays the boundary."""
    from . import plans
    async with tenant_tx(system_pool, org_id) as tc:
        try:
            return await plans.usage_summary(tc, org_id)
        except HTTPException:
            return {"usage": {}}


async def _edge_health(system_pool, org_id: UUID) -> dict:
    async with tenant_tx(system_pool, org_id) as tc:
        return dict(await tc.fetchrow(
            "SELECT count(*) FILTER (WHERE status='active') AS active,"
            " count(*) FILTER (WHERE status='pending') AS pending,"
            " count(*) FILTER (WHERE status='disabled') AS disabled,"
            " count(*) FILTER (WHERE status='active' AND last_hb_at >"
            "   now() - interval '2 minutes') AS online,"
            " max(last_hb_at) AS last_hb_at FROM edges"))


async def _last_activity(system_pool, org_id: UUID):
    async with tenant_tx(system_pool, org_id) as tc:
        return await tc.fetchval("SELECT max(at) FROM audit_log")


# ---------------------------------------------------------------------------
# 7.1 tenant management
# ---------------------------------------------------------------------------
@router.get(_P + "/orgs")
async def platform_orgs(request: Request, _p=Depends(_admin)):
    """All orgs with plan, usage, last activity and edge health (§7.1)."""
    s = _m().st(request)
    async with global_tx(s.pools.system) as conn:
        orgs = await conn.fetch(
            f"SELECT {_ORG_COLS} FROM organizations"
            " ORDER BY created_at DESC LIMIT 500")
    items = []
    for o in orgs:
        usage = await _org_usage(s.pools.system, o["id"])
        health = await _edge_health(s.pools.system, o["id"])
        last = await _last_activity(s.pools.system, o["id"])
        items.append({**_org_json(o),
                      "usage": usage.get("usage", {}),
                      "edge_health": {
                          "active": health.get("active", 0),
                          "online": health.get("online", 0),
                          "last_hb_at": iso_z(health.get("last_hb_at"))
                          if health.get("last_hb_at") else None},
                      "last_activity_at": iso_z(last) if last else None})
    return {"items": items}


@router.get(_P + "/orgs/{org}")
async def platform_org_detail(org: str, request: Request, _p=Depends(_admin)):
    s = _m().st(request)
    org_id = _org404(org)
    row = await _org_row(s.pools.system, org_id)
    if row is None:
        raise HTTPException(404, "not found")
    usage = await _org_usage(s.pools.system, org_id)
    health = await _edge_health(s.pools.system, org_id)
    async with tenant_tx(s.pools.system, org_id) as tc:
        members = await tc.fetch(
            "SELECT m.user_id, m.role, u.sub, u.display_name, u.email"
            " FROM memberships m JOIN users u ON u.id = m.user_id"
            " WHERE u.sub NOT LIKE 'svc:%' ORDER BY m.role LIMIT 200")
        sessions = await tc.fetch(
            "SELECT id, reason, read_only, created_at, expires_at, revoked_at"
            " FROM support_sessions ORDER BY created_at DESC LIMIT 20")
    return {"org": _org_json(row), "usage": usage,
            "edge_health": {k: (iso_z(v) if k == "last_hb_at" and v else v)
                            for k, v in health.items()},
            "members": [{"user_id": str(r["user_id"]), "role": r["role"],
                         "sub": r["sub"], "name": r["display_name"],
                         "email": r["email"]} for r in members],
            "support_sessions": [{
                "id": str(r["id"]), "reason": r["reason"],
                "read_only": r["read_only"],
                "created_at": iso_z(r["created_at"]),
                "expires_at": iso_z(r["expires_at"]),
                "active": r["revoked_at"] is None and r["expires_at"] > utcnow(),
            } for r in sessions]}


class OrgPatch(BaseModel):
    plan: str | None = None
    limits: dict | None = None          # merged into plan_limits (null removes a key)
    trial_ends_at: str | None = None    # ISO timestamp; "" clears


@router.patch(_P + "/orgs/{org}")
async def platform_patch_org(org: str, body: OrgPatch, request: Request,
                             p=Depends(_admin)):
    """Set plan by hand / custom limits / extend a trial (§7.1 + §10 M1:
    pilots are invoiced manually — the plan is set here, not via checkout)."""
    s = _m().st(request)
    org_id = _org404(org)
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(400, "invalid_request: nothing to update")
    if "plan" in ch and ch["plan"] not in PLANS:
        raise HTTPException(422, f"plan must be one of {PLANS}")
    from ..db.util import parse_ts
    trial = None
    if "trial_ends_at" in ch:
        try:
            trial = parse_ts(ch["trial_ends_at"]) if ch["trial_ends_at"] else None
        except ValueError:
            raise HTTPException(422, "invalid trial_ends_at") from None
    async with global_tx(s.pools.system) as conn:
        if await conn.fetchval("SELECT 1 FROM organizations WHERE id=$1",
                               org_id) is None:
            raise HTTPException(404, "not found")
        if "limits" in ch:
            # merge into plan_limits; JSON null deletes the override key
            new_limits = dict((await conn.fetchval(
                "SELECT plan_limits FROM organizations WHERE id=$1", org_id)) or {})
            for k, v in (ch["limits"] or {}).items():
                if v is None:
                    new_limits.pop(k, None)
                else:
                    new_limits[k] = v
            await conn.execute(
                "UPDATE organizations SET plan_limits=$2 WHERE id=$1",
                org_id, new_limits)
        if "plan" in ch:
            await conn.execute(
                "UPDATE organizations SET plan=$2 WHERE id=$1", org_id, ch["plan"])
        if "trial_ends_at" in ch:
            await conn.execute(
                "UPDATE organizations SET trial_ends_at=$2 WHERE id=$1",
                org_id, trial)
    orgguard.forget(org_id)
    async with tenant_tx(s.pools.system, org_id) as tc:
        await audit.append(tc, f"platform:{p.user_id}", "platform.org_patched",
                           {"org_id": str(org_id)},
                           {k: ("<merged>" if k == "limits" else v)
                            for k, v in ch.items()})
    return {"org_id": str(org_id), "patched": sorted(ch)}


class SuspendIn(BaseModel):
    reason: str = Field(default="", max_length=500)


@router.post(_P + "/orgs/{org}/suspend")
async def platform_suspend(org: str, body: SuspendIn, request: Request,
                           p=Depends(_admin)):
    """Suspend: member writes and commands refuse (OrgGuard 403s), reads and
    the gateway link keep working (§7.1 acceptance)."""
    s = _m().st(request)
    org_id = _org404(org)
    async with global_tx(s.pools.system) as conn:
        n = await conn.execute(
            "UPDATE organizations SET suspended_at=now(), suspended_reason=$2"
            " WHERE id=$1 AND suspended_at IS NULL AND deleted_at IS NULL",
            org_id, body.reason or None)
        if n == "UPDATE 0":
            raise HTTPException(409, "org already suspended or deleted")
    orgguard.forget(org_id)
    async with tenant_tx(s.pools.system, org_id) as tc:
        await audit.append(tc, f"platform:{p.user_id}", "platform.org_suspended",
                           {"org_id": str(org_id)}, {"reason": body.reason})
    return {"org_id": str(org_id), "suspended": True}


@router.post(_P + "/orgs/{org}/unsuspend")
async def platform_unsuspend(org: str, request: Request, p=Depends(_admin)):
    s = _m().st(request)
    org_id = _org404(org)
    async with global_tx(s.pools.system) as conn:
        n = await conn.execute(
            "UPDATE organizations SET suspended_at=NULL, suspended_reason=NULL"
            " WHERE id=$1 AND suspended_at IS NOT NULL", org_id)
        if n == "UPDATE 0":
            raise HTTPException(409, "org is not suspended")
    orgguard.forget(org_id)
    async with tenant_tx(s.pools.system, org_id) as tc:
        await audit.append(tc, f"platform:{p.user_id}", "platform.org_unsuspended",
                           {"org_id": str(org_id)}, {})
    return {"org_id": str(org_id), "suspended": False}


# ---------------------------------------------------------------------------
# 7.2 support access — time-boxed, reasoned, read-only, audited in-tenant
# ---------------------------------------------------------------------------
class SupportSessionIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    minutes: int = Field(default=60, ge=5, le=60)   # DB caps expires_at at +1h


def _session_json(r) -> dict:
    return {"id": str(r["id"]), "org_id": str(r["org_id"]),
            "reason": r["reason"], "read_only": r["read_only"],
            "created_at": iso_z(r["created_at"]),
            "expires_at": iso_z(r["expires_at"]),
            "revoked_at": iso_z(r["revoked_at"]) if r["revoked_at"] else None,
            "active": r["revoked_at"] is None and r["expires_at"] > utcnow()}


@router.post(_P + "/orgs/{org}/support-sessions", status_code=201)
async def issue_support_session(org: str, body: SupportSessionIn,
                                request: Request, p=Depends(_admin)):
    """Open a support window into a tenant. Written to the TENANT's audit
    log immediately — the owner sees it without us telling them (§7.2)."""
    s = _m().st(request)
    org_id = _org404(org)
    if await _org_row(s.pools.system, org_id) is None:
        raise HTTPException(404, "not found")
    expires = utcnow() + timedelta(minutes=body.minutes)
    async with tenant_tx(s.pools.system, org_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO support_sessions(org_id, admin_user_id, reason,"
            " read_only, expires_at) VALUES ($1,$2,$3,true,$4) RETURNING *",
            org_id, p.user_id, body.reason, expires)
        await audit.append(tc, f"platform:{p.user_id}",
                           "platform.support_session_started",
                           {"session_id": str(row["id"])},
                           {"reason": body.reason, "minutes": body.minutes})
    return {"session": _session_json(row)}


@router.get(_P + "/support-sessions")
async def list_support_sessions(request: Request, _p=Depends(_admin),
                                active: bool = False):
    s = _m().st(request)
    async with global_tx(s.pools.system) as conn:
        rows = await conn.fetch(
            "SELECT s.*, o.name AS org_name FROM support_sessions s"
            " LEFT JOIN organizations o ON o.id = s.org_id"
            " WHERE ($1::bool IS FALSE OR (s.revoked_at IS NULL"
            "       AND s.expires_at > now()))"
            " ORDER BY s.created_at DESC LIMIT 200", active)
    return {"items": [{**_session_json(r), "org_name": r["org_name"]}
                      for r in rows]}


@router.delete(_P + "/support-sessions/{session_id}", status_code=204)
async def revoke_support_session(session_id: str, request: Request,
                                 p=Depends(_admin)):
    s = _m().st(request)
    sid = _m()._uuid_or_404(session_id, "session")
    async with global_tx(s.pools.system) as conn:
        row = await conn.fetchrow(
            "UPDATE support_sessions SET revoked_at=now() WHERE id=$1"
            " AND revoked_at IS NULL RETURNING org_id", sid)
    if row is None:
        raise HTTPException(404, "session not found")
    async with tenant_tx(s.pools.system, row["org_id"]) as tc:
        await audit.append(tc, f"platform:{p.user_id}",
                           "platform.support_session_revoked",
                           {"session_id": str(sid)}, {})


@router.get(_P + "/support-sessions/{session_id}/org-data")
async def support_org_snapshot(session_id: str, request: Request,
                               p=Depends(_admin)):
    """The ONLY thing a support session opens: a read-only snapshot of the
    tenant (members, usage, edges). No mutation route accepts a session —
    read-only is structural, not a flag the admin can flip (§7.2)."""
    s = _m().st(request)
    sid = _m()._uuid_or_404(session_id, "session")
    async with global_tx(s.pools.system) as conn:
        sess = await conn.fetchrow(
            "SELECT * FROM support_sessions WHERE id=$1"
            " AND admin_user_id=$2 AND revoked_at IS NULL"
            " AND expires_at > now()", sid, p.user_id)
    if sess is None:
        raise HTTPException(404, "session not found or expired")
    org_id = sess["org_id"]
    row = await _org_row(s.pools.system, org_id)
    usage = await _org_usage(s.pools.system, org_id)
    health = await _edge_health(s.pools.system, org_id)
    async with tenant_tx(s.pools.system, org_id) as tc:
        members = await tc.fetch(
            "SELECT m.role, u.display_name, u.sub FROM memberships m"
            " JOIN users u ON u.id = m.user_id"
            " WHERE u.sub NOT LIKE 'svc:%' ORDER BY m.role LIMIT 200")
        await audit.append(tc, f"platform:{p.user_id}",
                           "platform.support_session_read",
                           {"session_id": str(sid)},
                           {"resource": "org-data"})
    return {"org": _org_json(row) if row else None, "usage": usage,
            "edge_health": {k: (iso_z(v) if k == "last_hb_at" and v else v)
                            for k, v in health.items()},
            "members": [{"role": r["role"], "name": r["display_name"],
                         "sub": r["sub"]} for r in members],
            "session": _session_json(sess)}


# ---------------------------------------------------------------------------
# 7.3 operations — feature flags, announcements, platform health
# ---------------------------------------------------------------------------
class FlagsIn(BaseModel):
    flags: dict[str, bool]


@router.get(_P + "/orgs/{org}/feature-flags")
async def platform_get_flags(org: str, request: Request, _p=Depends(_admin)):
    s = _m().st(request)
    org_id = _org404(org)
    async with tenant_tx(s.pools.system, org_id) as tc:
        rows = await tc.fetch(
            "SELECT flag, enabled FROM org_feature_flags ORDER BY flag")
    return {"flags": {r["flag"]: r["enabled"] for r in rows}}


@router.put(_P + "/orgs/{org}/feature-flags")
async def platform_set_flags(org: str, body: FlagsIn, request: Request,
                             p=Depends(_admin)):
    """Replace the org's flag map: keys in `flags` upsert, absent keys delete."""
    s = _m().st(request)
    org_id = _org404(org)
    for f in body.flags:
        if not f or len(f) > 60:
            raise HTTPException(422, "invalid flag name")
    async with tenant_tx(s.pools.system, org_id) as tc:
        for flag, enabled in body.flags.items():
            await tc.execute(
                "INSERT INTO org_feature_flags(org_id, flag, enabled)"
                " VALUES ($1,$2,$3)"
                " ON CONFLICT (org_id, flag) DO UPDATE SET"
                " enabled=EXCLUDED.enabled, updated_at=now()",
                org_id, flag, enabled)
        if body.flags:
            await tc.execute(
                "DELETE FROM org_feature_flags WHERE NOT (flag = ANY($1::text[]))",
                org_id, list(body.flags))
        else:
            await tc.execute("DELETE FROM org_feature_flags")
        await audit.append(tc, f"platform:{p.user_id}",
                           "platform.flags_set", {"org_id": str(org_id)},
                           {"flags": body.flags})
    return {"flags": body.flags}


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=2000)
    severity: str = "info"
    org_id: UUID | None = None        # None = every tenant
    ends_at: str | None = None


@router.get(_P + "/announcements")
async def platform_list_announcements(request: Request, _p=Depends(_admin)):
    s = _m().st(request)
    async with global_tx(s.pools.system) as conn:
        rows = await conn.fetch(
            "SELECT a.*, o.name AS org_name FROM announcements a"
            " LEFT JOIN organizations o ON o.id = a.org_id"
            " ORDER BY a.created_at DESC LIMIT 100")
    return {"items": [{
        "id": str(r["id"]), "title": r["title"], "body": r["body"],
        "severity": r["severity"], "org_id": str(r["org_id"]) if r["org_id"] else None,
        "org_name": r["org_name"],
        "starts_at": iso_z(r["starts_at"]),
        "ends_at": iso_z(r["ends_at"]) if r["ends_at"] else None,
        "revoked": r["revoked_at"] is not None} for r in rows]}


@router.post(_P + "/announcements", status_code=201)
async def platform_create_announcement(body: AnnouncementIn, request: Request,
                                       p=Depends(_admin)):
    s = _m().st(request)
    if body.severity not in ("info", "warning", "critical"):
        raise HTTPException(422, "severity must be info|warning|critical")
    from ..db.util import parse_ts
    ends = None
    if body.ends_at:
        try:
            ends = parse_ts(body.ends_at)
        except ValueError:
            raise HTTPException(422, "invalid ends_at") from None
    async with global_tx(s.pools.system) as conn:
        row = await conn.fetchrow(
            "INSERT INTO announcements(org_id, title, body, severity, ends_at,"
            " created_by) VALUES ($1,$2,$3,$4,$5,$6)"
            " RETURNING id, created_at, starts_at",
            body.org_id, body.title, body.body, body.severity, ends, p.user_id)
    if body.org_id:
        async with tenant_tx(s.pools.system, body.org_id) as tc:
            await audit.append(tc, f"platform:{p.user_id}",
                               "platform.announcement_posted",
                               {"announcement_id": str(row["id"])},
                               {"title": body.title})
    return {"id": str(row["id"]), "created_at": iso_z(row["created_at"]),
            "starts_at": iso_z(row["starts_at"])}


@router.delete(_P + "/announcements/{ann_id}", status_code=204)
async def platform_revoke_announcement(ann_id: str, request: Request,
                                       _p=Depends(_admin)):
    s = _m().st(request)
    aid = _m()._uuid_or_404(ann_id, "announcement")
    async with global_tx(s.pools.system) as conn:
        n = await conn.execute(
            "UPDATE announcements SET revoked_at=now() WHERE id=$1"
            " AND revoked_at IS NULL", aid)
    if n == "UPDATE 0":
        raise HTTPException(404, "announcement not found")


@router.get(_P + "/health")
async def platform_health(request: Request, _p=Depends(_admin)):
    """Ops health (§7.3): ingest counters, notification delivery rates
    (notification_deliveries when present), job queue depth + dead jobs."""
    s = _m().st(request)
    out: dict = {"counters": dict(s.counters)}
    async with global_tx(s.pools.system) as conn:
        jobs_row = await conn.fetchrow(
            "SELECT count(*) FILTER (WHERE status='pending') AS pending,"
            " count(*) FILTER (WHERE status='running') AS running,"
            " count(*) FILTER (WHERE status='dead') AS dead,"
            " count(*) FILTER (WHERE status='done'"
            "   AND done_at > now() - interval '1 hour') AS done_last_hour"
            " FROM jobs")
        out["jobs"] = dict(jobs_row)
        has_deliveries = await conn.fetchval(
            "SELECT to_regclass('public.notification_deliveries') IS NOT NULL")
        if has_deliveries:
            out["notification_deliveries_1h"] = dict(await conn.fetchrow(
                "SELECT count(*) FILTER (WHERE status='sent') AS sent,"
                " count(*) FILTER (WHERE status='failed') AS failed,"
                " count(*) FILTER (WHERE status='retrying') AS retrying,"
                " count(*) FILTER (WHERE status='suppressed') AS suppressed"
                " FROM notification_deliveries"
                " WHERE created_at > now() - interval '1 hour'"))
        out["orgs"] = dict(await conn.fetchrow(
            "SELECT count(*) AS total,"
            " count(*) FILTER (WHERE suspended_at IS NOT NULL) AS suspended,"
            " count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted"
            " FROM organizations"))
        out["support_sessions_active"] = await conn.fetchval(
            "SELECT count(*) FROM support_sessions WHERE revoked_at IS NULL"
            " AND expires_at > now()")
    out["mqtt_connected"] = s.mqtt.connected
    return out
