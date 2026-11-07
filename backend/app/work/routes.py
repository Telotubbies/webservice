"""My work: one read that gathers what a person can act on right now.

Open alarms already stream over the websocket, so this returns the two lists
that do not: machine stops with no reason, and truck decisions (material
events) nobody has reviewed. Acting on an item uses the existing endpoints
(classify / review / ack); this module only reads.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..db.context import tenant_tx
from ..db.util import iso_z
from ..production.oee import _DT_EV, _dt_event_json

router = APIRouter()

_LIMIT = 100


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


@router.get("/api/v1/orgs/{org}/sites/{site}/my-work")
async def my_work(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        stops = await tc.fetch(
            _DT_EV + " WHERE d.site_id=$1 AND d.kind='stop' AND d.needs_reason"
            " ORDER BY d.starts_at DESC LIMIT $2", site_id, _LIMIT)
        # uncertain decisions first: they are the ones a person must look at
        reviews = await tc.fetch(
            "SELECT e.id, e.camera_id, c.name AS camera, e.fired_at, e.detail"
            " FROM vision_events e JOIN cameras c ON c.org_id=e.org_id AND c.id=e.camera_id"
            " LEFT JOIN vision_event_reviews rv ON rv.event_id=e.id"
            " WHERE e.kind='material' AND rv.event_id IS NULL"
            " AND e.fired_at > now() - interval '7 days'"
            " ORDER BY (e.detail->>'uncertain' = 'true') DESC, e.fired_at DESC LIMIT $1", _LIMIT)
    return {
        "downtimes": [_dt_event_json(r) for r in stops],
        "reviews": [{"id": str(r["id"]), "camera_id": str(r["camera_id"]), "camera": r["camera"],
                     "fired_at": iso_z(r["fired_at"]),
                     "detail": r["detail"] if isinstance(r["detail"], dict) else {}} for r in reviews],
    }
