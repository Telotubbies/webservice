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
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from .detector import ModelNotReady, NullDetector
from .material import MaterialDecider, Window, draw_hud, preprocess
from .overlay import draw_overlay
from .source import FileSource, RtspSource, SourceError, encode_jpeg

log = logging.getLogger("edge_bridge.vision")

MAX_VIDEO_BYTES = 250 * 1024 * 1024
_URL = re.compile(r"[a-z]+://\S+", re.I)
# Only these camera fields rebuild the worker pipeline; incidental metadata
# (name, rules, gate, updated_at, ...) is hot-applied via cam_cfg() instead.
_PIPE_HASH_KEYS = ("id", "kind", "rtsp_url", "video", "fps_sample", "model")


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
        self._detector = runner.detector_factory(cam)
        self._class_config = (cam.get("model") or {}).get("class_config") or {}
        self._mat = MaterialDecider()
        self._win = Window()

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
                    out, dets = frame, []
                    cfgc = self.r.cam_cfg(self.cam["id"]) or self.cam
                    mat_on = self._mat.configure(cfgc.get("material"))
                    try:
                        # conditioning (ROI / CLAHE / gamma) is for the model only; the picture stays original
                        dets = self._detector.detect(preprocess(frame, self._mat.cfg["preprocess"]) if mat_on else frame)
                        self._win.add(len(dets))
                        if dets:
                            out = draw_overlay(frame, dets, self._class_config)
                    except ModelNotReady:
                        pass                           # raw frame; the detector holds the reason for the stat
                    except Exception as exc:  # noqa: BLE001 — a detector bug must not stop the picture
                        log.warning("detector failed on %s: %s", self.cam.get("name"), exc)
                        self._detector.state, self._detector.detail = "error", _clean(str(exc))
                    if mat_on and self._detector.state == "ready":
                        pkg = self._mat.feed(dets)
                        out = draw_hud(out if out is not frame else frame.copy(), self._mat.status(), self._mat.cfg["dry_run"])
                        if pkg is not None and self.r.on_material is not None:
                            try:
                                self.r.on_material(cfgc, pkg, frame, detector=self._detector)
                            except Exception:  # noqa: BLE001
                                log.exception("on_material failed")
                    if self.r.on_detections is not None:
                        # EVERY frame — including empty dets: edge-triggered
                        # rules re-arm only when they see the cleared frame
                        try:
                            self.r.on_detections(
                                self.r.cam_cfg(self.cam["id"]) or self.cam,
                                dets, frame, detector=self._detector)
                        except Exception:  # noqa: BLE001
                            log.exception("on_detections failed")
                    jpeg = encode_jpeg(out)
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


def _ram_mb() -> int | None:
    """Total RAM in MiB via stdlib sysconf (Linux); None where unavailable."""
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // (1024 * 1024)
    except (ValueError, OSError, AttributeError):
        return None


class VisionRunner:
    def __init__(self, publish_frame, publish_stat, state_dir, fetch=download_to_cache,
                 detector_factory=lambda cam: NullDetector(), stat_period_s: float = 10.0,
                 on_detections=None, on_material=None, publish_caps=None, model_client=None,
                 caps_period_s: float = 300.0):
        self.publish_frame = publish_frame
        self.publish_stat = publish_stat
        self.state_dir = state_dir
        self.fetch = fetch
        self.detector_factory = detector_factory
        self.on_material = on_material             # (camera_cfg, decision package, frame) -> None
        self.on_detections = on_detections         # (camera_cfg, detections, frame) -> None; rules arrive in M1-06
        self.publish_caps = publish_caps           # optional: vision/caps reporter (M1-05 T4)
        self._client = model_client                # ModelClient | None — health() feeds caps
        self._caps_period = caps_period_s
        self._period = stat_period_s
        self._lock = threading.Lock()
        self._workers: dict[str, tuple[str, _Worker]] = {}
        self._cam_cfgs: dict[str, dict] = {}   # latest pushed cfg per camera id
        self._stop = threading.Event()
        self._caps_evt = threading.Event()
        self._stat_t: threading.Thread | None = None
        self._caps_t: threading.Thread | None = None
        if publish_caps is not None:
            # capability report goes out at startup even with zero cameras —
            # the console uses it to say what the gateway can run. The loop is
            # signalled (startup, every reconnect) rather than pure-interval.
            self._caps_t = threading.Thread(target=self._caps_loop,
                                            name="vision-caps", daemon=True)
            self._caps_t.start()
            self.request_caps()                    # initial report ASAP

    def request_caps(self) -> None:
        """Ask the caps loop to publish now — safe to call from MQTT callbacks
        (just sets an event; never touches the network itself)."""
        self._caps_evt.set()

    def _caps_payload(self) -> dict:
        health = {}
        if self._client is not None:
            try:
                health = self._client.health()
            except Exception:                       # noqa: BLE001 — caps are best-effort
                health = {}
        if not isinstance(health, dict):
            health = {}
        device = health.get("device")
        providers = health.get("providers") or []
        loaded_raw = health.get("loaded") or []
        providers = [str(p)[:80] for p in (providers[:32] if isinstance(providers, list) else [])
                     if isinstance(p, str)]
        loaded = []
        for v in (loaded_raw[:256] if isinstance(loaded_raw, list) else []):
            try:
                loaded.append(str(uuid.UUID(str(v))))
            except (ValueError, AttributeError):
                continue
        return {"cpu_cores": os.cpu_count(), "ram_mb": _ram_mb(),
                "device": str(device)[:80] if isinstance(device, str) and device else None,
                "providers": providers, "loaded": loaded}

    def _caps_loop(self) -> None:
        while not self._stop.is_set():
            # publish on signal (startup/reconnect) OR every _caps_period,
            # whichever comes first
            self._caps_evt.wait(self._caps_period)
            self._caps_evt.clear()
            if self._stop.is_set():
                break
            try:
                self.publish_caps(self._caps_payload())
            except Exception:                       # noqa: BLE001
                log.exception("vision caps publish failed")

    def cam_cfg(self, camera_id: str) -> dict:
        """Latest pushed cfg for a camera — rules/gate/metadata update without
        a worker restart; pipeline fields still rebuild via the apply() hash."""
        return self._cam_cfgs.get(camera_id) or {}

    @staticmethod
    def _valid(c) -> bool:
        return (isinstance(c, dict) and isinstance(c.get("id"), str) and c.get("kind") in ("rtsp", "upload")
                and ((c["kind"] == "rtsp" and isinstance(c.get("rtsp_url"), str))
                     or (c["kind"] == "upload" and isinstance(c.get("video"), dict))))

    @staticmethod
    def _pipe_hash(c: dict) -> str:
        return hashlib.sha256(json.dumps(
            {k: c.get(k) for k in _PIPE_HASH_KEYS}, sort_keys=True).encode()).hexdigest()

    def apply(self, cameras: list) -> None:
        wanted = {}
        for c in cameras or []:
            if not self._valid(c):
                log.warning("ignored malformed camera entry")
                continue
            if c.get("enabled", True):
                wanted[c["id"]] = (self._pipe_hash(c), c)
        with self._lock:
            self._cam_cfgs = {cid: c for cid, (_h, c) in wanted.items()}
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
                d = w._detector
                doc[cid] = {"status": w.status, "detail": w.detail,
                            "fps": round((w.frames - last.get(cid, 0)) / max(now - t0, 1e-6), 2),
                            "model_state": getattr(d, "state", "none"), "model_detail": getattr(d, "detail", ""),
                            "engine": getattr(d, "engine", None), "latency_ms": getattr(d, "latency_ms", None),
                            "bench_fps": getattr(d, "bench_fps", None), "model_version": getattr(d, "version", None),
                            "placement": getattr(d, "placement", None)}
                infer_n, det_n = w._win.take()
                doc[cid]["infer_n"], doc[cid]["det_n"] = infer_n, det_n
                if w._mat.cfg is not None:
                    doc[cid]["material"] = w._mat.status()
                last[cid] = w.frames
            t0 = now
            if doc:
                try:
                    self.publish_stat(doc)
                except Exception:  # noqa: BLE001
                    log.exception("vision stat publish failed")

    def stop(self) -> None:
        self._stop.set()
        self._caps_evt.set()                 # wake the caps loop so it exits now
        with self._lock:
            ws = [w for _, w in self._workers.values()]
            self._workers.clear()
        for w in ws:
            w.stop_ev.set()
        for w in ws:
            w.join(timeout=3.0)
        if self._caps_t is not None:
            self._caps_t.join(timeout=2.0)
