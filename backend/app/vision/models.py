"""Vision model registry: models, immutable versions, upload + inspection,
activation with licence attestation (plan M1-04 T3; roadmap 9.1, 9.3).

`.onnx` uploads are inspected here (bounded subprocess). `.pt` uploads are
never opened by the backend: they go to the converter spool and come back as
an ONNX through `ingest_conversions`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z
from . import spool, storage
from .inspect import MAX_CLASSES, InspectError, run_inspect

log = logging.getLogger("wds.vision.models")
router = APIRouter()

_V = "/api/v1/orgs/{org}/vision/models"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class ModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    task: str = Field(pattern="^(detect|segment)$")


class ClassesIn(BaseModel):
    names: list[str] = Field(min_length=1, max_length=MAX_CLASSES)


class AttestIn(BaseModel):
    attest: bool


def version_json(r, task: str | None = None) -> dict:
    return {
        "id": str(r["id"]), "model_id": str(r["model_id"]), "version": r["version"], "status": r["status"],
        "task": task, "source_format": r["source_format"], "sha256": r["sha256"], "size_bytes": r["size_bytes"],
        "imgsz": r["imgsz"], "stride": r["stride"], "classes": r["classes"], "class_count": r["class_count"],
        "ultralytics_version": r["ultralytics_version"], "opset": r["opset"], "notes": r["notes"],
        "failure_reason": r["failure_reason"],
        "license_attested_at": iso_z(r["license_attested_at"]) if r["license_attested_at"] else None,
        "created_at": iso_z(r["created_at"]),
    }


def _refusal(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": code, "message": message})


async def _model_or_404(tc, model_id: UUID, *, lock: bool = False):
    row = await tc.fetchrow("SELECT * FROM vision_models WHERE id=$1" + (" FOR UPDATE" if lock else ""), model_id)
    if row is None:
        raise HTTPException(404, "model not found")
    return row


def _ids(org: str, model: str | None, p, need: str, version: str | None = None):
    m = _m()
    org_id = m._v2_org(org, p, need)
    return (org_id, m._uuid_or_404(model, "model") if model else None,
            m._uuid_or_404(version, "version") if version else None)


# ------------------------------------------------------------------ models
@router.post(_V, status_code=201)
async def create_model(org: str, body: ModelIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, _, _ = _ids(org, None, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                "INSERT INTO vision_models(org_id, name, task, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
                org_id, body.name.strip(), body.task, p.user_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "model_name_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "vision.model.created", {"model_id": str(row["id"])},
                           {"name": row["name"], "task": row["task"]})
    return {"model": _model_json(row)}


def _model_json(r) -> dict:
    d = {"id": str(r["id"]), "name": r["name"], "task": r["task"], "created_at": iso_z(r["created_at"])}
    for k in ("version_count", "active_version"):
        if k in r:
            d[k] = r[k]
    return d


@router.get(_V)
async def list_models(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, _, _ = _ids(org, None, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT m.*, (SELECT count(*) FROM vision_model_versions v WHERE v.model_id=m.id)::int AS version_count,"
            " (SELECT max(v.version) FROM vision_model_versions v WHERE v.model_id=m.id AND v.status='active')"
            " AS active_version FROM vision_models m ORDER BY m.name")
    return {"items": [_model_json(r) for r in rows]}


@router.delete(_V + "/{model}", status_code=204)
async def delete_model(org: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, _ = _ids(org, model, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _model_or_404(tc, model_id)
        vids = [r["id"] for r in await tc.fetch("SELECT id FROM vision_model_versions WHERE model_id=$1", model_id)]
        try:
            await tc.execute("DELETE FROM vision_models WHERE id=$1", model_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(409, "version_pinned") from None
        await audit.append(tc, f"user:{p.user_id}", "vision.model.deleted", {"model_id": str(model_id)}, {})
    for v in vids:
        _remove_files(org_id, v)


def _remove_files(org_id: UUID, version_id: UUID) -> None:
    with contextlib.suppress(OSError):
        os.remove(storage.model_path(org_id, version_id))
    spool.cleanup(version_id)


# ---------------------------------------------------------------- versions
@router.get(_V + "/{model}/versions")
async def list_versions(org: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, _ = _ids(org, model, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        mo = await _model_or_404(tc, model_id)
        rows = await tc.fetch("SELECT * FROM vision_model_versions WHERE model_id=$1 ORDER BY version DESC", model_id)
    return {"items": [version_json(r, mo["task"]) for r in rows]}


@router.get(_V + "/{model}/versions/{version}")
async def get_version(org: str, model: str, version: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, vid = _ids(org, model, p, m._READ, version)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        mo = await _model_or_404(tc, model_id)
        r = await tc.fetchrow("SELECT * FROM vision_model_versions WHERE id=$1 AND model_id=$2", vid, model_id)
    if r is None:
        raise HTTPException(404, "version not found")
    return {"version": version_json(r, mo["task"])}


_INSERT = ("INSERT INTO vision_model_versions(id, org_id, model_id, version, status, source_format, artifact_key,"
           " sha256, size_bytes, imgsz, stride, classes, class_count, ultralytics_version, opset, notes, created_by)"
           " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *")


@router.post(_V + "/{model}/versions", status_code=201)
async def upload_version(org: str, model: str, request: Request, filename: str = "model.onnx",
                         notes: str = "", p=Depends(_user)):
    m = _m()
    org_id, model_id, _ = _ids(org, model, p, m._CONFIG)
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in ("onnx", "pt"):
        raise HTTPException(415, "only .onnx and .pt files are accepted")
    await m._mutation_gate(request, p.user_id)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > storage.MAX_MODEL_BYTES:
        raise HTTPException(413, "model_too_large")
    pools = m.st(request).pools
    async with tenant_tx(pools.app, org_id) as tc:
        mo = await _model_or_404(tc, model_id)

    vid = uuid4()
    dest = storage.model_path(org_id, vid) if ext == "onnx" else spool.pt_path(vid)
    try:
        size, sha = await storage.put_file(dest, request.stream(), storage.MAX_MODEL_BYTES)
    except storage.TooLarge:
        raise HTTPException(413, "model_too_large") from None
    info = None
    try:
        if ext == "onnx":
            try:
                info = await asyncio.to_thread(run_inspect, dest)
            except InspectError as e:
                os.remove(dest)
                return _refusal(422, e.code, e.message)
            if info["task"] != mo["task"]:
                os.remove(dest)
                return _refusal(422, "task_mismatch",
                                f"this file is a {info['task']} model but the registry entry is {mo['task']}")
        async with tenant_tx(pools.app, org_id, p.user_id) as tc:
            await _model_or_404(tc, model_id, lock=True)       # serialises version numbering
            n = await tc.fetchval("SELECT coalesce(max(version), 0) + 1 FROM vision_model_versions WHERE model_id=$1",
                                  model_id)
            if info is not None:
                row = await tc.fetchrow(
                    _INSERT, vid, org_id, model_id, n, "draft", "onnx", storage.model_key(org_id, vid), sha, size,
                    info["imgsz"], info["stride"], info["classes"], info["class_count"],
                    info["ultralytics_version"], info["opset"], notes[:500] or None, p.user_id)
            else:
                row = await tc.fetchrow(
                    _INSERT, vid, org_id, model_id, n, "processing", "pt", None, None, None, None, None, None,
                    None, None, None, notes[:500] or None, p.user_id)
            await audit.append(tc, f"user:{p.user_id}", "vision.version.uploaded",
                               {"model_id": str(model_id), "version_id": str(vid)},
                               {"version": n, "format": ext, "size_bytes": size})
        if ext == "pt":
            spool.enqueue(vid, mo["task"])
    except BaseException:
        _remove_files(org_id, vid)
        raise
    return JSONResponse(status_code=201, content={"version": version_json(row, mo["task"])})


@router.post(_V + "/{model}/versions/{version}/classes")
async def set_classes(org: str, model: str, version: str, body: ClassesIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, vid = _ids(org, model, p, m._CONFIG, version)
    names = [n.strip()[:80] for n in body.names]
    if not all(names):
        return _refusal(422, "bad_names", "class names must not be empty")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        mo = await _model_or_404(tc, model_id)
        cur = await tc.fetchrow("SELECT * FROM vision_model_versions WHERE id=$1 AND model_id=$2 FOR UPDATE",
                                vid, model_id)
        if cur is None:
            raise HTTPException(404, "version not found")
        if cur["status"] != "draft" or cur["classes"] is not None:
            raise HTTPException(409, "classes_already_set")
        if cur["class_count"] is not None and cur["class_count"] != len(names):
            return _refusal(422, "class_count_mismatch",
                            f"the model has {cur['class_count']} classes but {len(names)} names were given")
        row = await tc.fetchrow("UPDATE vision_model_versions SET classes=$2 WHERE id=$1 RETURNING *", vid, names)
        await audit.append(tc, f"user:{p.user_id}", "vision.version.classes_set",
                           {"version_id": str(vid)}, {"count": len(names)})
    return {"version": version_json(row, mo["task"])}


@router.post(_V + "/{model}/versions/{version}/activate")
async def activate(org: str, model: str, version: str, body: AttestIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, vid = _ids(org, model, p, m._CONFIG, version)
    if not body.attest:
        raise HTTPException(400, "attestation_required")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        mo = await _model_or_404(tc, model_id)
        row = await tc.fetchrow(
            "UPDATE vision_model_versions SET status='active', license_attested_by=$3, license_attested_at=now()"
            " WHERE id=$1 AND model_id=$2 AND status='draft' AND classes IS NOT NULL RETURNING *",
            vid, model_id, p.user_id)
        if row is None:
            cur = await tc.fetchrow("SELECT status, classes FROM vision_model_versions WHERE id=$1 AND model_id=$2",
                                    vid, model_id)
            if cur is None:
                raise HTTPException(404, "version not found")
            raise HTTPException(409, "classes_required" if cur["status"] == "draft" and cur["classes"] is None
                                else "bad_state")
        await audit.append(tc, f"user:{p.user_id}", "vision.version.activated", {"version_id": str(vid)},
                           {"license_attested": True})
    return {"version": version_json(row, mo["task"])}


@router.post(_V + "/{model}/versions/{version}/archive")
async def archive(org: str, model: str, version: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, vid = _ids(org, model, p, m._CONFIG, version)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        mo = await _model_or_404(tc, model_id)
        row = await tc.fetchrow(
            "UPDATE vision_model_versions v SET status='archived' WHERE v.id=$1 AND v.model_id=$2 AND v.status='active'"
            " AND NOT EXISTS (SELECT 1 FROM camera_models c WHERE c.model_version_id=v.id) RETURNING *", vid, model_id)
        if row is None:
            cur = await tc.fetchrow("SELECT status FROM vision_model_versions WHERE id=$1 AND model_id=$2", vid, model_id)
            if cur is None:
                raise HTTPException(404, "version not found")
            raise HTTPException(409, "version_pinned" if cur["status"] == "active" else "bad_state")
        await audit.append(tc, f"user:{p.user_id}", "vision.version.archived", {"version_id": str(vid)}, {})
    return {"version": version_json(row, mo["task"])}


@router.delete(_V + "/{model}/versions/{version}", status_code=204)
async def delete_version(org: str, model: str, version: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, model_id, vid = _ids(org, model, p, m._CONFIG, version)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _model_or_404(tc, model_id)
        try:
            gone = await tc.fetchval(
                "DELETE FROM vision_model_versions WHERE id=$1 AND model_id=$2"
                " AND status IN ('draft','failed','archived') RETURNING id", vid, model_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(409, "version_pinned") from None
        if gone is None:
            if await tc.fetchval("SELECT 1 FROM vision_model_versions WHERE id=$1 AND model_id=$2", vid, model_id):
                raise HTTPException(409, "bad_state")
            raise HTTPException(404, "version not found")
        await audit.append(tc, f"user:{p.user_id}", "vision.version.deleted", {"version_id": str(vid)}, {})
    _remove_files(org_id, vid)


# -------------------------------------------------------- converter results
async def ingest_once(pools) -> int:
    """Collect finished conversions and expire stale ones. Returns jobs handled."""
    handled = 0
    for jid, doc in spool.results():
        try:
            async with global_tx(pools.system) as conn:
                row = await conn.fetchrow("SELECT org_id FROM vision_model_versions WHERE id=$1", jid)
            if row is None:                      # the version was deleted meanwhile
                spool.cleanup(jid)
                continue
            org_id = row["org_id"]
            fields: dict = {"status": "failed", "failure_reason": str(doc.get("error") or "conversion failed")[:500]}
            if doc.get("ok") is True and spool.onnx_path(jid).exists():
                dest = storage.model_path(org_id, jid)
                dest.parent.mkdir(parents=True, exist_ok=True)
                os.replace(spool.onnx_path(jid), dest)
                try:
                    info = await asyncio.to_thread(run_inspect, dest)
                    size, sha = dest.stat().st_size, _sha(dest)
                    fields = {"status": "draft", "artifact_key": storage.model_key(org_id, jid), "sha256": sha,
                              "size_bytes": size, "imgsz": info["imgsz"], "stride": info["stride"],
                              "classes": info["classes"], "class_count": info["class_count"],
                              "ultralytics_version": info["ultralytics_version"], "opset": info["opset"]}
                except InspectError as e:
                    with contextlib.suppress(OSError):
                        os.remove(dest)
                    fields = {"status": "failed", "failure_reason": f"{e.code}: {e.message}"[:500]}
            await _apply(pools, org_id, jid, fields)
            spool.cleanup(jid)
            handled += 1
        except Exception:  # noqa: BLE001 — one bad job must not stop the loop
            log.exception("conversion ingest failed for %s", jid)
    return handled


def _sha(path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


async def _apply(pools, org_id: UUID, vid: UUID, fields: dict) -> None:
    from ..db.context import tenant_tx as tx
    cols = list(fields)
    sets = ", ".join(f"{c}=${i + 2}" for i, c in enumerate(cols))
    async with tx(pools.system, org_id) as tc:
        await tc.execute(f"UPDATE vision_model_versions SET {sets} WHERE id=$1 AND status='processing'",
                         vid, *[fields[c] for c in cols])


async def expire_stale(pools) -> None:
    async with global_tx(pools.system) as conn:
        rows = await conn.fetch(
            "SELECT id, org_id FROM vision_model_versions WHERE status='processing' AND created_at < now() - $1::interval",
            f"{spool.STALE_S} seconds")
    for r in rows:
        await _apply(pools, r["org_id"], r["id"], {"status": "failed", "failure_reason": "conversion timed out"})
        spool.cleanup(r["id"])


async def ingest_loop(pools, period_s: float = 2.0) -> None:
    last_sweep = 0.0
    while True:
        try:
            await ingest_once(pools)
            if time.monotonic() - last_sweep > 60:
                last_sweep = time.monotonic()
                await expire_stale(pools)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("conversion ingest loop error")
        await asyncio.sleep(period_s)
