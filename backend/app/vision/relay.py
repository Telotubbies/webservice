"""Frame relay: latest-frame buffer per camera + MJPEG fan-out (plan M1-03 T5).

Frames arrive from the gateway over MQTT. Only the newest frame is kept per
camera; viewers wait for a newer sequence number, so a slow browser skips
frames and memory stays flat (spec 6.4: "drops frames, never queues").
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from typing import AsyncIterator, Awaitable, Callable
from uuid import UUID

from .. import config

MAX_FRAME_BYTES = 150_000
STREAM_URL_TTL_S = 60
_STATUS = {"ok": "ok", "error": "error"}


def _key() -> bytes:
    return hashlib.sha256(config.DATA_SOURCE_KEY + b"|camera-stream").digest()


def stream_sig(camera_id: UUID, exp: int) -> str:
    return hmac.new(_key(), f"stream:{camera_id}:{exp}".encode(), hashlib.sha256).hexdigest()


def verify_stream_sig(camera_id: UUID, exp: int, sig: str) -> bool:
    return exp > time.time() and hmac.compare_digest(sig, stream_sig(camera_id, exp))


def parse_stat(raw: bytes) -> dict[UUID, tuple[str, str, float]]:
    """{camera_id: (status, detail, fps)} from an edge vision/stat message; junk is skipped."""
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return {}
    if not isinstance(doc, dict):
        return {}
    out = {}
    for k, v in doc.items():
        try:
            cid = UUID(k)
        except ValueError:
            continue
        if not isinstance(v, dict):
            continue
        detail = v.get("detail")
        fps = v.get("fps")
        out[cid] = (_STATUS.get(v.get("status"), "unknown"),
                    detail[:500] if isinstance(detail, str) else "",
                    float(fps) if isinstance(fps, (int, float)) and not isinstance(fps, bool) else 0.0)
    return out


class FrameRelay:
    def __init__(self, cameras_of_edge: Callable[[UUID], Awaitable[set]], ttl: float = 30.0):
        self._lookup = cameras_of_edge
        self._ttl = ttl
        self._owned: dict[UUID, tuple[float, set]] = {}
        self._frames: dict[UUID, tuple[int, bytes]] = {}
        self._waiters: dict[UUID, list[asyncio.Future]] = {}

    def push(self, camera_id: UUID, jpeg: bytes) -> None:
        seq = self._frames.get(camera_id, (0, b""))[0] + 1
        self._frames[camera_id] = (seq, jpeg)
        for f in self._waiters.pop(camera_id, []):
            if not f.done():
                f.set_result(None)

    def latest(self, camera_id: UUID):
        return self._frames.get(camera_id)

    def buffered_bytes(self) -> int:
        return sum(len(j) for _, j in self._frames.values())

    def forget(self, camera_id: UUID) -> None:
        self._frames.pop(camera_id, None)
        self._waiters.pop(camera_id, None)

    async def owns(self, edge_id: UUID, camera_id: UUID) -> bool:
        now = time.monotonic()
        hit = self._owned.get(edge_id)
        if hit is None or now - hit[0] > self._ttl or camera_id not in hit[1]:
            # refresh on expiry AND on a miss, so a camera created a moment ago works at once
            if hit is None or now - hit[0] > 1.0:
                hit = (now, set(await self._lookup(edge_id)))
                self._owned[edge_id] = hit
        return camera_id in hit[1]

    async def on_frame(self, edge_id: UUID, camera_id: UUID, jpeg: bytes) -> bool:
        if not jpeg or len(jpeg) > MAX_FRAME_BYTES or not await self.owns(edge_id, camera_id):
            return False
        self.push(camera_id, jpeg)
        return True

    async def frames(self, camera_id: UUID) -> AsyncIterator[tuple[int, bytes]]:
        """Yield the newest frame whenever its sequence advances."""
        last = 0
        while True:
            cur = self._frames.get(camera_id)
            if cur is not None and cur[0] > last:
                last = cur[0]
                yield cur
                continue
            fut = asyncio.get_running_loop().create_future()
            self._waiters.setdefault(camera_id, []).append(fut)
            try:
                await asyncio.wait_for(fut, timeout=1.0)
            except asyncio.TimeoutError:
                pass
