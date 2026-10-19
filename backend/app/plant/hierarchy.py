"""ISA-95 hierarchy (Site > Area > Line > Equipment) and per-area command rights.

Reads are open to any org member; writes need config:write. Grants are not
RLS: RLS is the tenant boundary, `area_allowed` is authorization on top of it
and runs in every path that moves equipment (commands.issue today; recipe
download and sequence start later).
"""

from __future__ import annotations

import re
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()

_CODE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
LINE_KINDS = ("line", "cell", "unit")
DEVICE_KINDS = ("motor", "conveyor", "vessel", "valve", "pump", "mixer",
                "indicator", "other")
_ALL_AREAS_ROLES = ("owner", "admin")


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


# ── Authorization ──

async def area_allowed(tc, user_id: UUID | None, tag_id: UUID) -> bool:
    """May `user_id` command `tag_id`? owner/admin: always. Otherwise a user
    with no grant rows may command everywhere (orgs that never use grants keep
    working); with grants, only inside granted areas. A tag that sits in no
    equipment has no area, so a restricted user cannot command it."""
    if user_id is None:
        return True
    role = await tc.fetchval(
        "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
        tc.org_id, user_id)
    if role in _ALL_AREAS_ROLES:
        return True
    n = await tc.fetchval(
        "SELECT count(*) FROM area_grants WHERE user_id=$1", user_id)
    if not n:
        return True
    return bool(await tc.fetchval(
        "SELECT 1 FROM tags t"
        " JOIN devices d ON d.org_id=t.org_id AND d.id=t.device_id"
        " JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
        " JOIN area_grants g ON g.org_id=l.org_id AND g.area_id=l.area_id"
        " WHERE t.id=$1 AND g.user_id=$2", tag_id, user_id))


# ── Models ──

class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=32)
    sort: int = Field(default=0, ge=0, le=10_000)


class AreaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort: int | None = Field(default=None, ge=0, le=10_000)


class LinePatch(BaseModel):
    area_id: UUID | None = None
    kind: str | None = None


class DevicePatch(BaseModel):
    line_id: UUID | None = None
    kind: str | None = None


class LineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    area_id: UUID
    kind: str = "line"


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    line_id: UUID
    kind: str | None = None


class GrantsIn(BaseModel):
    area_ids: list[UUID] = Field(max_length=500)


class TagsMoveIn(BaseModel):
    tag_ids: list[UUID] = Field(min_length=1, max_length=2000)
    device_id: UUID


def _area_json(r) -> dict:
    return {"id": str(r["id"]), "site_id": str(r["site_id"]), "name": r["name"],
            "code": r["code"], "sort": r["sort"], "created_at": iso_z(r["created_at"])}


async def _site(tc, site_id: UUID) -> None:
    if not await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id):
        raise HTTPException(404, "site not found")


# ── Areas ──

@router.get("/api/v1/orgs/{org}/sites/{site}/areas")
async def list_areas(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site(tc, site_id)
        rows = await tc.fetch(
            "SELECT * FROM areas WHERE site_id=$1 ORDER BY sort, name", site_id)
    return {"items": [_area_json(r) for r in rows]}


@router.post("/api/v1/orgs/{org}/sites/{site}/areas", status_code=201)
async def create_area(org: str, site: str, body: AreaIn, request: Request,
                      p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    if not _CODE.match(body.code):
        raise HTTPException(422, "invalid_code")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _site(tc, site_id)
        try:
            row = await tc.fetchrow(
                "INSERT INTO areas(org_id, site_id, name, code, sort)"
                " VALUES ($1,$2,$3,$4,$5) RETURNING *",
                org_id, site_id, body.name, body.code, body.sort)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "area_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "area.created",
                           {"area_id": str(row["id"])}, {"code": body.code})
    return _area_json(row)


@router.patch("/api/v1/orgs/{org}/sites/{site}/areas/{area}")
async def patch_area(org: str, site: str, area: str, body: AreaPatch,
                     request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    area_id = m._uuid_or_404(area, "area")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "UPDATE areas SET name=COALESCE($3,name), sort=COALESCE($4,sort)"
            " WHERE id=$1 AND site_id=$2 RETURNING *",
            area_id, site_id, body.name, body.sort)
        if row is None:
            raise HTTPException(404, "area not found")
        await audit.append(tc, f"user:{p.user_id}", "area.updated",
                           {"area_id": str(area_id)}, None)
    return _area_json(row)


@router.delete("/api/v1/orgs/{org}/sites/{site}/areas/{area}", status_code=204)
async def delete_area(org: str, site: str, area: str, request: Request,
                      p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    area_id = m._uuid_or_404(area, "area")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            gone = await tc.fetchval(
                "DELETE FROM areas WHERE id=$1 AND site_id=$2 RETURNING id",
                area_id, site_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(409, "area_not_empty") from None
        if gone is None:
            raise HTTPException(404, "area not found")
        await audit.append(tc, f"user:{p.user_id}", "area.deleted",
                           {"area_id": str(area_id)}, None)


# ── Tree ──

@router.get("/api/v1/orgs/{org}/sites/{site}/hierarchy")
async def hierarchy(org: str, site: str, request: Request, tags: bool = False,
                    p=Depends(_user)):
    """The whole site as one tree: area > line > equipment, with tag counts and
    the number of open alarms under each equipment. `?tags=true` adds each
    equipment's tag paths (scope selector); off by default to keep it small."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site(tc, site_id)
        areas = await tc.fetch(
            "SELECT * FROM areas WHERE site_id=$1 ORDER BY sort, name", site_id)
        lines = await tc.fetch(
            "SELECT id, area_id, name, kind FROM lines WHERE site_id=$1"
            " ORDER BY name", site_id)
        devs = await tc.fetch(
            "SELECT d.id, d.line_id, d.name, d.kind,"
            " (SELECT count(*) FROM tags t WHERE t.org_id=d.org_id"
            "   AND t.device_id=d.id)::int AS tags,"
            " (SELECT count(*) FROM alarms a JOIN tags t"
            "   ON t.org_id=a.org_id AND t.id=a.tag_id"
            "  WHERE t.device_id=d.id AND a.state <> 'cleared')::int AS alarms,"
            " (SELECT count(*) FROM plant_parts pp WHERE pp.org_id=d.org_id"
            "   AND pp.device_id=d.id)::int AS parts"
            " FROM devices d JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
            " WHERE l.site_id=$1 ORDER BY d.name", site_id)
        paths: dict = {}
        if tags:
            for r in await tc.fetch(
                    "SELECT device_id, path FROM tags WHERE site_id=$1"
                    " AND device_id IS NOT NULL ORDER BY path", site_id):
                paths.setdefault(r["device_id"], []).append(r["path"])
    by_line: dict = {}
    for d in devs:
        by_line.setdefault(d["line_id"], []).append({
            "id": str(d["id"]), "name": d["name"], "kind": d["kind"],
            "tags": d["tags"], "alarms": d["alarms"], "parts": d["parts"],
            **({"tag_paths": paths.get(d["id"], [])} if tags else {})})
    by_area: dict = {}
    for ln in lines:
        eq = by_line.get(ln["id"], [])
        by_area.setdefault(ln["area_id"], []).append({
            "id": str(ln["id"]), "name": ln["name"], "kind": ln["kind"],
            "tags": sum(e["tags"] for e in eq),
            "alarms": sum(e["alarms"] for e in eq), "equipment": eq})
    out = []
    for a in areas:
        ls = by_area.get(a["id"], [])
        out.append({**_area_json(a), "tags": sum(x["tags"] for x in ls),
                    "alarms": sum(x["alarms"] for x in ls), "lines": ls})
    return {"areas": out}


@router.post("/api/v1/orgs/{org}/sites/{site}/lines", status_code=201)
async def create_line(org: str, site: str, body: LineIn, request: Request,
                      p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    if body.kind not in LINE_KINDS:
        raise HTTPException(422, "invalid_kind")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if not await tc.fetchval(
                "SELECT 1 FROM areas WHERE id=$1 AND site_id=$2", body.area_id, site_id):
            raise HTTPException(404, "area not found")
        try:
            row = await tc.fetchrow(
                "INSERT INTO lines(org_id, site_id, area_id, name, kind)"
                " VALUES ($1,$2,$3,$4,$5) RETURNING id, area_id, name, kind",
                org_id, site_id, body.area_id, body.name, body.kind)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "line_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "line.created",
                           {"line_id": str(row["id"])}, {"name": body.name})
    return {"id": str(row["id"]), "area_id": str(row["area_id"]),
            "name": row["name"], "kind": row["kind"]}


@router.post("/api/v1/orgs/{org}/sites/{site}/devices", status_code=201)
async def create_device(org: str, site: str, body: DeviceIn, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    if body.kind is not None and body.kind not in DEVICE_KINDS:
        raise HTTPException(422, "invalid_kind")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if not await tc.fetchval(
                "SELECT 1 FROM lines WHERE id=$1 AND site_id=$2", body.line_id, site_id):
            raise HTTPException(404, "line not found")
        try:
            row = await tc.fetchrow(
                "INSERT INTO devices(org_id, line_id, name, kind)"
                " VALUES ($1,$2,$3,$4) RETURNING id, line_id, name, kind",
                org_id, body.line_id, body.name, body.kind)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "device_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "device.created",
                           {"device_id": str(row["id"])}, {"name": body.name})
    return {"id": str(row["id"]), "line_id": str(row["line_id"]),
            "name": row["name"], "kind": row["kind"]}


@router.patch("/api/v1/orgs/{org}/sites/{site}/lines/{line}")
async def patch_line(org: str, site: str, line: str, body: LinePatch,
                     request: Request, p=Depends(_user)):
    """Move a line to another area / change its kind. Tag paths never change."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    line_id = m._uuid_or_404(line, "line")
    if body.kind is not None and body.kind not in LINE_KINDS:
        raise HTTPException(422, "invalid_kind")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if body.area_id is not None and not await tc.fetchval(
                "SELECT 1 FROM areas WHERE id=$1 AND site_id=$2", body.area_id, site_id):
            raise HTTPException(404, "area not found")
        row = await tc.fetchrow(
            "UPDATE lines SET area_id=COALESCE($3,area_id), kind=COALESCE($4,kind)"
            " WHERE id=$1 AND site_id=$2 RETURNING id, area_id, kind",
            line_id, site_id, body.area_id, body.kind)
        if row is None:
            raise HTTPException(404, "line not found")
        await audit.append(tc, f"user:{p.user_id}", "line.moved",
                           {"line_id": str(line_id)},
                           {"area_id": str(row["area_id"]), "kind": row["kind"]})
    return {"id": str(row["id"]), "area_id": str(row["area_id"]), "kind": row["kind"]}


@router.patch("/api/v1/orgs/{org}/sites/{site}/devices/{device}")
async def patch_device(org: str, site: str, device: str, body: DevicePatch,
                       request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    dev_id = m._uuid_or_404(device, "device")
    if body.kind is not None and body.kind not in DEVICE_KINDS:
        raise HTTPException(422, "invalid_kind")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if body.line_id is not None and not await tc.fetchval(
                "SELECT 1 FROM lines WHERE id=$1 AND site_id=$2", body.line_id, site_id):
            raise HTTPException(404, "line not found")
        try:
            row = await tc.fetchrow(
                "UPDATE devices d SET line_id=COALESCE($3,d.line_id),"
                " kind=COALESCE($4,d.kind) FROM lines l"
                " WHERE d.id=$1 AND l.org_id=d.org_id AND l.id=d.line_id"
                " AND l.site_id=$2 RETURNING d.id, d.line_id, d.kind",
                dev_id, site_id, body.line_id, body.kind)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "device_exists") from None
        if row is None:
            raise HTTPException(404, "device not found")
        await audit.append(tc, f"user:{p.user_id}", "device.moved",
                           {"device_id": str(dev_id)},
                           {"line_id": str(row["line_id"]), "kind": row["kind"]})
    return {"id": str(row["id"]), "line_id": str(row["line_id"]), "kind": row["kind"]}


@router.post("/api/v1/orgs/{org}/sites/{site}/tags/move")
async def move_tags(org: str, site: str, body: TagsMoveIn, request: Request,
                    p=Depends(_user)):
    """Bulk-assign tags to an equipment. Only `device_id` changes — the tag
    path (and so dashboards, alarms, history) is untouched."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if not await tc.fetchval(
                "SELECT 1 FROM devices d JOIN lines l ON l.org_id=d.org_id"
                " AND l.id=d.line_id WHERE d.id=$1 AND l.site_id=$2",
                body.device_id, site_id):
            raise HTTPException(404, "device not found")
        n = await tc.fetchval(
            "WITH u AS (UPDATE tags SET device_id=$3 WHERE site_id=$1"
            " AND id = ANY($2::uuid[]) RETURNING 1) SELECT count(*) FROM u",
            site_id, body.tag_ids, body.device_id)
        await audit.append(tc, f"user:{p.user_id}", "tags.moved",
                           {"device_id": str(body.device_id)}, {"count": n})
    return {"moved": n}


# ── Grants ──

@router.get("/api/v1/orgs/{org}/area-grants")
async def list_grants(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT user_id, area_id FROM area_grants")
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(str(r["user_id"]), []).append(str(r["area_id"]))
    return {"grants": out}


@router.put("/api/v1/orgs/{org}/members/{user}/area-grants")
async def put_grants(org: str, user: str, body: GrantsIn, request: Request,
                     p=Depends(_user)):
    """Replace a member's grant set. Empty list = no restriction (all areas)."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    uid = m._uuid_or_404(user, "member")
    areas = sorted(set(body.area_ids))
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if not await tc.fetchval(
                "SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2", org_id, uid):
            raise HTTPException(404, "member not found")
        if areas and await tc.fetchval(
                "SELECT count(*) FROM areas WHERE id = ANY($1::uuid[])", areas) != len(areas):
            raise HTTPException(404, "area not found")
        before = {r["area_id"] for r in await tc.fetch(
            "SELECT area_id FROM area_grants WHERE user_id=$1", uid)}
        await tc.execute("DELETE FROM area_grants WHERE user_id=$1", uid)
        for a in areas:
            await tc.execute(
                "INSERT INTO area_grants(org_id, user_id, area_id) VALUES ($1,$2,$3)",
                org_id, uid, a)
        for a in sorted(set(areas) - before):
            await audit.append(tc, f"user:{p.user_id}", "area_grant.created",
                               {"user_id": str(uid), "area_id": str(a)}, None)
        for a in sorted(before - set(areas)):
            await audit.append(tc, f"user:{p.user_id}", "area_grant.deleted",
                               {"user_id": str(uid), "area_id": str(a)}, None)
    return {"user_id": str(uid), "area_ids": [str(a) for a in areas]}
