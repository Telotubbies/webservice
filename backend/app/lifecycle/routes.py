"""Lifecycle API (F20): policies, archive manifest, deletion certificates (platform staff)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z
from ..tenancy.platform import _admin

router = APIRouter()


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


@router.get("/api/v1/orgs/{org}/lifecycle")
async def lifecycle(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        policy = await tc.fetch("SELECT data_class, default_days, enabled FROM retention_policy ORDER BY data_class")
        archives = await tc.fetch("SELECT month, row_count, sha256, verified_at FROM archive_manifest ORDER BY month DESC LIMIT 60")
        plan = await tc.fetchval("SELECT plan FROM organizations WHERE id=$1", org_id)
        hist_days = await tc.fetchval("SELECT retention_days FROM plans WHERE code=$1", plan)
    return {"history_days": hist_days,
            "policy": [dict(r) for r in policy],
            "archives": [{"month": str(r["month"]), "rows": r["row_count"], "sha256": r["sha256"],
                          "verified_at": iso_z(r["verified_at"])} for r in archives]}


@router.get("/api/v1/platform/deletion-certificates")
async def certificates(request: Request, _p=Depends(_admin)):
    s = _m().st(request)
    async with global_tx(s.pools.system) as conn:
        rows = await conn.fetch("SELECT * FROM org_deletion_certificate ORDER BY id DESC LIMIT 200")
    return {"items": [{**dict(r), "deleted_at": iso_z(r["deleted_at"]) if r["deleted_at"] else None,
                       "purged_at": iso_z(r["purged_at"])} for r in rows]}
