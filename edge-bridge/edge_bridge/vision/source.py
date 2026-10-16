"""Frame sources: a looped video file (demo camera) and an RTSP stream.

Both return one frame per `read()` at `fps_sample`, pacing themselves, so the
runner has no timing logic. Errors never carry the RTSP URL (it may hold
credentials): messages name host and port only.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import cv2

MAX_JPEG_BYTES = 100_000
NO_FRAME_TIMEOUT_S = 10.0


class SourceError(Exception):
    pass


def encode_jpeg(frame, max_w: int = 960, quality: int = 70) -> bytes | None:
    """JPEG at most `max_w` wide; None when it would exceed MAX_JPEG_BYTES."""
    h, w = frame.shape[:2]
    if w > max_w:
        frame = cv2.resize(frame, (max_w, max(1, round(h * max_w / w))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok or buf.size > MAX_JPEG_BYTES:
        return None
    return buf.tobytes()


class _Pacer:
    def __init__(self, fps: float):
        self.period = 1.0 / fps
        self._next = time.monotonic()

    def wait(self) -> None:
        delay = self._next - time.monotonic()
        if delay > 0:
            time.sleep(delay)
            self._next += self.period
        else:                       # fell behind: resync instead of bursting
            self._next = time.monotonic() + self.period


class FileSource:
    """Loops the clip at real-time pace (spec 6.2: behaves like a live feed)."""

    def __init__(self, path: Path, fps_sample: float):
        self._cap = cv2.VideoCapture(str(path))
        if not self._cap.isOpened():
            raise SourceError("cannot open video file")
        src_fps = self._cap.get(cv2.CAP_PROP_FPS) or 25.0
        self._stride = max(1, round(src_fps / fps_sample))
        self._pace = _Pacer(fps_sample)

    def read(self):
        self._pace.wait()
        for _ in range(self._stride - 1):
            if not self._cap.grab():
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = self._cap.read()
        if not ok:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self._cap.read()
            if not ok:
                raise SourceError("video has no readable frames")
        return frame

    def close(self) -> None:
        self._cap.release()


class RtspSource:
    """A reader thread keeps only the newest frame, so a slow consumer never
    sees stale buffered video."""

    def __init__(self, url: str, fps_sample: float):
        u = urlsplit(url)
        self._where = f"{u.hostname}:{u.port or 554}"
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")
        self._cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
        if not self._cap.isOpened():
            self._cap.release()
            raise SourceError(f"cannot open stream at {self._where}")
        self._pace = _Pacer(fps_sample)
        self._lock = threading.Lock()
        self._latest = None
        self._seen_at = time.monotonic()
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._pump, name="rtsp-read", daemon=True)
        self._t.start()

    def _pump(self) -> None:
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.2)
                continue
            with self._lock:
                self._latest, self._seen_at = frame, time.monotonic()

    def read(self):
        self._pace.wait()
        while True:
            with self._lock:
                frame, seen = self._latest, self._seen_at
                self._latest = None
            if frame is not None:
                return frame
            if time.monotonic() - seen > NO_FRAME_TIMEOUT_S:
                raise SourceError(f"no frames from {self._where} for {int(NO_FRAME_TIMEOUT_S)} s")
            time.sleep(0.05)

    def close(self) -> None:
        self._stop.set()
        self._t.join(timeout=2.0)
        self._cap.release()
