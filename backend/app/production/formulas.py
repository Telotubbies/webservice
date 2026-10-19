"""Derived (calculated) tag API — spec 2026-10-19 §7.

  POST   /api/v1/orgs/{org}/sites/{site}/formulas/validate   any member
  GET    /api/v1/orgs/{org}/sites/{site}/derived-tags        any member
  POST   /api/v1/orgs/{org}/sites/{site}/derived-tags        admin/owner
  PATCH  /api/v1/orgs/{org}/sites/{site}/derived-tags/{tag}  admin/owner
  DELETE /api/v1/orgs/{org}/sites/{site}/derived-tags/{tag}  admin/owner

A formula changes values that alarms read, so every create/change/delete is
audited as `formula.changed` with the old and new expression.
"""

from __future__ import annotations

import contextlib
import json
import re
from datetime import datetime, timezone
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import finite_or_none, iso_z
from ..tenancy import plans
from . import derived as derived_mod
from .formula import (FormulaError, WindowStore, check_variables, combine_quality,
                      compile_formula, evaluate, find_cycle_or_depth)

router = APIRouter()

_PATH = re.compile(r"^[a-z0-9_]+(/[a-z0-9_]+){1,7}$")
_VAR = re.compile(r"^[a-z]$")


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class FormulaIn(BaseModel):
    expr: str = Field(max_length=2000)    # the language itself caps at 500 and says why
    inputs: dict[str, UUID] = Field(default_factory=dict, max_length=26)


class DerivedIn(FormulaIn):
    path: str = Field(max_length=200)
    name: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=32)
    device_id: UUID | None = None


class DerivedPatch(BaseModel):
    expr: str | None = Field(default=None, max_length=2000)
    inputs: dict[str, UUID] | None = Field(default=None, max_length=26)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=32)
    device_id: UUID | None = None


def _bad(code: str, pos: int = 0, **detail) -> JSONResponse:
    return JSONResponse(status_code=422, content={
        "detail": "invalid_formula", "error": {"code": code, "pos": pos, **detail}})


class _Invalid(Exception):
    def __init__(self, resp: JSONResponse):
        self.resp = resp


async def _check(tc, site_id: UUID, expr: str, inputs: dict[str, UUID],
                 self_id: UUID | None, self_path: str = "this tag") -> tuple:
    """Compile and cross-check one formula. Returns (compiled, used inputs,
    input rows by id). Raises _Invalid carrying the 422 response."""
    try:
        c = compile_formula(expr)
        for var in inputs:
            if not _VAR.match(var):
                raise FormulaError("bad_variable_name", 0, name=var)
        check_variables(c, inputs)
    except FormulaError as e:
        raise _Invalid(_bad(e.code, e.pos, **e.detail)) from None
    used = {v: inputs[v] for v in sorted(c.variables)}
    rows = {r["id"]: r for r in await tc.fetch(
        "SELECT id, path, type, source FROM tags WHERE site_id=$1 AND id = ANY($2::uuid[])",
        site_id, list(set(used.values())))}
    for var, tid in used.items():
        if tid not in rows:        # another site's tag is the same 422 as a missing one
            raise _Invalid(_bad("unknown_input", 0, name=var))
    graph: dict[str, set] = {}
    for r in await tc.fetch("SELECT tag_id, inputs FROM tag_formulas"):
        graph[str(r["tag_id"])] = {str(v) for v in dict(_json(r["inputs"])).values()}
    me = str(self_id or uuid4())
    graph[me] = {str(t) for t in used.values()}
    hit = find_cycle_or_depth(me, graph)
    if hit:
        names = {str(r["id"]): r["path"] for r in rows.values()}
        names[me] = self_path
        path = " → ".join(names.get(x, "…") for x in hit[1])
        raise _Invalid(_bad("cycle" if hit[0] == "cycle" else "too_deep", 0, path=path))
    return c, used, rows


def _json(v):
    return json.loads(v) if isinstance(v, str) else v


async def _preview(tc, c, used: dict, rows: dict) -> dict:
    latest = {r["tag_id"]: r for r in await tc.fetch(
        "SELECT tag_id, v, q, ts FROM tag_latest WHERE tag_id = ANY($1::uuid[])",
        list(set(used.values())))}
    now = datetime.now(timezone.utc)
    env, qs, shown = {}, [], []
    for var, tid in used.items():
        cur = latest.get(tid)
        shown.append({"var": var, "tag_id": str(tid), "path": rows[tid]["path"],
                      "value": cur["v"] if cur else None, "q": cur["q"] if cur else None})
        if cur is None:
            continue
        v = cur["v"]
        env[var] = float(v) if isinstance(v, (int, float)) else 0.0
        stale = (now - cur["ts"]).total_seconds() > derived_mod.STALE_INPUT_S
        qs.append("stale" if stale and cur["q"] == "good" else cur["q"])
    value, quality = None, None
    if len(env) == len(used):
        value = evaluate(c, env, WindowStore(c.windows), now.timestamp())
        quality = "bad" if value is None else combine_quality(qs)
    return {"ok": True, "type": "bool" if c.is_bool else "number",
            "value": value if isinstance(value, bool) else finite_or_none(value),
            "quality": quality, "inputs": shown, "windows": len(c.windows),
            "max_window_s": c.max_window_s}


@router.post("/api/v1/orgs/{org}/sites/{site}/formulas/validate")
async def validate(org: str, site: str, body: FormulaIn, request: Request, p=Depends(_user)):
    """Check a formula and show what it would give right now: 200 with
    `ok: true` and a preview, or 200 with `ok: false` and the error."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if not await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id):
            raise HTTPException(404, "site not found")
        try:
            c, used, rows = await _check(tc, site_id, body.expr, body.inputs, None)
        except _Invalid as e:
            # a check that finds a mistake is a normal answer, not a failed request
            return {"ok": False, "error": json.loads(e.resp.body)["error"]}
        return await _preview(tc, c, used, rows)


async def _paths(tc, rows) -> dict:
    ids = {UUID(v) for r in rows for v in _json(r["inputs"]).values()}
    if not ids:
        return {}
    return {str(r["id"]): r["path"] for r in await tc.fetch(
        "SELECT id, path FROM tags WHERE id = ANY($1::uuid[])", list(ids))}


def _tag_json(r, paths: dict) -> dict:
    inputs = {k: str(v) for k, v in _json(r["inputs"]).items()}
    return {"id": str(r["id"]), "path": r["path"], "name": r["name"], "unit": r["unit"],
            "type": r["type"], "expr": r["expr"], "version": r["version"],
            "inputs": inputs, "input_paths": {k: paths.get(v, v) for k, v in inputs.items()},
            "device_id": str(r["device_id"]) if r["device_id"] else None,
            "updated_at": iso_z(r["updated_at"])}


_LIST_SQL = ("SELECT t.id, t.path, t.name, t.unit, t.type, t.device_id, f.expr, f.inputs,"
             " f.version, f.updated_at FROM tags t JOIN tag_formulas f"
             " ON f.org_id=t.org_id AND f.tag_id=t.id WHERE t.site_id=$1")


@router.get("/api/v1/orgs/{org}/sites/{site}/derived-tags")
async def list_derived(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(_LIST_SQL + " ORDER BY t.path", site_id)
        paths = await _paths(tc, rows)
    return {"items": [_tag_json(r, paths) for r in rows]}


async def _device_ok(tc, site_id: UUID, device_id: UUID | None) -> None:
    if device_id is not None and not await tc.fetchval(
            "SELECT 1 FROM devices d JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
            " WHERE d.id=$1 AND l.site_id=$2", device_id, site_id):
        raise HTTPException(404, "device not found")


async def _after(request: Request, org_id: UUID) -> None:
    s = _m().st(request)
    with contextlib.suppress(Exception):
        await s.registry.refresh()
    with contextlib.suppress(Exception):
        await s.derived.reload(org_id)


@router.post("/api/v1/orgs/{org}/sites/{site}/derived-tags", status_code=201)
async def create_derived(org: str, site: str, body: DerivedIn, request: Request,
                         p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    if not _PATH.match(body.path):
        raise HTTPException(422, "invalid_path")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if not await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id):
            raise HTTPException(404, "site not found")
        await _device_ok(tc, site_id, body.device_id)
        try:
            c, used, _ = await _check(tc, site_id, body.expr, body.inputs, None, body.path)
        except _Invalid as e:
            return e.resp
        await plans.check_limit(tc, org_id, "max_tags")
        try:
            tid = await tc.fetchval(
                "INSERT INTO tags(org_id, site_id, device_id, path, name, type, unit,"
                " writable, source) VALUES ($1,$2,$3,$4,$5,$6,$7,false,'derived') RETURNING id",
                org_id, site_id, body.device_id, body.path,
                body.name or body.path.rsplit("/", 1)[-1],
                "bool" if c.is_bool else "number", body.unit)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "path_exists") from None
        await tc.execute(
            "INSERT INTO tag_formulas(org_id, tag_id, expr, inputs, updated_by)"
            " VALUES ($1,$2,$3,$4,$5)", org_id, tid, body.expr,
            {k: str(v) for k, v in used.items()}, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "formula.changed", {"tag_id": str(tid)},
                           {"action": "created", "path": body.path, "old_expr": None,
                            "new_expr": body.expr})
        row = await tc.fetchrow(_LIST_SQL + " AND t.id=$2", site_id, tid)
        paths = await _paths(tc, [row])
    await _after(request, org_id)
    return _tag_json(row, paths)


@router.patch("/api/v1/orgs/{org}/sites/{site}/derived-tags/{tag}")
async def patch_derived(org: str, site: str, tag: str, body: DerivedPatch, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    tid = m._uuid_or_404(tag, "tag")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow(_LIST_SQL + " AND t.id=$2 FOR UPDATE OF f", site_id, tid)
        if cur is None:
            raise HTTPException(404, "derived tag not found")
        expr = body.expr if body.expr is not None else cur["expr"]
        inputs = body.inputs if body.inputs is not None else {
            k: UUID(v) for k, v in _json(cur["inputs"]).items()}
        await _device_ok(tc, site_id, body.device_id)
        try:
            c, used, _ = await _check(tc, site_id, expr, inputs, tid, cur["path"])
        except _Invalid as e:
            return e.resp
        changed = expr != cur["expr"] or {k: str(v) for k, v in used.items()} != _json(cur["inputs"])
        await tc.execute(
            "UPDATE tags SET type=$2, name=COALESCE($3,name), unit=COALESCE($4,unit),"
            " device_id=COALESCE($5,device_id) WHERE id=$1",
            tid, "bool" if c.is_bool else "number", body.name, body.unit, body.device_id)
        await tc.execute(
            "UPDATE tag_formulas SET expr=$2, inputs=$3, updated_by=$4, updated_at=now(),"
            " version = version + $5 WHERE tag_id=$1",
            tid, expr, {k: str(v) for k, v in used.items()}, p.user_id, 1 if changed else 0)
        if changed:
            await audit.append(tc, f"user:{p.user_id}", "formula.changed", {"tag_id": str(tid)},
                               {"action": "updated", "path": cur["path"],
                                "old_expr": cur["expr"], "new_expr": expr})
        row = await tc.fetchrow(_LIST_SQL + " AND t.id=$2", site_id, tid)
        paths = await _paths(tc, [row])
    await _after(request, org_id)
    return _tag_json(row, paths)


@router.delete("/api/v1/orgs/{org}/sites/{site}/derived-tags/{tag}", status_code=204)
async def delete_derived(org: str, site: str, tag: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    tid = m._uuid_or_404(tag, "tag")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow(_LIST_SQL + " AND t.id=$2", site_id, tid)
        if cur is None:
            raise HTTPException(404, "derived tag not found")
        # another derived tag reads it: refuse, the dependant would silently stop
        for r in await tc.fetch("SELECT tag_id, inputs FROM tag_formulas WHERE tag_id <> $1", tid):
            if str(tid) in {str(v) for v in _json(r["inputs"]).values()}:
                raise HTTPException(409, "in_use_by_formula")
        try:
            await tc.execute("DELETE FROM tags WHERE id=$1", tid)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(409, "in_use") from None
        await audit.append(tc, f"user:{p.user_id}", "formula.changed", {"tag_id": str(tid)},
                           {"action": "deleted", "path": cur["path"],
                            "old_expr": cur["expr"], "new_expr": None})
    await _after(request, org_id)
