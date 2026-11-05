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
import math
import time
from typing import AsyncIterator, Awaitable, Callable, NamedTuple
from uuid import UUID

from ..core import config
from .material import clean_material_stat

MAX_FRAME_BYTES = 150_000
STREAM_URL_TTL_S = 60
STAT_MAX_AGE_S = 30.0
_STATUS = {"ok": "ok", "error": "error"}
_MODEL_STATES = {"none", "loading", "ready", "error"}
_PLACEMENTS = {"edge", "cloud"}


class CameraStat(NamedTuple):
    """One camera's stat payload. The first three indices are unchanged
    (status, detail, fps) so legacy positional access still works; the extra
    fields (model metadata) change arity/equality vs the old 3-tuple."""
    status: str
    detail: str
    fps: float
    engine: str | None = None
    latency_ms: float | None = None
    bench_fps: float | None = None
    model_state: str = "none"
    model_detail: str = ""
    model_version: str | None = None
    placement: str | None = None          # 'edge' | 'cloud' — V5 badge
    infer_n: int | None = None            # inferences / detections since the last stat
    det_n: int | None = None
    material: dict | None = None          # gate + running decision (vision.material.clean_material_stat)


def _finite(v, lo: float, hi: float):
    """Finite non-bool number clamped to [lo, hi], else None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:                     # absurdly large JSON ints
        return None
    if not math.isfinite(f):
        return None
    return max(lo, min(hi, f))


def _count(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 10_000_000 else None


def _str(v, limit: int):
    return v[:limit] if isinstance(v, str) and v else None


def _key() -> bytes:
    return hashlib.sha256(config.DATA_SOURCE_KEY + b"|camera-stream").digest()


def stream_sig(camera_id: UUID, exp: int) -> str:
    return hmac.new(_key(), f"stream:{camera_id}:{exp}".encode(), hashlib.sha256).hexdigest()


def verify_stream_sig(camera_id: UUID, exp: int, sig: str) -> bool:
    return exp > time.time() and hmac.compare_digest(sig, stream_sig(camera_id, exp))


STAT_MAX_BYTES = 64 * 1024


def parse_stat(raw: bytes) -> dict[UUID, CameraStat]:
    """{camera_id: CameraStat} from an edge vision/stat message; junk is skipped."""
    if len(raw) > STAT_MAX_BYTES:
        return {}
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
        status = v.get("status")                     # non-strings (dict/list) are unhashable
        model_state = v.get("model_state")
        fps = _finite(v.get("fps"), 0.0, 10_000.0)
        ms = _finite(v.get("latency_ms"), 0.0, 3_600_000.0)
        bench = _finite(v.get("bench_fps"), 0.0, 10_000.0)
        out[cid] = CameraStat(
            _STATUS.get(status, "unknown") if isinstance(status, str) else "unknown",
            detail[:500] if isinstance(detail, str) else "",
            fps if fps is not None else 0.0,
            engine=_str(v.get("engine"), 80),
            latency_ms=ms,
            bench_fps=bench,
            model_state=model_state if isinstance(model_state, str)
            and model_state in _MODEL_STATES else "none",
            model_detail=_str(v.get("model_detail"), 200) or "",
            model_version=_str(v.get("model_version"), 80),
            placement=(v.get("placement") if isinstance(v.get("placement"), str)
                       and v["placement"] in _PLACEMENTS else None),
            infer_n=_count(v.get("infer_n")), det_n=_count(v.get("det_n")),
            material=clean_material_stat(v.get("material")))
    return out


class FrameRelay:
    def __init__(self, cameras_of_edge: Callable[[UUID], Awaitable[set]], ttl: float = 30.0):
        self._lookup = cameras_of_edge
        self._ttl = ttl
        self._owned: dict[UUID, tuple[float, set]] = {}
        self._frames: dict[UUID, tuple[int, bytes]] = {}
        self._stats: dict[UUID, tuple[float, CameraStat]] = {}
        self._counts: dict[UUID, dict[int, int]] = {}   # camera -> per-minute class counts
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

    def note_stat(self, camera_id: UUID, stat: CameraStat) -> None:
        self._stats[camera_id] = (time.monotonic(), stat)

    def latest_stat(self, camera_id: UUID) -> dict:
        """Model/runtime metadata of the newest stat, {} once it goes stale."""
        hit = self._stats.get(camera_id)
        if hit is None or time.monotonic() - hit[0] > STAT_MAX_AGE_S:
            return {}
        s = hit[1]
        return {k: v for k, v in {
            "engine": s.engine, "latency_ms": s.latency_ms, "bench_fps": s.bench_fps,
            "model_state": s.model_state, "model_detail": s.model_detail or None,
            "model_version": s.model_version, "placement": s.placement,
            "fps": s.fps, "material_live": s.material}.items() if v is not None}

    def note_count(self, camera_id: UUID, counts: dict) -> None:
        """Latest per-minute class-count rollup (vision/count, roadmap 9.8)."""
        self._counts[camera_id] = counts

    def latest_counts(self, camera_id: UUID) -> dict:
        return self._counts.get(camera_id, {})

    def forget(self, camera_id: UUID) -> None:
        self._frames.pop(camera_id, None)
        self._stats.pop(camera_id, None)
        self._counts.pop(camera_id, None)
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
