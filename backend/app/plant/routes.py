"""Plant models: upload a .glb, map its nodes to live equipment, activate it.

Reads are open to any org member; writes need config:write. Mapping never
issues commands — a `run`/`speed` binding only tells the faceplate which
writable tag to offer a command for, and the command itself goes through the
normal command path.
"""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..datasources.addresses import AddressError
from ..datasources.routes import _after_commit, _insert_tag, bump_config
from ..datasources.taginput import TagSpec, build_tag
from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z
from . import glb, storage
from ..tenancy import plans
from .kinds import KINDS, MAX_BINDINGS, clean_params

router = APIRouter()

_NAME_BAD = re.compile(r"[^A-Za-z0-9._ -]")
_MAX_MODELS_PER_SITE = 20
_MAX_PARTS = 400


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def _model_json(r, parts: int | None = None) -> dict:
    d = {"id": str(r["id"]), "site_id": str(r["site_id"]), "name": r["name"],
         "filename": r["filename"], "size_bytes": r["size_bytes"], "sha256": r["sha256"],
         "node_count": r["node_count"], "active": r["active"],
         "created_at": iso_z(r["created_at"])}
    if parts is not None:
        d["parts"] = parts
    return d


def _part_json(r) -> dict:
    b = r["bindings"]
    if isinstance(b, str):
        import json
        b = json.loads(b)
    pr = r["params"]
    if isinstance(pr, str):
        import json
        pr = json.loads(pr)
    return {"id": str(r["id"]), "label": r["label"], "kind": r["kind"],
            "nodes": list(r["nodes"]), "bindings": b, "params": pr}


class PartIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    kind: str
    nodes: list[int] = Field(min_length=1, max_length=500)
    bindings: dict[str, str] = Field(default_factory=dict)
    params: dict = Field(default_factory=dict)

    @field_validator("nodes")
    @classmethod
    def _nonneg(cls, v: list[int]) -> list[int]:
        if any(n < 0 for n in v):
            raise ValueError("node index must be >= 0")
        return sorted(set(v))


class PartsIn(BaseModel):
    parts: list[PartIn] = Field(max_length=_MAX_PARTS)


class ModelPatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.get("/api/v1/plant-kinds")
async def plant_kinds(p=Depends(_user)):
    return {"kinds": KINDS}


async def _peek(stream):
    """Collect the first chunks needed to inspect the file, then yield the
    whole stream (collected prefix first) — nothing is buffered beyond it."""
    buf = b""
    need = 20
    it = stream.__aiter__()
    done = False
    while len(buf) < need and not done:
        try:
            c = await it.__anext__()
        except StopAsyncIteration:
            done = True
            break
        buf += c
        need = glb.head_len(buf)

    async def chain():
        if buf:
            yield buf
        if not done:
            async for c in it:
                yield c
    return buf, chain()


async def _model_or_404(tc, site_id: UUID, model_id: UUID):
    row = await tc.fetchrow("SELECT * FROM plant_models WHERE id=$1 AND site_id=$2",
                            model_id, site_id)
    if row is None:
        raise HTTPException(404, "plant model not found")
    return row


@router.get("/api/v1/orgs/{org}/sites/{site}/plant-models")
async def list_models(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT pm.*, (SELECT count(*) FROM plant_parts pp WHERE pp.model_id = pm.id) AS parts"
            " FROM plant_models pm WHERE pm.site_id=$1 ORDER BY pm.created_at DESC", site_id)
    return {"items": [_model_json(r, r["parts"]) for r in rows]}


@router.post("/api/v1/orgs/{org}/sites/{site}/plant-models", status_code=201)
async def upload_model(org: str, site: str, request: Request, filename: str = "plant.glb",
                       name: str | None = None, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > storage.MAX_GLB_BYTES:
        raise HTTPException(413, "model_too_large")
    head, chunks = await _peek(request.stream())
    try:
        info = glb.inspect(head)
    except glb.BadGlb as e:
        raise HTTPException(422, str(e)) from None
    fname = _NAME_BAD.sub("_", filename.strip())[:255] or "plant.glb"
    title = (name or fname.rsplit(".", 1)[0]).strip()[:120] or "Plant"
    mid = uuid4()
    try:
        size, sha = await storage.put(org_id, mid, chunks)
    except storage.TooLarge:
        raise HTTPException(413, "model_too_large") from None
    try:
        async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
            if await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id) is None:
                raise HTTPException(404, "site not found")
            n = await tc.fetchval("SELECT count(*) FROM plant_models WHERE site_id=$1", site_id)
            if n >= _MAX_MODELS_PER_SITE:
                raise HTTPException(409, "model_limit_reached")
            row = await tc.fetchrow(
                "INSERT INTO plant_models(id, org_id, site_id, name, filename, size_bytes,"
                " sha256, storage_key, node_count, active, created_by)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
                mid, org_id, site_id, title, fname, size, sha, storage.key(org_id, mid),
                info["node_count"], n == 0, p.user_id)   # first upload goes live
            await audit.append(tc, f"user:{p.user_id}", "plant_model.uploaded",
                               {"model_id": str(mid)},
                               {"filename": fname, "size_bytes": size, "nodes": info["node_count"]})
    except BaseException:
        storage.delete(org_id, mid)   # no orphan object when the insert fails
        raise
    return {"model": _model_json(row, 0)}


@router.get("/api/v1/orgs/{org}/sites/{site}/plant-models/active")
async def active_model(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        row = await tc.fetchrow(
            "SELECT * FROM plant_models WHERE site_id=$1 AND active", site_id)
        parts = [] if row is None else await tc.fetch(
            "SELECT * FROM plant_parts WHERE model_id=$1 ORDER BY sort, label", row["id"])
    return {"model": None if row is None else _model_json(row),
            "parts": [_part_json(r) for r in parts]}


@router.get("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}")
async def get_model(org: str, site: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    mid = m._uuid_or_404(model, "plant model")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        row = await _model_or_404(tc, site_id, mid)
        parts = await tc.fetch(
            "SELECT * FROM plant_parts WHERE model_id=$1 ORDER BY sort, label", mid)
    return {"model": _model_json(row), "parts": [_part_json(r) for r in parts]}


@router.get("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}/file")
async def model_file(org: str, site: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    mid = m._uuid_or_404(model, "plant model")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        row = await _model_or_404(tc, site_id, mid)
    if not storage.exists(org_id, mid):
        raise HTTPException(404, "plant model file missing")
    return StreamingResponse(
        storage.open_stream(org_id, mid), media_type="model/gltf-binary",
        headers={"Content-Length": str(row["size_bytes"]), "ETag": f'"{row["sha256"]}"',
                 "Cache-Control": "private, max-age=3600"})


@router.patch("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}")
async def rename_model(org: str, site: str, model: str, body: ModelPatch, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    mid = m._uuid_or_404(model, "plant model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "UPDATE plant_models SET name=$3 WHERE id=$1 AND site_id=$2 RETURNING *",
            mid, site_id, body.name)
        if row is None:
            raise HTTPException(404, "plant model not found")
    return {"model": _model_json(row)}


@router.post("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}/activate")
async def activate_model(org: str, site: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    mid = m._uuid_or_404(model, "plant model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _model_or_404(tc, site_id, mid)
        await tc.execute("UPDATE plant_models SET active=false WHERE site_id=$1 AND active", site_id)
        row = await tc.fetchrow("UPDATE plant_models SET active=true WHERE id=$1 RETURNING *", mid)
        await audit.append(tc, f"user:{p.user_id}", "plant_model.activated",
                           {"model_id": str(mid)}, {})
    return {"model": _model_json(row)}


@router.delete("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}", status_code=204)
async def delete_model(org: str, site: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    mid = m._uuid_or_404(model, "plant model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM plant_models WHERE id=$1 AND site_id=$2 RETURNING id", mid, site_id)
        if gone is None:
            raise HTTPException(404, "plant model not found")
        await audit.append(tc, f"user:{p.user_id}", "plant_model.deleted",
                           {"model_id": str(mid)}, {})
    storage.delete(org_id, mid)


def _check_part(part: PartIn, node_count: int, tags: dict[str, asyncpg.Record]) -> None:
    kind = KINDS.get(part.kind)
    if kind is None:
        raise HTTPException(422, f"unknown kind {part.kind!r}")
    if part.nodes[-1] >= node_count:
        raise HTTPException(422, f"{part.label}: node index out of range")
    try:
        part.params = clean_params(part.kind, part.params)
    except ValueError as e:
        raise HTTPException(422, f"{part.label}: {e}") from None
    if len(part.bindings) > MAX_BINDINGS:
        raise HTTPException(422, f"{part.label}: too many bindings")
    for role, path in part.bindings.items():
        spec = kind["roles"].get(role)
        if spec is None:
            raise HTTPException(422, f"{part.label}: role {role!r} is not valid for {part.kind}")
        tag = tags.get(path)
        if tag is None:
            raise HTTPException(422, f"{part.label}: tag {path!r} does not exist in this site")
        if tag["type"] != spec["type"]:
            raise HTTPException(422, f"{part.label}.{role}: tag {path!r} is {tag['type']}, "
                                     f"role needs {spec['type']}")
        if spec["writable"] and not tag["writable"]:
            raise HTTPException(422, f"{part.label}.{role}: tag {path!r} is read-only")


@router.put("/api/v1/orgs/{org}/sites/{site}/plant-models/{model}/parts")
async def put_parts(org: str, site: str, model: str, body: PartsIn, request: Request,
                    p=Depends(_user)):
    """Replace the whole mapping — the editor holds the full list."""
    import json
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    mid = m._uuid_or_404(model, "plant model")
    await m._mutation_gate(request, p.user_id)
    labels = [x.label for x in body.parts]
    if len(set(labels)) != len(labels):
        raise HTTPException(422, "part labels must be unique")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        mrow = await _model_or_404(tc, site_id, mid)
        trows = await tc.fetch("SELECT path, type, writable FROM tags WHERE site_id=$1", site_id)
        tags = {r["path"]: r for r in trows}
        for part in body.parts:
            _check_part(part, mrow["node_count"], tags)
        await tc.execute("DELETE FROM plant_parts WHERE model_id=$1", mid)
        for i, part in enumerate(body.parts):
            await tc.execute(
                "INSERT INTO plant_parts(org_id, model_id, label, kind, nodes, bindings, params, sort)"
                " VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",
                org_id, mid, part.label, part.kind, part.nodes, json.dumps(part.bindings),
                json.dumps(part.params), i)
        await audit.append(tc, f"user:{p.user_id}", "plant_model.mapped",
                           {"model_id": str(mid)}, {"parts": len(body.parts)})
        rows = await tc.fetch(
            "SELECT * FROM plant_parts WHERE model_id=$1 ORDER BY sort, label", mid)
    return {"parts": [_part_json(r) for r in rows]}


# ---------------------------------------------------------------------------
# Simulated tags for equipment that has no real tag yet. They live in their own
# sim source on the site's edge, so they can be deleted/replaced with real PLC
# tags from the data-sources page without touching the mapping's shape.
# ---------------------------------------------------------------------------
AUTO_SOURCE = "Auto plant (sim)"
_SIM_PATH = re.compile(r"^auto/[a-z0-9_]{1,40}/[a-z0-9_]{1,40}$")


class SimTagIn(BaseModel):
    path: str
    type: Literal["bool", "number"]
    writable: bool = False
    unit: str | None = Field(default=None, max_length=32)
    min: float | None = None
    max: float | None = None
    behavior: Literal["state", "follow", "cycle", "wander"] = "state"
    initial: bool | float = 0
    follows: str | None = None
    invert: bool | None = None
    gain: float | None = None
    offset: float | None = None
    lag: float | None = None
    period: float | None = None
    lo: float | None = None
    hi: float | None = None

    @field_validator("path")
    @classmethod
    def _path(cls, v: str) -> str:
        if not _SIM_PATH.match(v):
            raise ValueError("path must look like auto/<equipment>/<signal> (a-z, 0-9, _)")
        return v


class SimTagsIn(BaseModel):
    tags: list[SimTagIn] = Field(min_length=1, max_length=200)


@router.post("/api/v1/orgs/{org}/sites/{site}/plant-sim-tags", status_code=201)
async def create_sim_tags(org: str, site: str, body: SimTagsIn, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    created: list[str] = []
    existing: list[str] = []
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        edge = await tc.fetchrow(
            "SELECT id, site_id FROM edges WHERE site_id=$1 AND status='active'"
            " ORDER BY created_at LIMIT 1", site_id)
        if edge is None:
            raise HTTPException(409, "no_active_edge")
        src = await tc.fetchrow(
            "INSERT INTO data_sources(org_id, site_id, edge_id, name, protocol)"
            " VALUES ($1,$2,$3,$4,'sim') ON CONFLICT (org_id, edge_id, name)"
            " DO UPDATE SET name = excluded.name RETURNING *", org_id, site_id, edge["id"], AUTO_SOURCE)
        known = {r["path"] for r in await tc.fetch("SELECT path FROM tags WHERE site_id=$1", site_id)}
        batch = {t.path for t in body.tags}
        todo = [t for t in body.tags if t.path not in known]
        await plans.check_limit(tc, org_id, "max_tags", extra=len(todo))
        cache: dict = {}
        for t in body.tags:
            if t.path in known:
                existing.append(t.path)
                continue
            if t.follows is not None and t.follows not in known and t.follows not in batch:
                raise HTTPException(422, f"{t.path}: follows unknown tag {t.follows!r}")
            _, device, signal = t.path.split("/")
            addr = {"behavior": t.behavior, "initial": t.initial}
            for k in ("follows", "invert", "gain", "offset", "lag", "period", "lo", "hi"):
                v = getattr(t, k)
                if v is not None:
                    addr[k] = v
            try:
                spec = build_tag("sim", TagSpec(
                    line="auto", device=device, signal=signal, address=addr, type=t.type,
                    unit=t.unit, writable=t.writable, min=t.min, max=t.max))
            except AddressError as e:
                raise HTTPException(422, f"{t.path}: {e}") from None
            await _insert_tag(tc, org_id, site_id, src, spec, cache)
            created.append(t.path)
            known.add(t.path)
        ver = None
        if created:
            ver = await bump_config(tc, edge["id"])
            await audit.append(tc, f"user:{p.user_id}", "plant_sim_tags.created",
                               {"source_id": str(src["id"])}, {"count": len(created)})
    if created:
        await _after_commit(request)
    return {"created": created, "existing": existing, "config_version": ver}
