"""Browser side of the frame relay: signed stream URL, MJPEG stream, snapshot,
and the MQTT handlers for vision/frame and vision/stat (plan M1-03 T5)."""

from __future__ import annotations

import asyncio
import logging
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ..db.context import global_tx, tenant_tx
from .relay import STREAM_URL_TTL_S, parse_stat, stream_sig, verify_stream_sig

log = logging.getLogger("wds.vision")
router = APIRouter()

BOUNDARY = "wdsframe"
MAX_STREAMS = 50
MAX_STREAM_S = 3600
STAT_MIN_INTERVAL_S = 10.0

_streams = 0
_last_stat: dict[UUID, float] = {}


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
    for cid, (status, detail, _fps) in parse_stat(msg.payload).items():
        if now - _last_stat.get(cid, -1e9) < STAT_MIN_INTERVAL_S:
            continue
        if not await st.relay.owns(edge.id, cid):
            continue
        _last_stat[cid] = now
        async with tenant_tx(st.pools.system, edge.org_id) as tc:
            await tc.execute(
                "UPDATE cameras SET status=$2, status_detail=$3, status_at=now() WHERE id=$1",
                cid, status, detail or None)


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
