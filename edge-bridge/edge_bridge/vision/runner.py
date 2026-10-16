"""VisionRunner: one worker thread per enabled camera in the pushed cfg.

`apply(cameras)` diffs by camera id + config hash. A camera that cannot open
or loses its source reports `error` and retries with backoff (1 -> 30 s); it
never raises into the cfg handler or disturbs other cameras.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from .detector import NullDetector
from .source import FileSource, RtspSource, SourceError, encode_jpeg

log = logging.getLogger("edge_bridge.vision")

MAX_VIDEO_BYTES = 250 * 1024 * 1024
_URL = re.compile(r"[a-z]+://\S+", re.I)


def _clean(msg: str) -> str:
    """Status text leaves the plant: no URLs (RTSP URLs can carry credentials)."""
    return _URL.sub("<url>", msg)[:200]


def download_to_cache(url: str, sha256: str, size_bytes: int, dest_dir) -> Path:
    """Fetch a demo video once; the file is trusted only after its hash matches."""
    if urlsplit(url).scheme not in ("http", "https"):
        raise ValueError("video url must be http(s)")
    if not 0 < size_bytes <= MAX_VIDEO_BYTES:
        raise ValueError("video size out of range")
    d = Path(dest_dir) / "videos"
    d.mkdir(parents=True, exist_ok=True)
    final = d / sha256
    if final.exists():
        return final
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".dl-")
    h, got = hashlib.sha256(), 0
    try:
        with os.fdopen(fd, "wb") as f, urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310
            while chunk := r.read(1 << 20):
                got += len(chunk)
                if got > size_bytes:
                    raise ValueError("video larger than announced")
                h.update(chunk)
                f.write(chunk)
        if got != size_bytes or h.hexdigest() != sha256:
            raise ValueError("video sha256 mismatch")
        os.replace(tmp, final)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return final


class _Worker(threading.Thread):
    def __init__(self, cam: dict, runner: "VisionRunner"):
        super().__init__(name=f"cam-{cam['id'][:8]}", daemon=True)
        self.cam = cam
        self.r = runner
        self.stop_ev = threading.Event()
        self.status, self.detail = "starting", ""
        self.frames = 0
        self._detector = runner.detector_factory()

    def _open(self):
        c = self.cam
        fps = float(c.get("fps_sample") or 5.0)
        if c["kind"] == "rtsp":
            return RtspSource(c["rtsp_url"], fps)
        v = c["video"]
        if self.r.fetch is None:
            raise SourceError("video download unavailable")
        return FileSource(self.r.fetch(v["url"], v["sha256"], v["size_bytes"], self.r.state_dir), fps)

    def run(self) -> None:
        backoff = 1.0
        while not self.stop_ev.is_set():
            src = None
            try:
                src = self._open()
                backoff = 1.0
                while not self.stop_ev.is_set():
                    frame = src.read()
                    self._detector.detect(frame)    # seam: overlay/events arrive with the model plans
                    jpeg = encode_jpeg(frame)
                    if jpeg is not None:
                        self.r.publish_frame(self.cam["id"], jpeg)
                        self.frames += 1
                    self.status, self.detail = "ok", ""
            except Exception as exc:  # noqa: BLE001 — isolate per camera
                self.status, self.detail = "error", _clean(str(exc) or type(exc).__name__)
                log.warning("camera %s: %s", self.cam.get("name"), self.detail)
                self.stop_ev.wait(backoff)
                backoff = min(30.0, backoff * 2)
            finally:
                if src is not None:
                    try:
                        src.close()
                    except Exception:  # noqa: BLE001
                        pass


class VisionRunner:
    def __init__(self, publish_frame, publish_stat, state_dir, fetch=download_to_cache,
                 detector_factory=NullDetector, stat_period_s: float = 10.0):
        self.publish_frame = publish_frame
        self.publish_stat = publish_stat
        self.state_dir = state_dir
        self.fetch = fetch
        self.detector_factory = detector_factory
        self._period = stat_period_s
        self._lock = threading.Lock()
        self._workers: dict[str, tuple[str, _Worker]] = {}
        self._stop = threading.Event()
        self._stat_t: threading.Thread | None = None

    @staticmethod
    def _valid(c) -> bool:
        return (isinstance(c, dict) and isinstance(c.get("id"), str) and c.get("kind") in ("rtsp", "upload")
                and ((c["kind"] == "rtsp" and isinstance(c.get("rtsp_url"), str))
                     or (c["kind"] == "upload" and isinstance(c.get("video"), dict))))

    def apply(self, cameras: list) -> None:
        wanted = {}
        for c in cameras or []:
            if not self._valid(c):
                log.warning("ignored malformed camera entry")
                continue
            if c.get("enabled", True):
                wanted[c["id"]] = (hashlib.sha256(json.dumps(c, sort_keys=True).encode()).hexdigest(), c)
        with self._lock:
            for cid in list(self._workers):
                h, w = self._workers[cid]
                if cid not in wanted or wanted[cid][0] != h:
                    w.stop_ev.set()
                    del self._workers[cid]
            for cid, (h, c) in wanted.items():
                if cid not in self._workers:
                    w = _Worker(c, self)
                    self._workers[cid] = (h, w)
                    w.start()
            if self._workers and (self._stat_t is None or not self._stat_t.is_alive()):
                self._stat_t = threading.Thread(target=self._stat_loop, name="vision-stat", daemon=True)
                self._stat_t.start()

    def _stat_loop(self) -> None:
        last, t0 = {}, time.monotonic()
        while not self._stop.wait(self._period):
            now = time.monotonic()
            with self._lock:
                items = [(cid, w) for cid, (_, w) in self._workers.items()]
            doc = {}
            for cid, w in items:
                doc[cid] = {"status": w.status, "detail": w.detail,
                            "fps": round((w.frames - last.get(cid, 0)) / max(now - t0, 1e-6), 2)}
                last[cid] = w.frames
            t0 = now
            if doc:
                try:
                    self.publish_stat(doc)
                except Exception:  # noqa: BLE001
                    log.exception("vision stat publish failed")

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            ws = [w for _, w in self._workers.values()]
            self._workers.clear()
        for w in ws:
            w.stop_ev.set()
        for w in ws:
            w.join(timeout=3.0)
