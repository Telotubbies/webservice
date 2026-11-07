"""Per-site AI approval (F21). AI may write to a PLC from a site only while a person has armed it:
plan flag ai_plc_write AND an unrevoked site_ai_arming row. Arming needs step-up, an evidence
reference (what was reviewed in dry-run), and lands in the audit chain. Dry-run stays the default:
arming does not switch dry_run off on any rule or the material decision.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()
_P = "/api/v1/orgs/{org}/sites/{site}/ai-arming"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class ArmIn(BaseModel):
    evidence_ref: str = Field(min_length=3, max_length=500)


def _json(r) -> dict | None:
    if r is None:
        return None
    return {"id": str(r["id"]), "armed_by": str(r["armed_by"]), "armed_at": iso_z(r["armed_at"]),
            "evidence_ref": r["evidence_ref"]}


@router.get(_P)
async def get_arming(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        r = await tc.fetchrow("SELECT * FROM site_ai_arming WHERE site_id=$1 AND revoked_at IS NULL", site_id)
    return {"armed": r is not None, "arming": _json(r)}


@router.post(_P, status_code=201)
async def arm(org: str, site: str, body: ArmIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    from ..deps import step_up
    step_up(p)                                   # a fresh sign-in, not a stale session
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id) is None:
            raise HTTPException(404, "site not found")
        if await tc.fetchval("SELECT 1 FROM site_ai_arming WHERE site_id=$1 AND revoked_at IS NULL", site_id):
            raise HTTPException(409, "already_armed")
        r = await tc.fetchrow("INSERT INTO site_ai_arming(org_id, site_id, armed_by, evidence_ref) VALUES ($1,$2,$3,$4) RETURNING *",
                              org_id, site_id, p.user_id, body.evidence_ref)
        await audit.append(tc, f"user:{p.user_id}", "ai.site.armed", {"site_id": str(site_id)},
                           {"evidence_ref": body.evidence_ref})
    return {"arming": _json(r)}


@router.delete(_P, status_code=204)
async def disarm(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("UPDATE site_ai_arming SET revoked_at=now(), revoked_by=$2 WHERE site_id=$1 AND revoked_at IS NULL RETURNING 1",
                             site_id, p.user_id) is None:
            raise HTTPException(404, "not armed")
        await audit.append(tc, f"user:{p.user_id}", "ai.site.disarmed", {"site_id": str(site_id)}, {})
