"""Camera CRUD and the camera slice of the edge cfg (plan M1-03 T3).

The RTSP URL may carry credentials: it is sealed at rest, accepted on write,
and only ever leaves the backend inside the edge's own `cfg` message.
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import config, plans
from ..datasources import secretbox
from ..datasources.routes import bump_config
from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z
from .videos import media_sig

router = APIRouter()


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["rtsp", "upload"]
    rtsp_url: str | None = Field(default=None, max_length=1000)
    video_id: UUID | None = None
    fps_sample: float = Field(default=5.0, ge=0.5, le=15)
    enabled: bool = True


class CameraPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    rtsp_url: str | None = Field(default=None, max_length=1000)
    video_id: UUID | None = None
    fps_sample: float | None = Field(default=None, ge=0.5, le=15)
    enabled: bool | None = None


def _check_rtsp(url: str | None) -> str:
    u = urlsplit(url or "")
    if u.scheme not in ("rtsp", "rtsps") or not u.hostname:
        raise HTTPException(422, "rtsp_url must be rtsp:// or rtsps:// with a host")
    return url


def camera_json(r, runtime: dict | None = None) -> dict:
    d = {
        "id": str(r["id"]), "site_id": str(r["site_id"]), "edge_id": str(r["edge_id"]),
        "name": r["name"], "kind": r["kind"], "has_rtsp_url": r["rtsp_url_enc"] is not None,
        "video_id": str(r["video_id"]) if r["video_id"] else None,
        "fps_sample": r["fps_sample"], "enabled": r["enabled"], "status": r["status"],
        "status_detail": r["status_detail"],
        "status_at": iso_z(r["status_at"]) if r["status_at"] else None,
        "created_at": iso_z(r["created_at"]), "updated_at": iso_z(r["updated_at"]),
    }
    if runtime:
        d.update(runtime)          # live engine/latency/bench_fps/model_* from the relay
    return d


def camera_cfg(r, *, rtsp_url: str | None, video: dict | None, base_url: str, model: dict | None = None) -> dict:
    """One entry of cfg['cameras']. `video` = {size_bytes, sha256} for upload cameras; `model` = the pinned model block."""
    out = {"id": str(r["id"]), "name": r["name"], "kind": r["kind"],
           "fps_sample": r["fps_sample"], "enabled": r["enabled"]}
    if model is not None:
        out["model"] = model
    if r["kind"] == "rtsp":
        out["rtsp_url"] = rtsp_url
    else:
        vid, eid = r["video_id"], r["edge_id"]
        out["video"] = {
            "url": f"{base_url}/api/v1/edge-media/{vid}?edge={eid}&sig={media_sig(eid, vid, video['sha256'])}",
            "sha256": video["sha256"], "size_bytes": video["size_bytes"]}
    return out


async def cameras_for_cfg(tc, edge_id: UUID) -> list[dict]:
    """Enabled-or-not cameras of one edge as cfg entries (runs in the system tenant_tx of build_cfg)."""
    rows = await tc.fetch("SELECT * FROM cameras WHERE edge_id=$1 ORDER BY name", edge_id)
    vids = {}
    for r in rows:
        if r["video_id"]:
            vids[r["video_id"]] = await tc.fetchrow(
                "SELECT size_bytes, sha256 FROM videos WHERE id=$1", r["video_id"])
    pins = {r["camera_id"]: r for r in await tc.fetch(
        "SELECT cm.*, v.sha256, v.size_bytes, v.imgsz, v.stride, v.classes, m.task,"
        " m.kind, m.id AS model_id FROM camera_models cm"
        " JOIN vision_model_versions v ON v.id = cm.model_version_id JOIN vision_models m ON m.id = v.model_id"
        " WHERE cm.camera_id = ANY($1::uuid[])", [r["id"] for r in rows])}
    # kind='external' models (9.6): the endpoint + opened API key ride the cfg;
    # the edge POSTs frames to the provider instead of a local model server.
    ext: dict = {}
    ext_models = {p["model_id"] for p in pins.values() if p.get("kind") == "external"}
    if ext_models:
        for er in await tc.fetch(
                "SELECT model_id, provider, url, key_enc FROM external_endpoints"
                " WHERE model_id = ANY($1::uuid[])", list(ext_models)):
            key = secretbox.open_(er["key_enc"])["key"] if er["key_enc"] else None
            ext[er["model_id"]] = {"provider": er["provider"], "url": er["url"], "key": key}
    from .classes import model_cfg      # local: classes imports models, which imports this package's siblings
    from .rulecfg import gate_for_cfg, rules_for_cfg
    cam_ids = [r["id"] for r in rows]
    rules = await rules_for_cfg(tc, cam_ids)
    # edge command gate (roadmap 9.7): site/org off-switches, cached on the
    # gateway from the last cfg it applied — same dict on every camera entry
    gate = None
    if rows:
        gate = await gate_for_cfg(tc, rows[0]["site_id"], rows[0]["org_id"])
    out = []
    for r in rows:
        entry = camera_cfg(
            r, rtsp_url=secretbox.open_(r["rtsp_url_enc"])["url"] if r["rtsp_url_enc"] else None,
            video=vids.get(r["video_id"]), base_url=config.EDGE_MEDIA_BASE_URL,
            model=model_cfg(pins[r["id"]], edge_id, pins[r["id"]]["task"], config.EDGE_MEDIA_BASE_URL,
                            external=ext.get(pins[r["id"]]["model_id"]))
            if r["id"] in pins else None)
        if gate is not None:
            entry["gate"] = gate
        if rules.get(r["id"]):
            entry["rules"] = rules[r["id"]]
        out.append(entry)
    return out


async def _edge_or_404(tc, edge_id: UUID, *, write: bool):
    e = await tc.fetchrow("SELECT id, site_id, status FROM edges WHERE id=$1", edge_id)
    if e is None:
        raise HTTPException(404, "edge not found")
    if write and e["status"] == "disabled":
        raise HTTPException(409, "edge_disabled")
    return e


async def _video_ok(tc, video_id: UUID | None, site_id: UUID) -> None:
    if video_id is None or await tc.fetchval(
            "SELECT 1 FROM videos WHERE id=$1 AND site_id=$2", video_id, site_id) is None:
        raise HTTPException(422, "video_id must name an uploaded video of this site")


def _ids(org: str, edge: str, p, need: str):
    m = _m()
    return m._v2_org(org, p, need), m._uuid_or_404(edge, "edge")


@router.get("/api/v1/orgs/{org}/edges/{edge}/cameras")
async def list_cameras(org: str, edge: str, request: Request, p=Depends(_user)):
    org_id, edge_id = _ids(org, edge, p, _m()._READ)
    async with tenant_tx(_m().st(request).pools.app, org_id) as tc:
        await _edge_or_404(tc, edge_id, write=False)
        rows = await tc.fetch("SELECT * FROM cameras WHERE edge_id=$1 ORDER BY name", edge_id)
    relay = _m().st(request).relay
    return {"items": [camera_json(r, relay.latest_stat(r["id"])) for r in rows]}


@router.post("/api/v1/orgs/{org}/edges/{edge}/cameras", status_code=201)
async def create_camera(org: str, edge: str, body: CameraIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, edge_id = _ids(org, edge, p, m._CONFIG)
    enc = None
    if body.kind == "rtsp":
        enc = secretbox.seal({"url": _check_rtsp(body.rtsp_url)})
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        e = await _edge_or_404(tc, edge_id, write=True)
        if body.kind == "upload":
            await _video_ok(tc, body.video_id, e["site_id"])
        await plans.check_limit(tc, org_id, "max_cameras")
        try:
            row = await tc.fetchrow(
                "INSERT INTO cameras(org_id, site_id, edge_id, name, kind, rtsp_url_enc, video_id,"
                " fps_sample, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                org_id, e["site_id"], edge_id, body.name, body.kind, enc,
                body.video_id if body.kind == "upload" else None, body.fps_sample, body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "camera_name_exists") from None
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "camera.created",
                           {"camera_id": str(row["id"]), "edge_id": str(edge_id)},
                           {"name": body.name, "kind": body.kind})
    return {"camera": camera_json(row, _m().st(request).relay.latest_stat(row["id"])),
            "config_version": ver}


@router.patch("/api/v1/orgs/{org}/edges/{edge}/cameras/{camera}")
async def patch_camera(org: str, edge: str, camera: str, body: CameraPatch, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id, edge_id = _ids(org, edge, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    ch = body.model_dump(exclude_unset=True)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow(
            "SELECT * FROM cameras WHERE id=$1 AND edge_id=$2 FOR UPDATE", cam_id, edge_id)
        if cur is None:
            raise HTTPException(404, "camera not found")
        sets, args = [], []

        def put(col, val):
            args.append(val)
            sets.append(f"{col}=${len(args)}")
        for f in ("name", "fps_sample", "enabled"):
            if f in ch and ch[f] is not None:
                put(f, ch[f])
        if "rtsp_url" in ch:
            if cur["kind"] != "rtsp":
                raise HTTPException(422, "rtsp_url only applies to rtsp cameras")
            put("rtsp_url_enc", secretbox.seal({"url": _check_rtsp(ch["rtsp_url"])}))
        if "video_id" in ch:
            if cur["kind"] != "upload":
                raise HTTPException(422, "video_id only applies to upload cameras")
            await _video_ok(tc, ch["video_id"], cur["site_id"])
            put("video_id", ch["video_id"])
        if not sets:
            raise HTTPException(422, "nothing to change")
        args.append(cam_id)
        try:
            row = await tc.fetchrow(
                f"UPDATE cameras SET {', '.join(sets)}, updated_at=now() WHERE id=${len(args)} RETURNING *",
                *args)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "camera_name_exists") from None
        ver = await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "camera.updated", {"camera_id": str(cam_id)},
                           {"fields": sorted(k for k in ch if k != "rtsp_url") + (["rtsp_url"] if "rtsp_url" in ch else [])})
    return {"camera": camera_json(row, _m().st(request).relay.latest_stat(cam_id)),
            "config_version": ver}


@router.delete("/api/v1/orgs/{org}/edges/{edge}/cameras/{camera}", status_code=204)
async def delete_camera(org: str, edge: str, camera: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, edge_id = _ids(org, edge, p, m._CONFIG)
    cam_id = m._uuid_or_404(camera, "camera")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM cameras WHERE id=$1 AND edge_id=$2 RETURNING id", cam_id, edge_id)
        if gone is None:
            raise HTTPException(404, "camera not found")
        await bump_config(tc, edge_id)
        await audit.append(tc, f"user:{p.user_id}", "camera.deleted", {"camera_id": str(cam_id)}, {})
