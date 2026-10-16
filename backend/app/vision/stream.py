"""Browser side of the frame relay: signed stream URL, MJPEG stream, snapshot,
and the MQTT handlers for vision/frame and vision/stat (plan M1-03 T5)."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z
from .material import RETENTION_DAYS
from .relay import STREAM_URL_TTL_S, parse_stat, stream_sig, verify_stream_sig

log = logging.getLogger("wds.vision")
router = APIRouter()

BOUNDARY = "wdsframe"
MAX_STREAMS = 50
MAX_STREAM_S = 3600
STAT_MIN_INTERVAL_S = 10.0

_streams = 0
_last_stat: dict[UUID, float] = {}
_last_prune: dict[UUID, float] = {}


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def cameras_lookup(pools):
    """FrameRelay.cameras_of_edge: ids of the cameras that belong to an edge (system pool)."""
    async def lookup(edge_id: UUID) -> set:
        async with global_tx(pools.system) as conn:
            rows = await conn.fetch("SELECT id FROM cameras WHERE edge_id=$1", edge_id)
        return {r["id"] for r in rows}
    return lookup


# ----------------------------------------------------------- MQTT handlers
async def handle_frame(st, msg, edge, camera: str) -> None:
    try:
        cid = UUID(camera)
    except ValueError:
        return
    await st.relay.on_frame(edge.id, cid, bytes(msg.payload))


async def handle_stat(st, msg, edge) -> None:
    now = time.monotonic()
    for cid, stat in parse_stat(msg.payload).items():
        if not await st.relay.owns(edge.id, cid):
            continue
        st.relay.note_stat(cid, stat)          # fresh copy for the console, no DB throttle
        if now - _last_stat.get(cid, -1e9) < STAT_MIN_INTERVAL_S:
            continue
        _last_stat[cid] = now
        mat = stat.material or {}
        async with tenant_tx(st.pools.system, edge.org_id) as tc:
            await tc.execute(
                "UPDATE cameras SET status=$2, status_detail=$3, status_at=now() WHERE id=$1",
                cid, stat.status, stat.detail or None)
            # AI-inference history for the dashboard; one row per camera per period
            await tc.execute(
                "INSERT INTO vision_metrics(org_id, camera_id, fps, latency_ms, infer_n, det_n, gate,"
                " sand_frac, coverage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
                edge.org_id, cid, stat.fps, stat.latency_ms, stat.infer_n, stat.det_n,
                mat.get("gate"), mat.get("sand_frac"), mat.get("coverage"))
            if now - _last_prune.get(cid, -1e9) > 3600:
                _last_prune[cid] = now
                await tc.execute("DELETE FROM vision_metrics WHERE camera_id=$1 AND ts < now() - make_interval(days => $2)",
                                 cid, RETENTION_DAYS)


CAPS_MAX_BYTES = 64 * 1024


def _caps_payload(raw: bytes) -> dict | None:
    """Validated vision/caps payload. Malformed shapes are ignored (None)."""
    if len(raw) > CAPS_MAX_BYTES:
        return None
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(doc, dict):
        return None
    cores = doc.get("cpu_cores")
    if isinstance(cores, bool) or not isinstance(cores, int) or not 0 < cores <= 4096:
        return None
    ram = doc.get("ram_mb")
    if ram is not None:
        if isinstance(ram, bool) or not isinstance(ram, (int, float)):
            ram = None
        else:
            try:
                ram = float(ram)
            except OverflowError:                     # absurdly large JSON ints
                ram = None
            if ram is not None and (not math.isfinite(ram) or not 0 <= ram <= 2 ** 50):
                ram = None
    device = doc.get("device")
    providers = doc.get("providers") or []
    loaded_raw = doc.get("loaded") or []
    if not isinstance(providers, list) or not isinstance(loaded_raw, list):
        return None                                  # malformed arrays -> drop the report
    providers = [str(p)[:80] for p in providers[:32] if isinstance(p, str)]
    loaded = []
    for v in loaded_raw[:256]:
        if isinstance(v, str):
            try:
                loaded.append(str(UUID(v)))
            except ValueError:
                continue
    return {"cpu_cores": cores, "ram_mb": int(ram) if ram is not None else None,
            "device": str(device)[:80] if isinstance(device, str) and device else None,
            "providers": providers, "loaded": loaded}


async def handle_caps(st, msg, edge) -> None:
    caps = _caps_payload(bytes(msg.payload))
    if caps is None:
        return
    async with tenant_tx(st.pools.system, edge.org_id) as tc:
        await tc.execute(
            "INSERT INTO edge_capabilities(org_id, edge_id, reported_at, cpu_cores, ram_mb,"
            " device, providers, loaded) VALUES ($1,$2,now(),$3,$4,$5,$6,$7)"
            " ON CONFLICT (edge_id) DO UPDATE SET reported_at=now(), cpu_cores=EXCLUDED.cpu_cores,"
            " ram_mb=EXCLUDED.ram_mb, device=EXCLUDED.device, providers=EXCLUDED.providers,"
            " loaded=EXCLUDED.loaded",
            edge.org_id, edge.id, caps["cpu_cores"], caps["ram_mb"], caps["device"],
            caps["providers"], caps["loaded"])


# ------------------------------------------------------------------ routes
async def _camera_or_404(request: Request, org: str, camera: str, p):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    cam_id = m._uuid_or_404(camera, "camera")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if await tc.fetchval("SELECT 1 FROM cameras WHERE id=$1", cam_id) is None:
            raise HTTPException(404, "camera not found")
    return org_id, cam_id


@router.post("/api/v1/orgs/{org}/cameras/{camera}/stream-url")
async def stream_url(org: str, camera: str, request: Request, p=Depends(_user)):
    _, cam_id = await _camera_or_404(request, org, camera, p)
    exp = int(time.time()) + STREAM_URL_TTL_S
    return {"url": f"/api/v1/orgs/{org}/cameras/{cam_id}/stream?exp={exp}&sig={stream_sig(cam_id, exp)}",
            "expires_in": STREAM_URL_TTL_S}


@router.get("/api/v1/orgs/{org}/cameras/{camera}/snapshot")
async def snapshot(org: str, camera: str, request: Request, p=Depends(_user)):
    _, cam_id = await _camera_or_404(request, org, camera, p)
    cur = _m().st(request).relay.latest(cam_id)
    if cur is None:
        raise HTTPException(404, "no frame yet")
    return Response(cur[1], media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/api/v1/orgs/{org}/cameras/{camera}/stream")
async def stream(org: str, camera: str, exp: int, sig: str, request: Request):
    """MJPEG. The signature (issued to a member for 60 s) is the credential, because
    <img> cannot send headers. Every failure is a plain 401."""
    global _streams
    try:
        cam_id = UUID(camera)
    except ValueError:
        raise HTTPException(401, "invalid stream signature") from None
    if not verify_stream_sig(cam_id, exp, sig):
        raise HTTPException(401, "invalid stream signature")
    if _streams >= MAX_STREAMS:
        raise HTTPException(503, "too many streams")
    relay = _m().st(request).relay

    async def gen():
        global _streams
        _streams += 1
        started = time.monotonic()
        try:
            async for _seq, jpeg in relay.frames(cam_id):
                if await request.is_disconnected() or time.monotonic() - started > MAX_STREAM_S:
                    return
                yield (f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n\r\n"
                       ).encode() + jpeg + b"\r\n"
        finally:
            _streams -= 1

    return StreamingResponse(gen(), media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
                             headers={"Cache-Control": "no-store"})


@router.get("/api/v1/orgs/{org}/edges/{edge}/capabilities")
async def edge_capabilities(org: str, edge: str, request: Request, p=Depends(_user)):
    """Last reported gateway capabilities (edge_capabilities row), or null."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    edge_id = m._uuid_or_404(edge, "edge")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if await tc.fetchval("SELECT 1 FROM edges WHERE id=$1", edge_id) is None:
            raise HTTPException(404, "edge not found")
        r = await tc.fetchrow(
            "SELECT reported_at, cpu_cores, ram_mb, device, providers, loaded"
            " FROM edge_capabilities WHERE edge_id=$1", edge_id)
    if r is None:
        return {"capabilities": None}
    return {"capabilities": {
        "reported_at": iso_z(r["reported_at"]), "cpu_cores": r["cpu_cores"],
        "ram_mb": r["ram_mb"], "device": r["device"],
        "providers": r["providers"], "loaded": r["loaded"]}}
