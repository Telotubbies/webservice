"""Demo-video upload and the edge media download (spec 6.2, plan M1-03 T2).

Upload is a raw request body (`POST …/videos?filename=x.mp4`), not multipart:
it streams to disk without a form parser dependency.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from ..core import config
from ..db import audit
from ..db.context import global_tx, tenant_tx
from ..db.util import iso_z
from . import storage

router = APIRouter()

_NAME_BAD = re.compile(r"[^A-Za-z0-9._ -]")


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def sniff_container(head: bytes) -> str | None:
    """Container type from magic bytes. mp4 = `ftyp` box at offset 4, webm = EBML header."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    return None


def media_sig(edge_id: UUID, video_id: UUID, sha256: str) -> str:
    """Capability for one edge to fetch one exact file. No expiry (cfg is pushed
    only on change); deleting the video revokes it."""
    key = hashlib.sha256(config.DATA_SOURCE_KEY + b"|edge-media").digest()
    return hmac.new(key, f"{edge_id}:{video_id}:{sha256}".encode(), hashlib.sha256).hexdigest()


def video_json(r) -> dict:
    return {"id": str(r["id"]), "filename": r["filename"], "content_type": r["content_type"],
            "size_bytes": r["size_bytes"], "sha256": r["sha256"],
            "created_at": iso_z(r["created_at"])}


async def _peek(stream):
    """First chunk (for sniffing) then the rest, as one async iterator."""
    first = b""
    async for c in stream:
        if c:
            first = c
            break

    async def chain():
        if first:
            yield first
        async for c in stream:
            yield c
    return first, chain()


@router.post("/api/v1/orgs/{org}/sites/{site}/videos", status_code=201)
async def upload_video(org: str, site: str, request: Request, filename: str = "video",
                       p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > storage.MAX_VIDEO_BYTES:
        raise HTTPException(413, "video_too_large")
    first, chunks = await _peek(request.stream())
    ctype = sniff_container(first)
    if ctype is None:
        raise HTTPException(415, "unsupported_media_type")
    name = _NAME_BAD.sub("_", filename.strip())[:255] or "video"
    vid = uuid4()
    try:
        size, sha = await storage.put(org_id, vid, chunks)
    except storage.TooLarge:
        raise HTTPException(413, "video_too_large") from None
    try:
        async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
            if await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id) is None:
                raise HTTPException(404, "site not found")
            row = await tc.fetchrow(
                "INSERT INTO videos(id, org_id, site_id, filename, content_type, size_bytes,"
                " sha256, storage_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"
                " RETURNING *", vid, org_id, site_id, name, ctype, size, sha,
                storage.key(org_id, vid), p.user_id)
            await audit.append(tc, f"user:{p.user_id}", "video.uploaded",
                               {"video_id": str(vid)}, {"filename": name, "size_bytes": size})
    except BaseException:
        storage.delete(org_id, vid)   # no orphan file when the insert fails
        raise
    return video_json(row)


@router.get("/api/v1/orgs/{org}/sites/{site}/videos")
async def list_videos(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM videos WHERE site_id=$1 ORDER BY created_at DESC LIMIT 200", site_id)
    return {"items": [video_json(r) for r in rows]}


@router.delete("/api/v1/orgs/{org}/sites/{site}/videos/{video}", status_code=204)
async def delete_video(org: str, site: str, video: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    vid = m._uuid_or_404(video, "video")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            gone = await tc.fetchval(
                "DELETE FROM videos WHERE id=$1 AND site_id=$2 RETURNING id", vid, site_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(409, "video_in_use") from None
        if gone is None:
            raise HTTPException(404, "video not found")
        await audit.append(tc, f"user:{p.user_id}", "video.deleted", {"video_id": str(vid)}, {})
    storage.delete(org_id, vid)


@router.get("/api/v1/edge-media/{video}")
async def edge_media(video: str, edge: str, sig: str, request: Request):
    """Gateway download. The signature is the credential; every failure is a
    plain 404 so ids and signatures cannot be probed apart."""
    try:
        vid, eid = UUID(video), UUID(edge)
    except ValueError:
        raise HTTPException(404, "not found") from None
    async with global_tx(_m().st(request).pools.system) as conn:
        row = await conn.fetchrow("SELECT org_id, sha256, content_type FROM videos WHERE id=$1", vid)
    if row is None or not hmac.compare_digest(sig, media_sig(eid, vid, row["sha256"])):
        raise HTTPException(404, "not found")
    f = storage.path(row["org_id"], vid)
    if not os.path.exists(f):
        raise HTTPException(404, "not found")
    return FileResponse(f, media_type=row["content_type"])
