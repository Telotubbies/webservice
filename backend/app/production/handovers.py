from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z, utcnow
from ..iam.auth import OPERATOR_ROLES
from .oee import _DT_EV, _dt_event_json, _site_tz

router = APIRouter()

_LIMIT = 100
_SNAPSHOT_MAX_BYTES = 262144


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class HandoverIn(BaseModel):
    note: str = Field(default="", max_length=2000)


def _signer(p, org_id: UUID) -> bool:
    if p.user_id is None or p.kind == "apikey":
        return False
    return _m()._effective_org_roles(p).get(org_id) in OPERATOR_ROLES


def _require_human(p) -> None:
    if p.user_id is None or p.kind == "apikey":
        raise HTTPException(403, "a user signature is required")


def _handover_json(r) -> dict:
    return {
        "id": str(r["id"]), "site_id": str(r["site_id"]),
        "outgoing_by": str(r["outgoing_by"]), "outgoing_name": r["outgoing_name"],
        "outgoing_at": iso_z(r["outgoing_at"]), "note": r["note"],
        "snapshot": r["snapshot"],
        "incoming_by": str(r["incoming_by"]) if r["incoming_by"] else None,
        "incoming_name": r["incoming_name"],
        "incoming_at": iso_z(r["incoming_at"]) if r["incoming_at"] else None,
    }


async def _pending_snapshot(tc, site_id: UUID) -> dict:
    alarms = await tc.fetch(
        "SELECT a.id, t.path AS tag, COALESCE(r.name, a.rule_name) AS rule,"
        " a.severity, a.state, a.raised_at"
        " FROM alarms a"
        " JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id"
        " LEFT JOIN alarm_rules r ON r.org_id=a.org_id AND r.tag_id=a.tag_id AND r.id=a.rule_id"
        " WHERE t.site_id=$1 AND a.state IN ('active','rtn_unack')"
        " ORDER BY a.raised_at DESC, a.id DESC LIMIT $2",
        site_id, _LIMIT + 1)
    downtimes = await tc.fetch(
        _DT_EV + " WHERE d.site_id=$1 AND d.kind='stop' AND d.needs_reason"
        " ORDER BY d.starts_at DESC, d.id DESC LIMIT $2", site_id, _LIMIT + 1)
    reviews = await tc.fetch(
        "SELECT e.id, e.camera_id, c.name AS camera, e.fired_at, e.detail"
        " FROM vision_events e JOIN cameras c ON c.org_id=e.org_id AND c.id=e.camera_id"
        " LEFT JOIN vision_event_reviews rv ON rv.org_id=e.org_id AND rv.event_id=e.id"
        " WHERE c.site_id=$1 AND e.kind='material' AND rv.event_id IS NULL"
        " ORDER BY e.fired_at DESC, e.id DESC LIMIT $2", site_id, _LIMIT + 1)
    return {
        "captured_at": iso_z(utcnow()),
        "alarms": [{"id": str(r["id"]), "tag": r["tag"], "rule": r["rule"],
                    "severity": r["severity"], "state": r["state"],
                    "raised_at": iso_z(r["raised_at"])} for r in alarms[:_LIMIT]],
        "downtimes": [_dt_event_json(r) for r in downtimes[:_LIMIT]],
        "reviews": [{"id": str(r["id"]), "camera_id": str(r["camera_id"]),
                     "camera": r["camera"], "fired_at": iso_z(r["fired_at"]),
                     "detail": r["detail"] if isinstance(r["detail"], dict) else {}}
                    for r in reviews[:_LIMIT]],
        "truncated": {"alarms": len(alarms) > _LIMIT,
                      "downtimes": len(downtimes) > _LIMIT,
                      "reviews": len(reviews) > _LIMIT},
    }


async def _display_name(tc, p) -> str:
    name = await tc.fetchval("SELECT display_name FROM users WHERE id=$1", p.user_id)
    return name or p.user


@router.get("/api/v1/orgs/{org}/sites/{site}/handovers/pending")
async def pending(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        snapshot = await _pending_snapshot(tc, site_id)
    return {"snapshot": snapshot}


@router.get("/api/v1/orgs/{org}/sites/{site}/handovers")
async def list_handovers(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch(
            "SELECT * FROM shift_handovers WHERE site_id=$1"
            " ORDER BY outgoing_at DESC, id DESC LIMIT 50", site_id)
    return {"items": [_handover_json(r) for r in rows],
            "can_sign": _signer(p, org_id),
            "current_user_id": str(p.user_id) if p.user_id else None}


@router.get("/api/v1/orgs/{org}/sites/{site}/handovers/{handover}")
async def get_handover(org: str, site: str, handover: str, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    hid = m._uuid_or_404(handover, "handover")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        row = await tc.fetchrow(
            "SELECT * FROM shift_handovers WHERE id=$1 AND site_id=$2", hid, site_id)
        if row is None:
            raise HTTPException(404, "handover not found")
    return {"handover": _handover_json(row)}


@router.post("/api/v1/orgs/{org}/sites/{site}/handovers", status_code=201)
async def send_handover(org: str, site: str, body: HandoverIn, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._OPERATE)
    _require_human(p)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _site_tz(tc, site_id)
        snapshot = await _pending_snapshot(tc, site_id)
        if len(json.dumps(snapshot).encode()) > _SNAPSHOT_MAX_BYTES:
            raise HTTPException(422, "snapshot too large")
        name = await _display_name(tc, p)
        row = await tc.fetchrow(
            "INSERT INTO shift_handovers(org_id, site_id, outgoing_by, outgoing_name,"
            " note, snapshot) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
            org_id, site_id, p.user_id, name, body.note, snapshot)
        await audit.append(tc, f"user:{p.user_id}", "shift.handover.sent",
                           {"handover_id": str(row["id"]), "site_id": str(site_id)}, {})
    return {"handover": _handover_json(row)}


@router.post("/api/v1/orgs/{org}/sites/{site}/handovers/{handover}/accept")
async def accept_handover(org: str, site: str, handover: str, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._OPERATE)
    hid = m._uuid_or_404(handover, "handover")
    _require_human(p)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        prev = await tc.fetchrow(
            "SELECT outgoing_by, incoming_at FROM shift_handovers"
            " WHERE id=$1 AND site_id=$2", hid, site_id)
        if prev is None:
            raise HTTPException(404, "handover not found")
        if prev["outgoing_by"] == p.user_id:
            raise HTTPException(409, "the sender cannot accept their own handover")
        if prev["incoming_at"] is not None:
            raise HTTPException(409, "handover already accepted")
        name = await _display_name(tc, p)
        row = await tc.fetchrow(
            "UPDATE shift_handovers SET incoming_by=$1, incoming_name=$2,"
            " incoming_at=now() WHERE id=$3 AND incoming_at IS NULL RETURNING *",
            p.user_id, name, hid)
        if row is None:
            raise HTTPException(409, "handover already accepted")
        await audit.append(tc, f"user:{p.user_id}", "shift.handover.received",
                           {"handover_id": str(hid), "site_id": str(site_id)}, {})
    return {"handover": _handover_json(row)}
