"""Data-source + tag CRUD (spec 5.2 / 5.6 / 8).

Mounted from main.py. Auth helpers (`_v2_org`, `_mutation_gate`, `st`,
`require_user`) live in main.py and are resolved lazily at call time so this
module has no import-time dependency on it.

Every source/tag write bumps `edges.config_version` and NOTIFYs `wds_cfg`
(edge id; the cfg publisher listens) and `wds_tags` (org id; registries
refresh) inside the SAME transaction as the write.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from ..tenancy import plans
from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z
from . import secretbox
from .addresses import AddressError, parse_address, validate_connection
from .taginput import BulkError, TagSpec, build_tag, parse_bulk_csv

log = logging.getLogger("wds.datasources")

router = APIRouter()

CFG_CHANNEL = "wds_cfg"
TAGS_CHANNEL = "wds_tags"
BULK_MAX_BYTES = 1_000_000


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


# ------------------------------------------------------------------ models
class SourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    protocol: Literal["sim", "modbus", "s7", "opcua"]
    connection: dict = Field(default_factory=dict)
    poll_ms: int = Field(default=1000, ge=100, le=60000)
    enabled: bool = True
    secrets: dict | None = None


class SourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    connection: dict | None = None
    poll_ms: int | None = Field(default=None, ge=100, le=60000)
    enabled: bool | None = None
    secrets: dict | None = None  # replaces; {} clears


class TagPatch(BaseModel):
    address: str | dict | None = None
    type: str | None = None
    unit: str | None = Field(default=None, max_length=32)
    writable: bool | None = None
    min: float | None = None
    max: float | None = None
    scale: float | None = None
    offset: float | None = None
    deadband: float | None = Field(default=None, ge=0)


# ----------------------------------------------------------------- helpers
def _bad_field(e: AddressError) -> JSONResponse:
    return JSONResponse(status_code=422, content={
        "detail": "invalid_field", "field": e.field, "message": e.message})


def _seal(secrets: dict | None) -> bytes | None:
    if not secrets:
        return None
    try:
        return secretbox.seal(secrets)
    except (ValueError, TypeError):
        raise HTTPException(422, "secrets_invalid_or_too_large (max 4 KB JSON)") from None


def _source_json(r) -> dict:
    return {
        "id": str(r["id"]), "org_id": str(r["org_id"]), "site_id": str(r["site_id"]),
        "edge_id": str(r["edge_id"]), "name": r["name"], "protocol": r["protocol"],
        "connection": r["connection"], "poll_ms": r["poll_ms"], "enabled": r["enabled"],
        "has_secret": r["secret_enc"] is not None, "status": r["status"],
        "status_detail": r["status_detail"],
        "status_at": iso_z(r["status_at"]) if r["status_at"] else None,
        "created_at": iso_z(r["created_at"]), "updated_at": iso_z(r["updated_at"]),
        **({"tag_count": r["tag_count"]} if "tag_count" in r else {}),
    }


_TAG_SELECT = (
    "SELECT t.id, t.org_id, t.site_id, t.edge_id, t.source_id, t.path, t.name,"
    " t.type, t.unit, t.writable, t.min_value, t.max_value, t.scale,"
    " t.offset_value, t.deadband, t.address, l.name AS line, d.name AS device"
    " FROM tags t LEFT JOIN devices d ON d.org_id=t.org_id AND d.id=t.device_id"
    " LEFT JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id")


def _tag_json(r) -> dict:
    return {
        "id": str(r["id"]), "site_id": str(r["site_id"]),
        "edge_id": str(r["edge_id"]) if r["edge_id"] else None,
        "source_id": str(r["source_id"]) if r["source_id"] else None,
        "line": r["line"], "device": r["device"], "path": r["path"], "name": r["name"],
        "type": r["type"], "unit": r["unit"], "writable": r["writable"],
        "min": r["min_value"], "max": r["max_value"], "scale": r["scale"],
        "offset": r["offset_value"], "deadband": r["deadband"],
        "address": r["address"],
    }


async def bump_config(tc, edge_id: UUID) -> int:
    """Increment the edge's config_version and wake the cfg publisher and the
    registries. MUST be called in the same transaction as the write."""
    v = await tc.fetchval(
        "UPDATE edges SET config_version = config_version + 1 WHERE id=$1"
        " RETURNING config_version", edge_id)
    await tc.execute("SELECT pg_notify($1, $2)", CFG_CHANNEL, str(edge_id))
    await tc.execute("SELECT pg_notify($1, $2)", TAGS_CHANNEL, str(tc.org_id))
    return v


async def _edge_or_404(tc, edge_id: UUID, *, write: bool):
    e = await tc.fetchrow("SELECT id, site_id, status FROM edges WHERE id=$1", edge_id)
    if e is None:
        raise HTTPException(404, "edge not found")
    if write and e["status"] == "disabled":
        raise HTTPException(409, "edge_disabled")
    return e


async def _source_or_404(tc, edge_id: UUID, source_id: UUID, *, lock: bool = False):
    s = await tc.fetchrow(
        "SELECT * FROM data_sources WHERE id=$1 AND edge_id=$2"
        + (" FOR UPDATE" if lock else ""), source_id, edge_id)
    if s is None:
        raise HTTPException(404, "source not found")
    return s


def _ids(request_org: str, edge: str, p, need: str, source: str | None = None,
         tag: str | None = None):
    m = _m()
    org_id = m._v2_org(request_org, p, need)
    edge_id = m._uuid_or_404(edge, "edge")
    sid = m._uuid_or_404(source, "source") if source is not None else None
    tid = m._uuid_or_404(tag, "tag") if tag is not None else None
    return org_id, edge_id, sid, tid


async def _after_commit(request: Request) -> None:
    # same-process registry is current immediately; other replicas follow
    # wds_tags. A refresh failure must not fail an already-committed write.
    with contextlib.suppress(Exception):
        await _m().st(request).registry.refresh()


async def _line_device(tc, org_id: UUID, site_id: UUID, line: str, device: str,
                       cache: dict) -> UUID:
    key = (line, device)
    if key in cache:
        return cache[key]
    lid = await tc.fetchval(
        "INSERT INTO lines(org_id, site_id, name) VALUES ($1,$2,$3)"
        " ON CONFLICT (org_id, site_id, name) DO UPDATE SET name=EXCLUDED.name"
        " RETURNING id", org_id, site_id, line)
    did = await tc.fetchval(
        "INSERT INTO devices(org_id, line_id, name) VALUES ($1,$2,$3)"
        " ON CONFLICT (org_id, line_id, name) DO UPDATE SET name=EXCLUDED.name"
        " RETURNING id", org_id, lid, device)
    cache[key] = did
    return did


async def _insert_tag(tc, org_id: UUID, site_id: UUID, src, t: dict, cache: dict):
    did = await _line_device(tc, org_id, site_id, t["line"], t["device"], cache)
    return await tc.fetchval(
        "INSERT INTO tags(org_id, site_id, edge_id, device_id, path, name, type,"
        " unit, writable, min_value, max_value, source_id, address, scale,"
        " offset_value, deadband)"
        " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)"
        " RETURNING id",
        org_id, site_id, src["edge_id"], did, t["path"], t["name"], t["type"],
        t["unit"], t["writable"], t["min_value"], t["max_value"], src["id"],
        t["address"], t["scale"], t["offset_value"], t["deadband"])


# ----------------------------------------------------------------- sources
@router.get("/api/v1/orgs/{org}/edges/{edge}/sources")
async def list_sources(org: str, edge: str, request: Request, p=Depends(_user)):
    org_id, edge_id, _, _ = _ids(org, edge, p, _m()._READ)
    async with tenant_tx(_m().st(request).pools.app, org_id) as tc:
        await _edge_or_404(tc, edge_id, write=False)
        rows = await tc.fetch(
            "SELECT s.*, (SELECT count(*) FROM tags t WHERE t.org_id=s.org_id"
            " AND t.source_id=s.id)::int AS tag_count"
            " FROM data_sources s WHERE s.edge_id=$1 ORDER BY s.name", edge_id)
    return {"items": [_source_json(r) for r in rows]}


@router.post("/api/v1/orgs/{org}/edges/{edge}/sources", status_code=201)
async def create_source(org: str, edge: str, body: SourceIn, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id, edge_id, _, _ = _ids(org, edge, p, m._CONFIG)
    try:
        conn = validate_connection(body.protocol, body.connection)
    except AddressError as e:
        return _bad_field(e)
    enc = _seal(body.secrets)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        e = await _edge_or_404(tc, edge_id, write=True)
        try:
            row = await tc.fetchrow(
                "INSERT INTO data_sources(org_id, site_id, edge_id, name, protocol,"
                " connection, secret_enc, poll_ms, enabled)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                org_id, e["site_id"], edge_id, body.name, body.protocol, conn, enc,
                body.poll_ms, body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "source_name_exists") from None
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "source.created",
                           {"source_id": str(row["id"]), "edge_id": str(edge_id)},
                           {"name": body.name, "protocol": body.protocol,
                            "has_secret": enc is not None})
    return {"source": _source_json(row), "config_version": ver}


@router.patch("/api/v1/orgs/{org}/edges/{edge}/sources/{source}")
async def patch_source(org: str, edge: str, source: str, body: SourcePatch,
                       request: Request, p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, _ = _ids(org, edge, p, m._CONFIG, source)
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(400, "invalid_request: nothing to update")
    for f in ("name", "poll_ms", "enabled", "connection"):
        if f in fields and getattr(body, f) is None:
            raise HTTPException(400, f"invalid_request: {f} cannot be null")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _edge_or_404(tc, edge_id, write=True)
        cur = await _source_or_404(tc, edge_id, sid, lock=True)
        try:
            conn = (validate_connection(cur["protocol"], body.connection)
                    if "connection" in fields else cur["connection"])
        except AddressError as e:
            return _bad_field(e)
        enc = cur["secret_enc"]
        if "secrets" in fields:
            enc = _seal(body.secrets)  # None / {} clears
        try:
            row = await tc.fetchrow(
                "UPDATE data_sources SET name=$2, connection=$3, secret_enc=$4,"
                " poll_ms=$5, enabled=$6, updated_at=now() WHERE id=$1 RETURNING *",
                sid, body.name if "name" in fields else cur["name"], conn, enc,
                body.poll_ms if "poll_ms" in fields else cur["poll_ms"],
                body.enabled if "enabled" in fields else cur["enabled"])
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "source_name_exists") from None
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "source.updated",
                           {"source_id": str(sid), "edge_id": str(edge_id)},
                           {"fields": sorted(fields - {"secrets"}),
                            "secrets_changed": "secrets" in fields})
    return {"source": _source_json(row), "config_version": ver}


@router.delete("/api/v1/orgs/{org}/edges/{edge}/sources/{source}", status_code=204)
async def delete_source(org: str, edge: str, source: str, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, _ = _ids(org, edge, p, m._CONFIG, source)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _edge_or_404(tc, edge_id, write=True)
        cur = await _source_or_404(tc, edge_id, sid, lock=True)
        n = await tc.fetchval("SELECT count(*) FROM tags WHERE source_id=$1", sid)
        if n:
            return JSONResponse(status_code=409, content={
                "detail": "source_has_tags", "tag_count": n})
        await tc.execute("DELETE FROM data_sources WHERE id=$1", sid)
        await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "source.deleted",
                           {"source_id": str(sid), "edge_id": str(edge_id)},
                           {"name": cur["name"]})
    return Response(status_code=204)


# -------------------------------------------------------------------- tags
@router.get("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/tags")
async def list_source_tags(org: str, edge: str, source: str, request: Request,
                           p=Depends(_user)):
    org_id, edge_id, sid, _ = _ids(org, edge, p, _m()._READ, source)
    async with tenant_tx(_m().st(request).pools.app, org_id) as tc:
        await _edge_or_404(tc, edge_id, write=False)
        await _source_or_404(tc, edge_id, sid)
        rows = await tc.fetch(_TAG_SELECT + " WHERE t.source_id=$1 ORDER BY t.path", sid)
    return {"items": [_tag_json(r) for r in rows]}


@router.post("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/tags", status_code=201)
async def create_tag(org: str, edge: str, source: str, body: TagSpec,
                     request: Request, p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, _ = _ids(org, edge, p, m._CONFIG, source)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        e = await _edge_or_404(tc, edge_id, write=True)
        src = await _source_or_404(tc, edge_id, sid)
        try:
            t = build_tag(src["protocol"], body)
        except AddressError as ex:
            return _bad_field(ex)
        await plans.check_limit(tc, org_id, "max_tags")
        try:
            tid = await _insert_tag(tc, org_id, e["site_id"], src, t, {})
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "tag_exists") from None
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "tag.created",
                           {"tag_id": str(tid), "source_id": str(sid)}, {"path": t["path"]})
        row = await tc.fetchrow(_TAG_SELECT + " WHERE t.id=$1", tid)
    await _after_commit(request)
    return {"tag": _tag_json(row), "config_version": ver}


@router.post("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/tags:bulk",
             status_code=201)
async def bulk_tags(org: str, edge: str, source: str, request: Request,
                    p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, _ = _ids(org, edge, p, m._CONFIG, source)
    raw = await request.body()
    if len(raw) > BULK_MAX_BYTES:
        raise HTTPException(413, "csv_too_large")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(422, "csv_not_utf8") from None
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        e = await _edge_or_404(tc, edge_id, write=True)
        src = await _source_or_404(tc, edge_id, sid)
        try:
            tags = parse_bulk_csv(src["protocol"], text)
        except BulkError as ex:
            return JSONResponse(status_code=422, content={
                "detail": "invalid_csv", "errors": ex.errors})
        taken = {r["path"] for r in await tc.fetch(
            "SELECT path FROM tags WHERE site_id=$1 AND path = ANY($2::text[])",
            e["site_id"], [t["path"] for t in tags])}
        if taken:
            return JSONResponse(status_code=422, content={
                "detail": "invalid_csv", "errors": [
                    {"row": i + 2, "field": "signal",
                     "message": f"tag {t['path']} already exists"}
                    for i, t in enumerate(tags) if t["path"] in taken]})
        await plans.check_limit(tc, org_id, "max_tags", extra=len(tags))
        cache: dict = {}
        ids = [await _insert_tag(tc, org_id, e["site_id"], src, t, cache) for t in tags]
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "tag.bulk_created",
                           {"source_id": str(sid)}, {"count": len(ids)})
    await _after_commit(request)
    return {"created": len(ids), "tag_ids": [str(i) for i in ids], "config_version": ver}


@router.patch("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/tags/{tag}")
async def patch_tag(org: str, edge: str, source: str, tag: str, body: TagPatch,
                    request: Request, p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, tid = _ids(org, edge, p, m._CONFIG, source, tag)
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(400, "invalid_request: nothing to update")
    if "type" in fields and body.type is None:
        raise HTTPException(400, "invalid_request: type cannot be null")
    if "writable" in fields and body.writable is None:
        raise HTTPException(400, "invalid_request: writable cannot be null")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _edge_or_404(tc, edge_id, write=True)
        src = await _source_or_404(tc, edge_id, sid)
        cur = await tc.fetchrow(
            "SELECT * FROM tags WHERE id=$1 AND source_id=$2 FOR UPDATE", tid, sid)
        if cur is None:
            raise HTTPException(404, "tag not found")

        def pick(f: str, col: str):
            return getattr(body, f) if f in fields else cur[col]

        try:
            # re-validate the merged tag; identity segments are placeholders
            # (path never changes), the existing normalized address re-parses
            # idempotently so a type change is checked against it.
            merged = build_tag(src["protocol"], TagSpec(
                line="x", device="x", signal="x",
                address=body.address if "address" in fields else cur["address"],
                type=pick("type", "type"), unit=pick("unit", "unit"),
                writable=pick("writable", "writable"),
                min=pick("min", "min_value"), max=pick("max", "max_value"),
                scale=pick("scale", "scale"), offset=pick("offset", "offset_value"),
                deadband=pick("deadband", "deadband")))
        except AddressError as ex:
            return _bad_field(ex)
        await tc.execute(
            "UPDATE tags SET type=$2, unit=$3, writable=$4, min_value=$5,"
            " max_value=$6, scale=$7, offset_value=$8, deadband=$9, address=$10"
            " WHERE id=$1", tid, merged["type"], merged["unit"], merged["writable"],
            merged["min_value"], merged["max_value"], merged["scale"],
            merged["offset_value"], merged["deadband"], merged["address"])
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "tag.updated",
                           {"tag_id": str(tid), "source_id": str(sid)},
                           {"fields": sorted(fields)})
        row = await tc.fetchrow(_TAG_SELECT + " WHERE t.id=$1", tid)
    await _after_commit(request)
    return {"tag": _tag_json(row), "config_version": ver}


@router.delete("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/tags/{tag}",
               status_code=204)
async def delete_tag(org: str, edge: str, source: str, tag: str, request: Request,
                     p=Depends(_user)):
    m = _m()
    org_id, edge_id, sid, tid = _ids(org, edge, p, m._CONFIG, source, tag)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _edge_or_404(tc, edge_id, write=True)
        await _source_or_404(tc, edge_id, sid)
        cur = await tc.fetchrow(
            "SELECT path FROM tags WHERE id=$1 AND source_id=$2 FOR UPDATE", tid, sid)
        if cur is None:
            raise HTTPException(404, "tag not found")
        referrers = [
            {"kind": "alarm_rule", "id": str(r["id"]), "name": r["name"]}
            for r in await tc.fetch(
                "SELECT id, name FROM alarm_rules WHERE tag_id=$1", tid)]
        referrers += [
            {"kind": "command", "id": str(r["id"]), "status": r["status"]}
            for r in await tc.fetch(
                "SELECT id, status FROM commands WHERE tag_id=$1"
                " AND status IN ('accepted','dispatched')", tid)]
        referrers += [
            {"kind": "slo", "id": str(r["id"]), "name": r["name"]}
            for r in await tc.fetch("SELECT id, name FROM slos WHERE tag_id=$1", tid)]
        if referrers:
            return JSONResponse(status_code=409, content={
                "detail": "tag_in_use", "referrers": referrers})
        try:
            async with tc.conn.transaction():  # savepoint: keep tx usable on FK error
                await tc.execute("DELETE FROM tags WHERE id=$1", tid)
        except asyncpg.ForeignKeyViolationError:
            # e.g. command / alarm history still points at the tag
            return JSONResponse(status_code=409, content={
                "detail": "tag_in_use", "referrers": [{"kind": "history"}]})
        await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "tag.deleted",
                           {"tag_id": str(tid), "source_id": str(sid)},
                           {"path": cur["path"]})
    await _after_commit(request)
    return Response(status_code=204)


# ---------------------------------------------------- registry NOTIFY (5.6)
# ------------------------------------------------- edge ops (test / browse)
OP_TIMEOUT_S = 10


class SourceTestIn(BaseModel):
    protocol: Literal["sim", "modbus", "s7", "opcua"]
    connection: dict = Field(default_factory=dict)
    secrets: dict | None = None
    tags: list[dict] = Field(default_factory=list, max_length=200)


class BrowseIn(BaseModel):
    node_id: str | None = Field(default=None, max_length=512)


def _timeout() -> JSONResponse:
    return JSONResponse(status_code=504, content={"detail": "edge_timeout"})


async def _run_op(request: Request, p, org_id: UUID, edge_id: UUID, op: str,
                  payload: dict, audit_target: dict, audit_detail: dict):
    """Resolve the edge, ask it to run `op`, audit. Secrets only travel in
    `payload`; they are never part of the audit rows or the response."""
    m = _m()
    st = m.st(request)
    async with tenant_tx(st.pools.app, org_id, p.user_id) as tc:
        e = await _edge_or_404(tc, edge_id, write=True)
    try:
        result = await st.commands.request_op(
            org_id, e["site_id"], edge_id, op, payload, timeout_s=OP_TIMEOUT_S)
        outcome: JSONResponse | dict = result
    except TimeoutError:
        outcome = _timeout()
        audit_detail = {**audit_detail, "outcome": "edge_timeout"}
    except RuntimeError as exc:
        outcome = JSONResponse(status_code=502, content={
            "detail": "edge_error", "reason": str(exc)[:200]})
        audit_detail = {**audit_detail, "outcome": "edge_error"}
    async with tenant_tx(st.pools.app, org_id, p.user_id) as tc:
        await audit.append(tc, f"user:{p.user_id}", f"source.{op_audit(op)}",
                           audit_target, audit_detail)
    return outcome


def op_audit(op: str) -> str:
    return "test" if op == "test_source" else "browse"


@router.post("/api/v1/orgs/{org}/edges/{edge}/sources:test")
async def test_source(org: str, edge: str, body: SourceTestIn, request: Request,
                      p=Depends(_user)):
    """Dry-run a DRAFT source on the edge (read-only; never writes to a PLC)."""
    m = _m()
    org_id, edge_id, _, _ = _ids(org, edge, p, m._CONFIG)
    try:
        conn = validate_connection(body.protocol, body.connection)
        tags = []
        for i, t in enumerate(body.tags):
            ttype = t.get("type") or "float"
            tags.append({
                "id": str(t.get("id") or f"draft{i}"),
                "path": str(t.get("path") or f"draft/t{i}"),
                "type": ttype,
                "address": parse_address(body.protocol, t.get("address"), ttype),
                **{k: t[k] for k in ("scale", "offset", "writable", "min", "max")
                   if k in t},
            })
    except AddressError as e:
        return _bad_field(e)
    secrets = body.secrets if isinstance(body.secrets, dict) and body.secrets else None
    await m._mutation_gate(request, p.user_id)
    source = {"id": "draft", "protocol": body.protocol, "connection": conn,
              "secrets": secrets, "poll_ms": 1000, "enabled": True, "tags": tags}
    return await _run_op(
        request, p, org_id, edge_id, "test_source", {"source": source},
        {"edge_id": str(edge_id)},
        {"protocol": body.protocol, "tag_count": len(tags),
         "has_secret": secrets is not None})


@router.post("/api/v1/orgs/{org}/edges/{edge}/sources/{source}/browse")
async def browse_source(org: str, edge: str, source: str, body: BrowseIn,
                        request: Request, p=Depends(_user)):
    """One-level OPC UA node browse through the edge (stored secrets)."""
    m = _m()
    org_id, edge_id, sid, _ = _ids(org, edge, p, m._CONFIG, source)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _edge_or_404(tc, edge_id, write=True)
        s = await _source_or_404(tc, edge_id, sid)
    if s["protocol"] != "opcua":
        raise HTTPException(409, "browse_requires_opcua")
    secrets = None
    if s["secret_enc"] is not None:
        try:
            secrets = secretbox.open_(bytes(s["secret_enc"]))
        except Exception:  # noqa: BLE001 - never echo crypto details
            log.exception("source secret could not be opened")
            raise HTTPException(500, "secret_unreadable") from None
    draft = {"id": str(sid), "protocol": "opcua", "connection": s["connection"],
             "secrets": secrets, "poll_ms": s["poll_ms"], "enabled": True, "tags": []}
    return await _run_op(
        request, p, org_id, edge_id, "browse",
        {"source": draft, "node_id": body.node_id},
        {"source_id": str(sid), "edge_id": str(edge_id)},
        {"node_id": body.node_id})


async def tags_notify_listener(registry, pools) -> None:
    """LISTEN wds_tags on a dedicated system-pool connection; every NOTIFY
    refreshes the registry (coalesced). Reconnects forever; the registry's own
    30 s maybe_refresh remains the missed-NOTIFY backstop."""
    dirty = asyncio.Event()

    def kick(*_):
        dirty.set()

    while True:
        conn = None
        try:
            conn = await pools.system.acquire()
            await conn.add_listener(TAGS_CHANNEL, kick)
            log.info("wds_tags listener connected")
            while not conn.is_closed():
                try:
                    await asyncio.wait_for(dirty.wait(), timeout=30)
                except asyncio.TimeoutError:
                    continue
                dirty.clear()
                try:
                    await registry.refresh()
                except Exception:  # noqa: BLE001
                    log.exception("registry refresh on wds_tags failed")
            raise ConnectionError("wds_tags listener connection closed")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("wds_tags listener down - retrying in 5s")
            await asyncio.sleep(5)
        finally:
            if conn is not None:
                with contextlib.suppress(Exception):
                    await pools.system.release(conn)


__all__ = ["router", "bump_config", "tags_notify_listener"]
