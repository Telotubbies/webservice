from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from ..db.context import tenant_tx
from ..db.util import iso_z, utcnow
from .oee import _DT_EV, _dt_event_json

router = APIRouter()

_LIMIT = 100


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


@router.get("/api/v1/orgs/{org}/sites/{site}/downtime-events/{dt}/context")
async def dt_context(org: str, site: str, dt: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    dtid = m._uuid_or_404(dt, "downtime")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        row = await tc.fetchrow(
            _DT_EV + " WHERE d.id=$1 AND d.site_id=$2 AND d.kind='stop'", dtid, site_id)
        if row is None:
            raise HTTPException(404, "downtime not found")
        t_from = row["starts_at"]
        t_to = row["ends_at"] or utcnow()
        if t_to <= t_from:
            t_to = t_from + timedelta(seconds=1)
        tag = await tc.fetchrow(
            "SELECT t.id, t.path, t.name, t.unit"
            " FROM machine_state_map mm"
            " JOIN tags t ON t.org_id=mm.org_id AND t.id=mm.state_tag_id"
            " WHERE mm.device_id=$1 AND mm.site_id=$2", row["device_id"], site_id)
        alarms = await tc.fetch(
            "SELECT a.id, t.path AS tag, COALESCE(r.name, a.rule_name) AS rule,"
            " a.severity, a.state, a.raised_at, a.cleared_at"
            " FROM alarms a"
            " JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id"
            " LEFT JOIN alarm_rules r ON r.org_id=a.org_id AND r.tag_id=a.tag_id AND r.id=a.rule_id"
            " WHERE t.site_id=$1 AND t.device_id=$2"
            " AND a.raised_at <= $3 AND (a.cleared_at IS NULL OR a.cleared_at >= $4)"
            " ORDER BY a.raised_at DESC, a.id DESC LIMIT $5",
            site_id, row["device_id"], t_to, t_from, _LIMIT + 1)
    return {
        "downtime": _dt_event_json(row),
        "from": iso_z(t_from), "to": iso_z(t_to),
        "tag": ({"id": str(tag["id"]), "path": tag["path"], "name": tag["name"],
                 "unit": tag["unit"]} if tag else None),
        "alarms": [{"id": str(r["id"]), "tag": r["tag"], "rule": r["rule"],
                    "severity": r["severity"], "state": r["state"],
                    "raised_at": iso_z(r["raised_at"]),
                    "cleared_at": iso_z(r["cleared_at"]) if r["cleared_at"] else None}
                   for r in alarms[:_LIMIT]],
        "truncated": len(alarms) > _LIMIT,
    }
