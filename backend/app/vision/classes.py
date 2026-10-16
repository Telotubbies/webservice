"""Camera model pin and per-class configuration (plan M1-04 T5; roadmap 9.3, 9.4).

Pure helpers first (unit-tested), then the routes. Class config is keyed by
class id (a string) because the model, not the name, is the stable identity.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .. import config
from ..datasources.routes import bump_config
from ..db import audit
from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z
from . import storage
from .models import version_json

PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4",
           "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff", "#9a6324"]
DEFAULT_MIN_SCORE = 0.25
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_ENTRY_KEYS = {"enabled", "names", "min_score", "colour", "alert"}


def default_entry(i: int, name: str) -> dict:
    return {"enabled": True, "names": {"en": name, "th": name}, "min_score": DEFAULT_MIN_SCORE,
            "colour": PALETTE[i % len(PALETTE)], "alert": False}


def default_class_config(classes: list[str]) -> dict:
    return {str(i): default_entry(i, n) for i, n in enumerate(classes)}


def validate_class_config(cfg: dict, classes: list[str]) -> dict:
    """Full, normalised config for `classes`; ids not mentioned get defaults. ValueError on bad input."""
    if not isinstance(cfg, dict):
        raise ValueError("class_config must be an object")
    out = default_class_config(classes)
    for k, v in cfg.items():
        if not (isinstance(k, str) and k.isdigit() and int(k) < len(classes)):
            raise ValueError(f"class id {k!r} is not a class of this model (0..{len(classes) - 1})")
        if not isinstance(v, dict) or set(v) - _ENTRY_KEYS:
            raise ValueError(f"class {k}: expected an object with keys {sorted(_ENTRY_KEYS)}")
        e = out[k]
        for flag in ("enabled", "alert"):
            if flag in v:
                if not isinstance(v[flag], bool):
                    raise ValueError(f"class {k}: {flag} must be true or false")
                e[flag] = v[flag]
        if "min_score" in v:
            s = v["min_score"]
            if isinstance(s, bool) or not isinstance(s, (int, float)) or not 0.05 <= s <= 0.95:
                raise ValueError(f"class {k}: min_score must be a number from 0.05 to 0.95")
            e["min_score"] = float(s)
        if "colour" in v:
            if not isinstance(v["colour"], str) or not _COLOUR.match(v["colour"]):
                raise ValueError(f"class {k}: colour must look like #rrggbb")
            e["colour"] = v["colour"].lower()
        if "names" in v:
            n = v["names"]
            if not isinstance(n, dict) or set(n) - {"en", "th"}:
                raise ValueError(f"class {k}: names must be an object with en and/or th")
            for lang, text in n.items():
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 80:
                    raise ValueError(f"class {k}: names.{lang} must be 1 to 80 characters")
                e["names"][lang] = text.strip()
    return out


def class_diff(old: list[str], new: list[str]) -> dict:
    common = min(len(old), len(new))
    return {"added": list(range(len(old), len(new))), "removed": list(range(len(new), len(old))),
            "renamed": [i for i in range(common) if old[i] != new[i]]}


def carry_over(old_cfg: dict, old_classes: list[str], new_classes: list[str]) -> dict:
    """Settings for a new version: kept where the class id still has the same name, defaults elsewhere."""
    out = default_class_config(new_classes)
    for i in range(min(len(old_classes), len(new_classes))):
        if old_classes[i] == new_classes[i] and str(i) in old_cfg:
            out[str(i)] = old_cfg[str(i)]
    return out


def model_sig(edge_id: UUID, version_id: UUID, sha256: str) -> str:
    key = hashlib.sha256(config.DATA_SOURCE_KEY + b"|edge-model").digest()
    return hmac.new(key, f"{edge_id}:{version_id}:{sha256}".encode(), hashlib.sha256).hexdigest()


def model_cfg(r, edge_id: UUID, task: str, base_url: str) -> dict:
    """The `model` block of one cfg camera entry. `r` = camera_models row joined with its version."""
    vid = r["model_version_id"]
    return {
        "version_id": str(vid), "sha256": r["sha256"], "size_bytes": r["size_bytes"], "task": task,
        "imgsz": r["imgsz"], "stride": r["stride"], "classes": r["classes"], "class_config": r["class_config"],
        "placement": r["placement"],
        "url": f"{base_url}/api/v1/edge-models/{vid}?edge={edge_id}&sig={model_sig(edge_id, vid, r['sha256'])}",
    }


# ------------------------------------------------------------------ routes
router = APIRouter()


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class PinIn(BaseModel):
    model_version_id: UUID
    placement: Literal["auto", "edge", "cloud"] | None = None


class ClassesPatch(BaseModel):
    class_config: dict


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    class_config: dict


class ApplyIn(BaseModel):
    preset_id: UUID


def _bad(e: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": "invalid_class_config", "message": str(e)})


async def _camera(tc, cam_id: UUID):
    row = await tc.fetchrow("SELECT id, edge_id FROM cameras WHERE id=$1", cam_id)
    if row is None:
        raise HTTPException(404, "camera not found")
    return row


async def _pin_json(tc, cam_id: UUID) -> dict | None:
    r = await tc.fetchrow(
        "SELECT cm.*, v.classes, v.version, v.model_id, v.status AS version_status FROM camera_models cm"
        " JOIN vision_model_versions v ON v.id = cm.model_version_id WHERE cm.camera_id=$1", cam_id)
    if r is None:
        return None
    return {"camera_id": str(cam_id), "model_version_id": str(r["model_version_id"]), "model_id": str(r["model_id"]),
            "version": r["version"], "classes": r["classes"], "placement": r["placement"],
            "class_config": r["class_config"], "updated_at": iso_z(r["updated_at"])}


_C = "/api/v1/orgs/{org}/cameras/{camera}"


@router.get(_C + "/model")
async def get_pin(org: str, camera: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    cam_id = m._uuid_or_404(camera, "camera")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _camera(tc, cam_id)
        pin = await _pin_json(tc, cam_id)
    return pin or {"camera_id": str(cam_id), "model_version_id": None}


@router.put(_C + "/model")
async def pin_model(org: str, camera: str, body: PinIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cam = await _camera(tc, cam_id)
        v = await tc.fetchrow("SELECT * FROM vision_model_versions WHERE id=$1 FOR SHARE", body.model_version_id)
        if v is None:
            raise HTTPException(404, "version not found")
        if v["status"] != "active" or v["classes"] is None:
            raise HTTPException(409, "version_not_active")
        old = await tc.fetchrow(
            "SELECT cm.class_config, cm.placement, v.classes FROM camera_models cm"
            " JOIN vision_model_versions v ON v.id=cm.model_version_id WHERE cm.camera_id=$1 FOR UPDATE OF cm", cam_id)
        classes = list(v["classes"])
        if old is None:
            cfg, diff = default_class_config(classes), None
        else:
            cfg = carry_over(old["class_config"], list(old["classes"]), classes)
            diff = class_diff(list(old["classes"]), classes)
        placement = body.placement or (old["placement"] if old else "auto")
        await tc.execute(
            "INSERT INTO camera_models(org_id, camera_id, model_version_id, class_config, placement)"
            " VALUES ($1,$2,$3,$4,$5) ON CONFLICT (camera_id) DO UPDATE SET model_version_id=EXCLUDED.model_version_id,"
            " class_config=EXCLUDED.class_config, placement=EXCLUDED.placement, updated_at=now()",
            org_id, cam_id, v["id"], cfg, placement)
        ver = await bump_config(tc, cam["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", "camera.model_pinned", {"camera_id": str(cam_id)},
                           {"version_id": str(v["id"]), "placement": placement})
    return {"camera_id": str(cam_id), "model_version_id": str(v["id"]), "classes": classes, "placement": placement,
            "class_config": cfg, "diff": diff, "config_version": ver}


@router.delete(_C + "/model", status_code=204)
async def unpin_model(org: str, camera: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cam = await _camera(tc, cam_id)
        gone = await tc.fetchval("DELETE FROM camera_models WHERE camera_id=$1 RETURNING camera_id", cam_id)
        if gone is not None:
            await bump_config(tc, cam["edge_id"])
            await audit.append(tc, f"user:{p.user_id}", "camera.model_unpinned", {"camera_id": str(cam_id)}, {})


async def _set_config(request, p, org_id: UUID, cam_id: UUID, raw: dict, action: str):
    async with tenant_tx(_m().st(request).pools.app, org_id, p.user_id) as tc:
        cam = await _camera(tc, cam_id)
        pin = await tc.fetchrow(
            "SELECT cm.class_config, v.classes FROM camera_models cm JOIN vision_model_versions v"
            " ON v.id=cm.model_version_id WHERE cm.camera_id=$1 FOR UPDATE OF cm", cam_id)
        if pin is None:
            raise HTTPException(409, "no_model_pinned")
        base = raw
        if action == "classes_patched":      # a partial patch merges per class, not per key
            base = {k: dict(v) for k, v in pin["class_config"].items()}
            for k, v in raw.items():
                base[k] = {**base[k], **v} if isinstance(v, dict) and k in base else v
        try:
            merged = validate_class_config(base, list(pin["classes"]))
        except ValueError as e:
            return _bad(e)
        await tc.execute("UPDATE camera_models SET class_config=$2, updated_at=now() WHERE camera_id=$1",
                         cam_id, merged)
        ver = await bump_config(tc, cam["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", f"camera.{action}", {"camera_id": str(cam_id)}, {})
    return {"camera_id": str(cam_id), "class_config": merged, "config_version": ver}


@router.patch(_C + "/classes")
async def patch_classes(org: str, camera: str, body: ClassesPatch, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    await m._mutation_gate(request, p.user_id)
    return await _set_config(request, p, org_id, cam_id, body.class_config, "classes_patched")


@router.post(_C + "/classes/apply-preset")
async def apply_preset(org: str, camera: str, body: ApplyIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        pr = await tc.fetchrow("SELECT * FROM class_presets WHERE id=$1", body.preset_id)
        if pr is None:
            raise HTTPException(404, "preset not found")
        pin = await tc.fetchrow(
            "SELECT v.model_id FROM camera_models cm JOIN vision_model_versions v ON v.id=cm.model_version_id"
            " WHERE cm.camera_id=$1", cam_id)
    if pin is None:
        raise HTTPException(409, "no_model_pinned")
    if pin["model_id"] != pr["model_id"]:
        raise HTTPException(409, "preset_for_another_model")
    return await _set_config(request, p, org_id, cam_id, pr["class_config"], "preset_applied")


_P = "/api/v1/orgs/{org}/vision/models/{model}/presets"


@router.get(_P)
async def list_presets(org: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    mid = m._uuid_or_404(model, "model")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if await tc.fetchval("SELECT 1 FROM vision_models WHERE id=$1", mid) is None:
            raise HTTPException(404, "model not found")
        rows = await tc.fetch("SELECT * FROM class_presets WHERE model_id=$1 ORDER BY name", mid)
    return {"items": [_preset_json(r) for r in rows]}


def _preset_json(r) -> dict:
    return {"id": str(r["id"]), "model_id": str(r["model_id"]), "name": r["name"],
            "class_config": r["class_config"], "created_at": iso_z(r["created_at"])}


@router.post(_P, status_code=201)
async def create_preset(org: str, model: str, body: PresetIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    mid = m._uuid_or_404(model, "model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM vision_models WHERE id=$1", mid) is None:
            raise HTTPException(404, "model not found")
        # validated against the newest version's classes; a preset only ever applies to the same model
        classes = await tc.fetchval(
            "SELECT classes FROM vision_model_versions WHERE model_id=$1 AND classes IS NOT NULL"
            " ORDER BY version DESC LIMIT 1", mid)
        if classes is None:
            raise HTTPException(409, "model_has_no_classes")
        try:
            cfg = validate_class_config(body.class_config, list(classes))
        except ValueError as e:
            return _bad(e)
        try:
            row = await tc.fetchrow(
                "INSERT INTO class_presets(org_id, model_id, name, class_config) VALUES ($1,$2,$3,$4) RETURNING *",
                org_id, mid, body.name.strip(), cfg)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "preset_name_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "vision.preset.created", {"preset_id": str(row["id"])}, {})
    return {"preset": _preset_json(row)}


@router.delete(_P + "/{preset}", status_code=204)
async def delete_preset(org: str, model: str, preset: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    pid = m._uuid_or_404(preset, "preset")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval("DELETE FROM class_presets WHERE id=$1 AND model_id=$2 RETURNING id", pid,
                                 m._uuid_or_404(model, "model"))
        if gone is None:
            raise HTTPException(404, "preset not found")
        await audit.append(tc, f"user:{p.user_id}", "vision.preset.deleted", {"preset_id": str(pid)}, {})


# ------------------------------------------------- gateway model download
@router.get("/api/v1/edge-models/{version}")
async def edge_model(version: str, edge: str, sig: str, request: Request):
    """Gateway download of one exact version. The signature is the credential; any failure is a plain 404."""
    try:
        vid, eid = UUID(version), UUID(edge)
    except ValueError:
        raise HTTPException(404, "not found") from None
    async with global_tx(_m().st(request).pools.system) as conn:
        row = await conn.fetchrow(
            "SELECT org_id, sha256, status FROM vision_model_versions WHERE id=$1", vid)
    if (row is None or row["sha256"] is None or row["status"] not in ("active", "archived")
            or not hmac.compare_digest(sig, model_sig(eid, vid, row["sha256"]))):
        raise HTTPException(404, "not found")
    f = storage.model_path(row["org_id"], vid)
    if not f.exists():
        raise HTTPException(404, "not found")
    return FileResponse(f, media_type="application/octet-stream")
