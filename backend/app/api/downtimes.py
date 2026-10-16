"""v2 admin API: downtimes routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..auth import Principal
from ..db import audit
from ..db.util import iso_z
from datetime import datetime
from datetime import timedelta
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
from pydantic import model_validator
from uuid import UUID
import asyncpg
from ..deps import (
    _OPERATE,
    _mutation_gate,
    _uuid_or_404,
    _v2_org,
    org_tx,
    require_user,
)
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------------------
# Downtimes — maintenance windows that mute alarm raising (alarms._raise reads
# them). Any member reads; operators+ schedule / end / delete.
# ---------------------------------------------------------------------------
class DowntimeIn(BaseModel):
    rule_id: UUID | None = None  # None = every rule in the org
    description: str = Field(default="", max_length=500)
    starts_at: datetime
    ends_at: datetime
    recurring: bool = False

    @model_validator(mode="after")
    def _window(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.recurring and self.ends_at - self.starts_at > timedelta(days=7):
            raise ValueError("a weekly recurring window must be 7 days or shorter")
        return self


_DT_SELECT = (
    "SELECT d.id, d.rule_id, r.name AS rule, d.description, d.starts_at, d.ends_at,"
    " d.recurring, d.created_by FROM downtimes d"
    " LEFT JOIN alarm_rules r ON r.org_id=d.org_id AND r.id=d.rule_id")


def _dt_json(r, me: UUID) -> dict:
    return {"id": str(r["id"]), "rule_id": str(r["rule_id"]) if r["rule_id"] else None,
            "rule": r["rule"], "description": r["description"], "recurring": r["recurring"],
            "starts_at": iso_z(r["starts_at"]), "ends_at": iso_z(r["ends_at"]),
            "mine": r["created_by"] == me}  # no email: member identities are admin-only


@router.get("/api/v1/orgs/{org}/downtimes")
async def v2_list_downtimes(org: str, request: Request,
                            p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        rows = await tc.fetch(_DT_SELECT + " ORDER BY d.starts_at DESC LIMIT 500")
        rules = await tc.fetch("SELECT id, name FROM alarm_rules ORDER BY name")  # schedule-dialog picker
    return {"downtimes": [_dt_json(r, p.user_id) for r in rows],
            "rules": [{"id": str(r["id"]), "name": r["name"]} for r in rules]}


@router.post("/api/v1/orgs/{org}/downtimes", status_code=201)
async def v2_create_downtime(org: str, body: DowntimeIn, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            async with tc.conn.transaction():
                did = await tc.fetchval(
                    "INSERT INTO downtimes(org_id, rule_id, description, starts_at, ends_at,"
                    " recurring, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
                    org_id, body.rule_id, body.description, body.starts_at, body.ends_at,
                    body.recurring, p.user_id)
        except asyncpg.ForeignKeyViolationError:  # composite FK: rule not in this org
            raise HTTPException(404, "rule not found")
        await audit.append(tc, f"user:{p.user_id}", "downtime.created",
                           {"downtime_id": str(did)},
                           {"rule_id": str(body.rule_id) if body.rule_id else None})
        row = await tc.fetchrow(_DT_SELECT + " WHERE d.id=$1", did)
    return {"downtime": _dt_json(row, p.user_id)}


@router.post("/api/v1/orgs/{org}/downtimes/{dt_id}/end")
async def v2_end_downtime(org: str, dt_id: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        # clamp: ends_at must stay after starts_at (ending a not-yet-started one = cancel)
        did = await tc.fetchval(
            "UPDATE downtimes SET ends_at = GREATEST(now(), starts_at + interval '1 second')"
            " WHERE id=$1 RETURNING id", _uuid_or_404(dt_id, "downtime"))
        if did is None:
            raise HTTPException(404, "downtime not found")
        await audit.append(tc, f"user:{p.user_id}", "downtime.ended",
                           {"downtime_id": str(did)}, {})
        row = await tc.fetchrow(_DT_SELECT + " WHERE d.id=$1", did)
    return {"downtime": _dt_json(row, p.user_id)}


@router.delete("/api/v1/orgs/{org}/downtimes/{dt_id}", status_code=204)
async def v2_delete_downtime(org: str, dt_id: str, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        did = await tc.fetchval("DELETE FROM downtimes WHERE id=$1 RETURNING id",
                                _uuid_or_404(dt_id, "downtime"))
        if did is None:
            raise HTTPException(404, "downtime not found")
        await audit.append(tc, f"user:{p.user_id}", "downtime.deleted",
                           {"downtime_id": str(did)}, {})
    return Response(status_code=204)
