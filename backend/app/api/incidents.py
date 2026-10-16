"""v2 admin API: incidents routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..core import config
from ..alarming import inference
from ..iam.auth import Principal
from ..db import audit
from ..db.util import finite_or_none
from ..db.util import iso_z
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
from typing import Literal
from uuid import UUID
import asyncpg
from ..deps import (
    _CONFIG,
    _OPERATE,
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
# Teams (admin-managed member groups) + incidents (operators declare / ack /
# resolve, append-only timeline). Any member reads. Display names only — member
# emails stay admin-only.
# ---------------------------------------------------------------------------
class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)


class TeamMembersIn(BaseModel):
    user_ids: list[UUID] = Field(max_length=200)


def _who(r) -> str:
    return r["display_name"] or str(r["user_id"])[:8]


async def _teams_json(tc) -> list[dict]:
    teams = await tc.fetch("SELECT id, name, description FROM teams ORDER BY lower(name)")
    mem = await tc.fetch(
        "SELECT tm.team_id, tm.user_id, u.display_name FROM team_members tm"
        " JOIN users u ON u.id = tm.user_id ORDER BY u.display_name")
    return [{"id": str(t["id"]), "name": t["name"], "description": t["description"],
             "members": [{"user_id": str(m["user_id"]), "name": _who(m)}
                         for m in mem if m["team_id"] == t["id"]]} for t in teams]


@router.get("/api/v1/orgs/{org}/teams")
async def v2_list_teams(org: str, request: Request, p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        return {"teams": await _teams_json(tc)}


@router.post("/api/v1/orgs/{org}/teams", status_code=201)
async def v2_create_team(org: str, body: TeamIn, request: Request,
                         p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            async with tc.conn.transaction():
                tid = await tc.fetchval(
                    "INSERT INTO teams(org_id, name, description) VALUES ($1,$2,$3) RETURNING id",
                    org_id, body.name.strip(), body.description)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "a team with this name already exists")
        await audit.append(tc, f"user:{p.user_id}", "team.created", {"team_id": str(tid)}, {})
    return {"id": str(tid)}


@router.put("/api/v1/orgs/{org}/teams/{team_id}/members")
async def v2_set_team_members(org: str, team_id: str, body: TeamMembersIn, request: Request,
                              p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    tid = _uuid_or_404(team_id, "team")
    async with org_tx(request, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM teams WHERE id=$1", tid) is None:
            raise HTTPException(404, "team not found")
        try:
            async with tc.conn.transaction():
                await tc.execute("DELETE FROM team_members WHERE team_id=$1", tid)
                for uid in set(body.user_ids):
                    await tc.execute("INSERT INTO team_members(org_id, team_id, user_id) VALUES ($1,$2,$3)",
                                     org_id, tid, uid)
        except asyncpg.ForeignKeyViolationError:  # composite FK: not a member of this org
            raise HTTPException(404, "member not found")
        await audit.append(tc, f"user:{p.user_id}", "team.members_set",
                           {"team_id": str(tid)}, {"count": len(set(body.user_ids))})
    return {"ok": True}


@router.delete("/api/v1/orgs/{org}/teams/{team_id}", status_code=204)
async def v2_delete_team(org: str, team_id: str, request: Request,
                         p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        tid = await tc.fetchval("DELETE FROM teams WHERE id=$1 RETURNING id", _uuid_or_404(team_id, "team"))
        if tid is None:
            raise HTTPException(404, "team not found")
        await audit.append(tc, f"user:{p.user_id}", "team.deleted", {"team_id": str(tid)}, {})
    return Response(status_code=204)


class IncidentIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    severity: Literal["info", "warning", "critical"] = "warning"
    alarm_id: UUID | None = None
    owner_team_id: UUID | None = None


class IncidentStatusIn(BaseModel):
    status: Literal["acknowledged", "resolved"]


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


_INC_SELECT = (
    "SELECT i.id, i.title, i.severity, i.status, i.created_at, i.acked_at, i.resolved_at,"
    " i.alarm_id, i.owner_team_id, t.name AS team, i.created_by FROM incidents i"
    " LEFT JOIN teams t ON t.org_id=i.org_id AND t.id=i.owner_team_id")


def _inc_json(r, me: UUID) -> dict:
    return {"id": str(r["id"]), "title": r["title"], "severity": r["severity"], "status": r["status"],
            "created_at": iso_z(r["created_at"]),
            "acked_at": iso_z(r["acked_at"]) if r["acked_at"] else None,
            "resolved_at": iso_z(r["resolved_at"]) if r["resolved_at"] else None,
            "alarm_id": str(r["alarm_id"]) if r["alarm_id"] else None,
            "team_id": str(r["owner_team_id"]) if r["owner_team_id"] else None,
            "team": r["team"], "mine": r["created_by"] == me}


@router.get("/api/v1/orgs/{org}/incidents")
async def v2_list_incidents(org: str, request: Request, p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        rows = await tc.fetch(_INC_SELECT + " ORDER BY i.created_at DESC LIMIT 200")
        teams = await tc.fetch("SELECT id, name FROM teams ORDER BY lower(name)")  # declare-dialog picker
    return {"incidents": [_inc_json(r, p.user_id) for r in rows],
            "teams": [{"id": str(t["id"]), "name": t["name"]} for t in teams]}


@router.post("/api/v1/orgs/{org}/incidents", status_code=201)
async def v2_create_incident(org: str, body: IncidentIn, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            async with tc.conn.transaction():
                iid = await tc.fetchval(
                    "INSERT INTO incidents(org_id, title, severity, created_by, alarm_id, owner_team_id)"
                    " VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
                    org_id, body.title.strip(), body.severity, p.user_id, body.alarm_id, body.owner_team_id)
                await tc.execute(
                    "INSERT INTO incident_events(org_id, incident_id, kind, author_id) VALUES ($1,$2,'created',$3)",
                    org_id, iid, p.user_id)
        except asyncpg.ForeignKeyViolationError:  # composite FK: alarm / team not in this org
            raise HTTPException(404, "alarm or team not found")
        await audit.append(tc, f"user:{p.user_id}", "incident.declared", {"incident_id": str(iid)}, {})
        row = await tc.fetchrow(_INC_SELECT + " WHERE i.id=$1", iid)
    return {"incident": _inc_json(row, p.user_id)}


@router.get("/api/v1/orgs/{org}/incidents/{inc_id}")
async def v2_get_incident(org: str, inc_id: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(_INC_SELECT + " WHERE i.id=$1", _uuid_or_404(inc_id, "incident"))
        if row is None:
            raise HTTPException(404, "incident not found")
        ev = await tc.fetch(
            "SELECT e.kind, e.body, e.at, e.author_id AS user_id, u.display_name FROM incident_events e"
            " LEFT JOIN users u ON u.id = e.author_id WHERE e.incident_id=$1 ORDER BY e.at, e.id", row["id"])
    return {"incident": _inc_json(row, p.user_id),
            "events": [{"kind": e["kind"], "body": e["body"], "at": iso_z(e["at"]), "who": _who(e)} for e in ev]}


@router.post("/api/v1/orgs/{org}/incidents/{inc_id}/status")
async def v2_incident_status(org: str, inc_id: str, body: IncidentStatusIn, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        # active -> acknowledged -> resolved (resolving an active one acks it too)
        allowed = ["active"] if body.status == "acknowledged" else ["active", "acknowledged"]
        iid = await tc.fetchval(
            "UPDATE incidents SET status=$2, acked_at=COALESCE(acked_at, now()),"
            " resolved_at=CASE WHEN $2='resolved' THEN now() END"
            " WHERE id=$1 AND status = ANY($3::text[]) RETURNING id",
            _uuid_or_404(inc_id, "incident"), body.status, allowed)
        if iid is None:
            raise HTTPException(409, "incident not found or already past this state")
        await tc.execute(
            "INSERT INTO incident_events(org_id, incident_id, kind, author_id, body) VALUES ($1,$2,'status',$3,$4)",
            org_id, iid, p.user_id, body.status)
        await audit.append(tc, f"user:{p.user_id}", f"incident.{body.status}", {"incident_id": str(iid)}, {})
        row = await tc.fetchrow(_INC_SELECT + " WHERE i.id=$1", iid)
    return {"incident": _inc_json(row, p.user_id)}


@router.post("/api/v1/orgs/{org}/incidents/{inc_id}/notes", status_code=201)
async def v2_incident_note(org: str, inc_id: str, body: NoteIn, request: Request,
                           p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    iid = _uuid_or_404(inc_id, "incident")
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            async with tc.conn.transaction():
                await tc.execute(
                    "INSERT INTO incident_events(org_id, incident_id, kind, author_id, body) VALUES ($1,$2,'note',$3,$4)",
                    org_id, iid, p.user_id, body.body.strip())
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "incident not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI inference — latest predictions from the org's external model server
# (inference.py). Any member reads; cached, so polling is cheap.
# ---------------------------------------------------------------------------
@router.get("/api/v1/orgs/{org}/inference")
async def v2_inference(org: str, request: Request, p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    if not config.INFERENCE_URL:
        return {"configured": False}
    s = st(request)
    await s.registry.maybe_refresh()
    async with org_tx(request, org_id, p.user_id) as tc:
        rows = await tc.fetch("SELECT tag_id, v, q, ts FROM tag_latest")
    feats = [{"name": s.registry.display_name(t), "v": finite_or_none(r["v"]), "q": r["q"], "ts": iso_z(r["ts"])}
             for r in rows if (t := s.registry.by_id(r["tag_id"]))]
    return await inference.latest(org_id, feats)
