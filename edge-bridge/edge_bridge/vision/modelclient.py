"""HTTP client for the gateway model server (roadmap 9.10). stdlib only."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


class ModelServerError(Exception):
    pass


class ModelClient:
    RETRY_FAILED_S = 30.0      # a failed load is retried (with a fresh PUT) after this long
    RELOAD_S = 10.0            # a PUT the server forgot (restart) is repeated after this long

    def __init__(self, base_url: str, timeout: float = 5.0, deadline: float | None = None):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.deadline = deadline     # absolute monotonic budget covering ALL calls (model_test op)
        self._put_at: dict[str, float] = {}

    # -- transport ---------------------------------------------------------------
    def _remaining(self) -> float | None:
        if self.deadline is None:
            return None
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise ModelServerError("timeout")
        return left

    def _call(self, method: str, path: str, body: bytes | None = None, ctype: str = "application/json",
              timeout: float | None = None) -> dict:
        left = self._remaining()              # checked before EVERY request
        wait = timeout or self.timeout
        if left is not None:
            wait = min(wait, left)
        req = urllib.request.Request(self.base + path, data=body, method=method,
                                     headers={"Content-Type": ctype} if body is not None else {})
        try:
            with urllib.request.urlopen(req, timeout=wait) as r:      # noqa: S310
                raw = r.read(8 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            raise ModelServerError(f"model server answered {e.code}") from None
        except (urllib.error.URLError, OSError, TimeoutError):
            raise ModelServerError("model server unreachable") from None
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise ModelServerError("model server sent an invalid response") from None

    def health(self) -> dict:
        return self._call("GET", "/v1/health")

    # -- model lifecycle -----------------------------------------------------------
    def ensure(self, model: dict) -> str:
        """'loaded' | 'loading' | 'failed:<reason>'. Idempotent: one PUT per version until it is lost or failed."""
        vid = model["version_id"]
        try:
            h = self.health()
        except ModelServerError as e:
            return f"failed:{e}"
        now = time.monotonic()
        if vid in h.get("loaded", []):
            return "loaded"
        put_at = self._put_at.get(vid)
        if vid in h.get("failed", {}) and put_at is not None and now - put_at < self.RETRY_FAILED_S:
            return f"failed:{h['failed'][vid]}"
        if vid in h.get("loading", []) or (put_at is not None and now - put_at < self.RELOAD_S):
            return "loading"
        try:
            self._call("PUT", f"/v1/models/{vid}", json.dumps({
                "url": model["url"], "sha256": model["sha256"], "task": model["task"],
                "imgsz": model["imgsz"], "classes": model["classes"]}).encode())
        except ModelServerError as e:
            return f"failed:{e}"
        self._put_at[vid] = now
        try:
            h = self.health()
        except ModelServerError as e:
            return f"failed:{e}"
        if vid in h.get("loaded", []):
            return "loaded"
        if vid in h.get("failed", {}):
            return f"failed:{h['failed'][vid]}"
        return "loading"

    def engine(self, vid: str) -> str | None:
        try:
            return (self.health().get("engines") or {}).get(vid)
        except ModelServerError:
            return None

    def infer(self, vid: str, jpeg: bytes, class_ids: list[int], conf: float) -> tuple[list, float]:
        q = f"/v1/infer?model={vid}&conf={conf:.3f}" + (f"&classes={','.join(map(str, class_ids))}" if class_ids else "")
        doc = self._call("POST", q, jpeg, "image/jpeg")
        dets = doc.get("detections")
        if not isinstance(dets, list):
            raise ModelServerError("model server sent no detections list")
        return dets, float(doc.get("ms") or 0.0)

    def benchmark(self, vid: str, frames: int = 20) -> dict:
        return self._call("POST", f"/v1/benchmark?model={vid}&frames={frames}", b"", timeout=120.0)
