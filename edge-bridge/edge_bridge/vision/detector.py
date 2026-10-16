"""Detector seam: a null detector, the model-server-backed one for pinned
cameras, the cloud-fallback one (roadmap 9.5) and the external-endpoint one
(9.6). `make_detector` picks per camera cfg."""

from __future__ import annotations

import json
import logging
import math
import threading
import time
import urllib.error
import urllib.request
from typing import Protocol
from urllib.parse import urlsplit

import cv2

from .modelclient import ModelClient, ModelServerError

log = logging.getLogger("edge_bridge.vision.detector")

INFER_MAX_W = 1280
RECHECK_S = 10.0
POLL_RECHECK_S = 5.0          # health() poll throttle while not ready (loading/error)
FAILOVER_N = 3                # edge failures inside FAILOVER_WINDOW_S -> cloud
FAILOVER_WINDOW_S = 300.0
FAILOVER_BACK_S = 600.0       # 10 healthy minutes -> back to the edge
CLOUD_TIMEOUT_S = 8.0


class Detector(Protocol):
    def detect(self, frame_bgr) -> list[dict]:
        """Detections in the model-server schema (roadmap 9.10); may be empty."""
        ...


class NullDetector:
    state = "none"
    detail = ""
    engine = None
    latency_ms = None
    bench_fps = None
    version = None

    def detect(self, frame_bgr) -> list[dict]:
        return []


class ModelNotReady(Exception):
    """The model is loading or unavailable: the caller sends the raw frame.

    `throttled=True` means "no fresh check was performed this frame" (the
    health poll was rate-limited) — failover must not count it as a new
    observed edge failure."""

    def __init__(self, detail: str = "", throttled: bool = False):
        super().__init__(detail)
        self.throttled = throttled


def class_filter(class_config: dict) -> tuple[list[int], dict[int, float]]:
    """(enabled class ids, min score per enabled id) from a camera's class_config."""
    scores = {int(k): float(v["min_score"]) for k, v in class_config.items() if v.get("enabled")}
    return sorted(scores), scores


def _jpeg(frame_bgr, max_w: int = INFER_MAX_W, quality: int = 85,
          cap: int = 0):
    h, w = frame_bgr.shape[:2]
    if w > max_w:
        frame_bgr = cv2.resize(frame_bgr, (max_w, round(h * max_w / w)))
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return None
    out = buf.tobytes()
    if cap and len(out) > cap:          # noisy frame: one cheaper pass, then drop
        ok, buf = cv2.imencode(".jpg", cv2.resize(
            frame_bgr, (640, round(frame_bgr.shape[0] * 640 / frame_bgr.shape[1]))),
            [cv2.IMWRITE_JPEG_QUALITY, 60])
        out = buf.tobytes() if ok else None
        if out is not None and len(out) > cap:
            return None
    return out


def _filtered(dets: list, scores: dict[int, float]) -> list[dict]:
    return [d for d in dets if d.get("class_id") in scores
            and d.get("score", 0) >= scores[d["class_id"]]]


class ModelDetector:
    def __init__(self, client: ModelClient, model: dict):
        self.client, self.model = client, model
        self.version = model["version_id"]
        self.state, self.detail = "loading", ""
        self.engine = self.latency_ms = self.bench_fps = None
        self.placement = "edge"
        self._checked_at = 0.0
        self._bench_started = False

    def _benchmark(self) -> None:
        """One daemon benchmark per detector — never on the live camera thread."""
        try:
            fps = self.client.benchmark(self.version).get("fps")
            if isinstance(fps, (int, float)) and not isinstance(fps, bool) \
                    and math.isfinite(fps) and fps >= 0:
                self.bench_fps = float(fps)
        except Exception as exc:                       # noqa: BLE001
            log.warning("benchmark for %s failed: %.120s", self.version, exc)

    def _ready(self) -> None:
        now = time.monotonic()
        if self.state == "ready" and now - self._checked_at < RECHECK_S:
            return
        if self.state != "ready" and self._checked_at \
                and now - self._checked_at < POLL_RECHECK_S:
            # cold load / known failure: don't hammer health() every frame
            raise ModelNotReady(self.detail or "loading", throttled=True)
        st = self.client.ensure(self.model)
        self._checked_at = now
        if st == "loaded":
            if self.state != "ready":
                self.state, self.detail = "ready", ""
                self.engine = self.client.engine(self.version)
                if not self._bench_started:
                    self._bench_started = True
                    threading.Thread(target=self._benchmark,
                                     name=f"bench-{self.version[:8]}",
                                     daemon=True).start()
            return
        if st.startswith("failed:"):
            self.state, self.detail = "error", st[len("failed:"):][:200]
        else:
            self.state, self.detail = "loading", ""
        raise ModelNotReady(self.detail or "loading")

    def detect(self, frame_bgr) -> list[dict]:
        ids, scores = class_filter(self.model.get("class_config") or {})
        if not ids:                                  # every class switched off: nothing to ask for
            return []
        self._ready()
        h, w = frame_bgr.shape[:2]
        if w > INFER_MAX_W:
            frame_bgr = cv2.resize(frame_bgr, (INFER_MAX_W, round(h * INFER_MAX_W / w)))
        ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return []
        try:
            dets, ms = self.client.infer(self.version, buf.tobytes(), ids, min(scores.values()))
        except ModelServerError as e:
            self.state, self.detail = "error", str(e)[:200]
            self._checked_at = 0.0                   # re-check (and re-PUT) on the next frame
            raise ModelNotReady(self.detail) from None
        self.latency_ms = ms if self.latency_ms is None else round(0.8 * self.latency_ms + 0.2 * ms, 2)
        return _filtered(dets, scores)


class CloudDetector:
    """Cloud fallback (9.5): POSTs the sampled JPEG to the backend's signed
    cloud-infer URL; the backend forwards it to the cloud model pool and
    returns the same 9.10-shaped detections. Never writes PLC unless the rule
    allows cloud writes — that gate lives in the rule engine."""

    def __init__(self, model: dict):
        self.model = model
        self.version = model.get("version_id")
        self.cloud_url = model.get("cloud_url")
        self.state, self.detail = ("ready", "") if self.cloud_url else ("error", "no cloud url")
        self.engine, self.bench_fps = "cloud", None
        self.latency_ms = None
        self.placement = "cloud"

    def _post(self, jpeg: bytes) -> dict:
        req = urllib.request.Request(self.cloud_url, data=jpeg, method="POST",
                                     headers={"Content-Type": "image/jpeg"})
        try:
            with urllib.request.urlopen(req, timeout=CLOUD_TIMEOUT_S) as r:  # noqa: S310 — backend-signed URL
                raw = r.read(4 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            raise ModelServerError(f"cloud infer answered {e.code}") from None
        except (urllib.error.URLError, OSError, TimeoutError):
            raise ModelServerError("cloud infer unreachable") from None
        try:
            return json.loads(raw)
        except ValueError:
            raise ModelServerError("cloud infer sent an invalid response") from None

    def detect(self, frame_bgr) -> list[dict]:
        ids, scores = class_filter(self.model.get("class_config") or {})
        if not ids:
            return []
        if not self.cloud_url:
            self.state, self.detail = "error", "no cloud url"
            raise ModelNotReady(self.detail)
        jpeg = _jpeg(frame_bgr, cap=140_000)   # backend edge-cloud-infer cap is 150KB
        if jpeg is None:
            return []
        t0 = time.monotonic()
        try:
            doc = self._post(jpeg)
        except ModelServerError as e:
            self.state, self.detail = "error", str(e)[:200]
            raise ModelNotReady(self.detail) from None
        ms = (time.monotonic() - t0) * 1000.0
        self.latency_ms = ms if self.latency_ms is None else round(0.8 * self.latency_ms + 0.2 * ms, 2)
        dets = doc.get("detections")
        if not isinstance(dets, list):
            self.state, self.detail = "error", "cloud infer sent no detections list"
            raise ModelNotReady(self.detail)
        self.state, self.detail = "ready", ""
        return _filtered(dets[:300], scores)


class ExternalDetector:
    """External model endpoint (9.6): POSTs the frame to a hosted service and
    maps the response onto the WDS detection schema.

    provider 'generic' and 'hf' speak the 9.10 contract directly (the HF case
    differs only in the Authorization header). 'roboflow' maps the hosted
    Inference response (pixel x/y/width/height center boxes) into normalized
    WDS boxes using the request image's aspect at INFER_MAX_W."""

    MAX_BODY = 4 * 1024 * 1024

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        """A redirect would re-POST the frame — and possibly the Bearer key —
        to a host we never vetted. Fail instead; the response lands as an
        HTTPError and the endpoint is marked unreachable."""

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    @staticmethod
    def _url_ok(url: str | None) -> bool:
        """Remote providers must be https; plain http is allowed only for
        loopback (a local sidecar/test endpoint never leaves the host)."""
        if not url:
            return False
        try:
            u = urlsplit(url)
        except ValueError:
            return False
        if u.scheme == "https":
            return True
        return u.scheme == "http" and (u.hostname or "") in (
            "localhost", "127.0.0.1", "::1")

    def __init__(self, model: dict):
        self.model = model
        self.version = model.get("version_id")
        ext = model.get("external") or {}
        self.provider = ext.get("provider") or "generic"
        self.url = ext.get("url")
        self.key = ext.get("key")
        self._opener = urllib.request.build_opener(self._NoRedirect)
        self._url_bad = bool(self.url) and not self._url_ok(self.url)
        if not self.url:
            self.state, self.detail = "error", "no endpoint url"
        elif self._url_bad:
            self.state, self.detail = "error", "endpoint url must be https"
        else:
            self.state, self.detail = "ready", ""
        self.engine, self.bench_fps = f"external:{self.provider}"[:80], None
        self.latency_ms = None
        self.placement = "cloud"          # frames leave the plant — gate treats it as cloud

    def _map_roboflow(self, doc: dict, w: int, h: int) -> list[dict]:
        out = []
        for p in (doc.get("predictions") or [])[:300]:
            try:
                cid = self.model.get("classes", []).index(str(p.get("class")))
            except (ValueError, AttributeError):
                cid = p.get("class_id", 0)
            x, y, pw, ph = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
            out.append({"class_id": int(cid), "class": str(p.get("class", "")),
                        "score": max(0.0, min(1.0, float(p.get("confidence") or 0))),
                        "bbox": [max(0.0, (x - pw / 2) / w), max(0.0, (y - ph / 2) / h),
                                 min(1.0, pw / w), min(1.0, ph / h)]})
        return out

    def detect(self, frame_bgr) -> list[dict]:
        ids, scores = class_filter(self.model.get("class_config") or {})
        if not ids:
            return []
        if not self.url:
            self.state, self.detail = "error", "no endpoint url"
            raise ModelNotReady(self.detail)
        if self._url_bad:
            self.state, self.detail = "error", "endpoint url must be https"
            raise ModelNotReady(self.detail)
        jpeg = _jpeg(frame_bgr, cap=4 * 1024 * 1024)   # provider-side sanity bound
        if jpeg is None:
            return []
        headers = {"Content-Type": "image/jpeg"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(self.url, data=jpeg, method="POST", headers=headers)
        t0 = time.monotonic()
        try:
            # opener without a redirect handler: a 3xx must not re-POST the
            # frame (and its Authorization header) to an unvetted host
            with self._opener.open(req, timeout=CLOUD_TIMEOUT_S) as r:  # noqa: S310 — operator-set URL
                doc = json.loads(r.read(self.MAX_BODY))
        except urllib.error.HTTPError as e:
            self.state, self.detail = "error", f"endpoint answered {e.code}"
            raise ModelNotReady(self.detail) from None
        except (urllib.error.URLError, OSError, TimeoutError):
            self.state, self.detail = "error", "endpoint unreachable"
            raise ModelNotReady(self.detail) from None
        except ValueError:
            self.state, self.detail = "error", "endpoint sent an invalid response"
            raise ModelNotReady(self.detail) from None
        self.latency_ms = round((time.monotonic() - t0) * 1000.0, 2) if self.latency_ms is None \
            else round(0.8 * self.latency_ms + 0.2 * (time.monotonic() - t0) * 1000.0, 2)
        if self.provider == "roboflow":
            dets = self._map_roboflow(doc, *frame_bgr.shape[:2][::-1])
        else:
            dets = doc.get("detections") if isinstance(doc, dict) else None
            if not isinstance(dets, list):
                self.state, self.detail = "error", "endpoint sent no detections list"
                raise ModelNotReady(self.detail)
        self.state, self.detail = "ready", ""
        return _filtered(dets[:300], scores)


class FailoverDetector:
    """Auto placement (9.5): edge first; FAILOVER_N edge failures inside
    FAILOVER_WINDOW_S switch to cloud for at least FAILOVER_BACK_S, then the
    edge is probed again. Without a cloud_url it degrades to plain edge."""

    def __init__(self, edge: ModelDetector, cloud: CloudDetector | None):
        self.edge, self.cloud = edge, cloud
        self.version = edge.version
        self._fails: list[float] = []
        self._on_cloud = False
        self._cloud_since = 0.0
        self._redelegate()

    def _redelegate(self):
        d = self.cloud if self._on_cloud and self.cloud is not None else self.edge
        self.state, self.detail = d.state, d.detail
        self.engine, self.latency_ms = d.engine, d.latency_ms
        self.bench_fps = d.bench_fps
        self.placement = "cloud" if d is self.cloud else "edge"

    def detect(self, frame_bgr) -> list[dict]:
        now = time.monotonic()
        if self._on_cloud:
            if self.cloud is None or now - self._cloud_since >= FAILOVER_BACK_S:
                # probe the edge once: a success moves the camera back
                try:
                    return self._edge(frame_bgr)
                except ModelNotReady:
                    self._cloud_since = now
                    if self.cloud is None:
                        self._redelegate()
                        raise
            try:
                return self.cloud.detect(frame_bgr)
            finally:
                self._redelegate()
        try:
            return self._edge(frame_bgr)
        except ModelNotReady as e:
            # a cold load (state="loading") or a throttled re-check is not an
            # inference failure — only real errors feed the failover counter
            if not e.throttled and self.edge.state == "error":
                self._fails = [t for t in self._fails
                               if now - t < FAILOVER_WINDOW_S] + [now]
                if len(self._fails) >= FAILOVER_N and self.cloud is not None:
                    self._on_cloud, self._cloud_since, self._fails = True, now, []
                    log.warning("edge inference failing — camera failed over to cloud")
            self._redelegate()
            raise

    def _edge(self, frame_bgr):
        try:
            return self.edge.detect(frame_bgr)
        finally:
            if self._on_cloud and self.edge.state == "ready":
                self._on_cloud, self._fails = False, []
                log.info("edge inference healthy — camera moved back from cloud")
            self._redelegate()


def make_detector(cam: dict, model_client: ModelClient):
    """Detector for a camera cfg entry (runner's factory seam)."""
    model = cam.get("model")
    if not model:
        return NullDetector()
    if isinstance(model.get("external"), dict):
        return ExternalDetector(model)
    placement = model.get("placement")
    if placement == "cloud":
        return CloudDetector(model)
    edge = ModelDetector(model_client, model)
    if placement == "auto" and model.get("cloud_url"):
        return FailoverDetector(edge, CloudDetector(model))
    return edge
