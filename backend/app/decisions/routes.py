"""Decisions (F10): record which option a person chose and why.

A person always decides: this module only stores the choice, the reason and a
snapshot of the numbers shown. It never sends a command (that is F05's path).
Reads: any org member. Writes: operate role.
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()
BASE = "/api/v1/orgs/{org}/sites/{site}/decisions"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1, max_length=200)
    option_key: Literal["refill_now", "refill_later", "switch_source"]
    reason: str = Field(max_length=500)
    snapshot: dict

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("reason_required")
        return v

    @field_validator("snapshot")
    @classmethod
    def _snap(cls, v: dict) -> dict:
        if len(json.dumps(v)) > 32768:
            raise ValueError("snapshot_too_large")
        return v


def _json(r) -> dict:
    snap = r["snapshot"]
    return {"id": str(r["id"]), "subject": r["subject"], "option_key": r["option_key"],
            "reason": r["reason"], "snapshot": json.loads(snap) if isinstance(snap, str) else snap,
            "decided_by": str(r["decided_by"]) if r["decided_by"] else None,
            "decided_at": iso_z(r["decided_at"])}


@router.get(BASE)
async def list_decisions(org: str, site: str, request: Request, p=Depends(_user),
                         subject: str | None = None, limit: int = Query(20, ge=1, le=100)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM decisions WHERE site_id=$1 AND ($2::text IS NULL OR subject=$2)"
            " ORDER BY decided_at DESC LIMIT $3", site_id, subject, limit)
    return {"items": [_json(r) for r in rows]}


@router.post(BASE)
async def record_decision(org: str, site: str, body: DecisionIn, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._OPERATE)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO decisions(org_id, site_id, subject, option_key, reason, snapshot, decided_by)"
            " VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *",
            org_id, site_id, body.subject, body.option_key, body.reason,
            json.dumps(body.snapshot), p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "decision.recorded",
                           {"subject": body.subject}, {"option": body.option_key})
    return {"decision": _json(row)}
