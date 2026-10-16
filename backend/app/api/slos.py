"""v2 admin API: slos routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..iam.auth import Principal
from ..db import audit
from ..db.util import iso_z
from ..db.util import parse_ts
from ..db.util import utcnow
from datetime import timedelta
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
from uuid import UUID
import asyncpg
from ..deps import _CONFIG, _mutation_gate, _uuid_or_404, _v2_org, org_tx, require_user, st
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------------------
# SLOs — availability targets on one tag, plus correction windows whose samples
# are left out of the SLI. Any member reads; config:write changes them.
# ---------------------------------------------------------------------------
SLO_MAX = 100


class SloIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tag: str                              # display name, e.g. plant1.sort.line1.conv1.temp_c
    target: float = Field(gt=0, lt=100)
    warning: float | None = Field(default=None, le=100)
    description: str = Field(default="", max_length=500)


class SloPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    tag: str | None = None
    target: float | None = Field(default=None, gt=0, lt=100)
    warning: float | None = Field(default=None, le=100)
    description: str | None = Field(default=None, max_length=500)


class SloCorrectionIn(BaseModel):
    starts_at: str
    ends_at: str
    reason: str = Field(min_length=1, max_length=500)


async def _org_tag_or_400(request: Request, org_id: UUID, name: str):
    reg = st(request).registry
    await reg.maybe_refresh()
    for t in reg.for_org(org_id):
        if reg.display_name(t) == name:
            return t
    raise HTTPException(400, "invalid_request: tag")


def _default_warning(target: float) -> float:
    return round(target + (100 - target) / 2, 4)


def _slo_json(request: Request, r, corrections: list) -> dict:
    reg = st(request).registry
    tag = reg.by_id(r["tag_id"])
    return {"id": str(r["id"]), "name": r["name"], "description": r["description"],
            "tag": reg.display_name(tag) if tag else None, "tag_id": str(r["tag_id"]),
            "target": r["target"], "warning": r["warning"],
            "updated_at": iso_z(r["updated_at"]),
            "corrections": [{"id": str(c["id"]), "starts_at": iso_z(c["starts_at"]),
                             "ends_at": iso_z(c["ends_at"]), "reason": c["reason"]}
                            for c in corrections if c["slo_id"] == r["id"]]}


@router.get("/api/v1/orgs/{org}/slos")
async def v2_list_slos(org: str, request: Request, p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch("SELECT * FROM slos ORDER BY name LIMIT $1", SLO_MAX)
        cors = await tc.fetch(
            "SELECT id, slo_id, starts_at, ends_at, reason FROM slo_corrections"
            " ORDER BY starts_at DESC LIMIT 2000")
    return {"items": [_slo_json(request, r, cors) for r in rows], "next_cursor": None}


@router.get("/api/v1/orgs/{org}/slos/status")
async def v2_slo_status(org: str, request: Request, days: int = Query(30, ge=1, le=90),
                        p: Principal = Depends(require_user)):
    """Per-SLO SLI over the window with correction windows excluded. Only as
    deep as tag_history retention, so `covered_s` says what was really read."""
    org_id = _v2_org(org, p)
    to = utcnow()
    t_from = to - timedelta(days=days)
    out = []
    async with org_tx(request, org_id) as tc:
        slos = await tc.fetch("SELECT id, tag_id FROM slos ORDER BY name LIMIT $1", SLO_MAX)
        for s in slos:
            row = await tc.fetchrow(
                "SELECT count(*) AS n, count(*) FILTER (WHERE q='good') AS good,"
                " min(ts) AS first FROM tag_history h WHERE h.tag_id=$1 AND h.ts >= $2 AND h.ts <= $3"
                " AND NOT EXISTS (SELECT 1 FROM slo_corrections c WHERE c.slo_id=$4"
                "   AND h.ts >= c.starts_at AND h.ts <= c.ends_at)",
                s["tag_id"], t_from, to, s["id"])
            excluded = await tc.fetchval(
                "SELECT count(*) FROM tag_history h WHERE h.tag_id=$1 AND h.ts >= $2 AND h.ts <= $3"
                " AND EXISTS (SELECT 1 FROM slo_corrections c WHERE c.slo_id=$4"
                "   AND h.ts >= c.starts_at AND h.ts <= c.ends_at)",
                s["tag_id"], t_from, to, s["id"])
            n = row["n"]
            out.append({"id": str(s["id"]), "samples": n, "excluded": excluded,
                        "sli": (row["good"] / n * 100) if n else None,
                        "covered_s": round((to - row["first"]).total_seconds()) if n else 0})
    return {"days": days, "items": out}


@router.post("/api/v1/orgs/{org}/slos", status_code=201)
async def v2_create_slo(org: str, body: SloIn, request: Request,
                        p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    tag = await _org_tag_or_400(request, org_id, body.tag)
    warning = body.warning if body.warning is not None else _default_warning(body.target)
    if warning < body.target:
        raise HTTPException(400, "invalid_request: warning must be >= target")
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT count(*) FROM slos") >= SLO_MAX:
            raise HTTPException(409, "slo limit reached")
        try:
            row = await tc.fetchrow(
                "INSERT INTO slos(org_id, tag_id, name, description, target, warning, created_by)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
                org_id, tag.id, body.name, body.description, body.target, warning, p.user_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "an SLO with this name already exists") from None
        await audit.append(tc, f"user:{p.user_id}", "slo.created",
                           {"slo_id": str(row["id"])}, {"name": body.name, "target": body.target})
    return {"slo": _slo_json(request, row, [])}


@router.patch("/api/v1/orgs/{org}/slos/{slo_id}")
async def v2_patch_slo(org: str, slo_id: str, body: SloPatch, request: Request,
                       p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "invalid_request: empty patch")
    sid = _uuid_or_404(slo_id, "slo")
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await tc.fetchrow("SELECT * FROM slos WHERE id=$1", sid)
        if cur is None:
            raise HTTPException(404, "slo not found")
        tag_id = (await _org_tag_or_400(request, org_id, changes["tag"])).id if changes.get("tag") else cur["tag_id"]
        target = changes.get("target", cur["target"])
        warning = changes.get("warning")
        if warning is None:  # keep the old warning unless it would now sit below the target
            warning = cur["warning"] if "target" not in changes or cur["warning"] >= target else _default_warning(target)
        if warning < target:
            raise HTTPException(400, "invalid_request: warning must be >= target")
        try:
            row = await tc.fetchrow(
                "UPDATE slos SET name=$2, description=$3, tag_id=$4, target=$5, warning=$6,"
                " updated_at=now() WHERE id=$1 RETURNING *",
                sid, changes.get("name", cur["name"]), changes.get("description", cur["description"]),
                tag_id, target, warning)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "an SLO with this name already exists") from None
        cors = await tc.fetch("SELECT id, slo_id, starts_at, ends_at, reason FROM slo_corrections"
                              " WHERE slo_id=$1 ORDER BY starts_at DESC", sid)
        await audit.append(tc, f"user:{p.user_id}", "slo.updated", {"slo_id": slo_id},
                           {k: v for k, v in changes.items() if k != "description"})
    return {"slo": _slo_json(request, row, cors)}


@router.delete("/api/v1/orgs/{org}/slos/{slo_id}", status_code=204)
async def v2_delete_slo(org: str, slo_id: str, request: Request,
                        p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        gone = await tc.fetchval("DELETE FROM slos WHERE id=$1 RETURNING id", _uuid_or_404(slo_id, "slo"))
        if gone is None:
            raise HTTPException(404, "slo not found")
        await audit.append(tc, f"user:{p.user_id}", "slo.deleted", {"slo_id": slo_id}, {})
    return Response(status_code=204)


@router.post("/api/v1/orgs/{org}/slos/{slo_id}/corrections", status_code=201)
async def v2_add_slo_correction(org: str, slo_id: str, body: SloCorrectionIn, request: Request,
                                p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    try:
        starts, ends = parse_ts(body.starts_at), parse_ts(body.ends_at)
    except ValueError:
        raise HTTPException(400, "invalid_request: timestamps") from None
    if ends <= starts or ends - starts > timedelta(days=30):
        raise HTTPException(400, "invalid_request: window must be 0..30 days")
    sid = _uuid_or_404(slo_id, "slo")
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM slos WHERE id=$1", sid) is None:
            raise HTTPException(404, "slo not found")
        row = await tc.fetchrow(
            "INSERT INTO slo_corrections(org_id, slo_id, starts_at, ends_at, reason, created_by)"
            " VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, starts_at, ends_at, reason",
            org_id, sid, starts, ends, body.reason, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "slo.correction_added",
                           {"slo_id": slo_id, "correction_id": str(row["id"])}, {"reason": body.reason})
    return {"correction": {"id": str(row["id"]), "starts_at": iso_z(row["starts_at"]),
                           "ends_at": iso_z(row["ends_at"]), "reason": row["reason"]}}


@router.delete("/api/v1/orgs/{org}/slos/{slo_id}/corrections/{cid}", status_code=204)
async def v2_delete_slo_correction(org: str, slo_id: str, cid: str, request: Request,
                                   p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM slo_corrections WHERE id=$1 AND slo_id=$2 RETURNING id",
            _uuid_or_404(cid, "correction"), _uuid_or_404(slo_id, "slo"))
        if gone is None:
            raise HTTPException(404, "correction not found")
        await audit.append(tc, f"user:{p.user_id}", "slo.correction_removed",
                           {"slo_id": slo_id, "correction_id": cid}, {})
    return Response(status_code=204)
