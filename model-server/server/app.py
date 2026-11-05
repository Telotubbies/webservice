"""HTTP contract of the gateway model server (roadmap 9.10)."""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

log = logging.getLogger("model-server")

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BENCH_FRAMES = 200
_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class PutModel(BaseModel):
    url: str
    sha256: str = Field(pattern="^[0-9a-f]{64}$")
    task: str = Field(pattern="^(detect|segment)$")
    imgsz: int = Field(ge=32, le=4096)
    classes: list[str] = Field(min_length=1, max_length=1000)

    @field_validator("url")
    @classmethod
    def _http(cls, v: str) -> str:
        if urlsplit(v).scheme not in ("http", "https"):
            raise ValueError("url must be http(s)")
        return v


def create_app(runtime, store, sync_loads: bool = False) -> FastAPI:
    # sync_loads runs loads inline (tests) instead of through the single-worker pool.
    app = FastAPI(title="wds model server", docs_url=None, redoc_url=None, openapi_url=None)
    failed: dict[str, str] = {}
    loading: set[str] = set()
    pool = ThreadPoolExecutor(max_workers=1)       # one load at a time keeps memory bounded

    def _vid(v: str) -> str:
        if not _ID.match(v):
            raise HTTPException(422, "invalid model id")
        return v

    def _load(vid: str, body: PutModel) -> None:
        try:
            path = store.ensure(body.url, body.sha256)
            runtime.load(vid, path, {"task": body.task, "imgsz": body.imgsz, "classes": list(body.classes),
                                     "sha256": body.sha256})
            failed.pop(vid, None)
        except Exception as exc:  # noqa: BLE001 — surfaced through /v1/health, never raised
            failed[vid] = (str(exc) or type(exc).__name__)[:300]
            log.warning("model %s failed to load: %s", vid, failed[vid])
        finally:
            loading.discard(vid)

    @app.get("/v1/health")
    def health():
        return {"device": os.environ.get("MODEL_DEVICE", "cpu"), "providers": runtime.providers(),
                "gpu_mem_mb": None, "loaded": runtime.loaded(), "loading": sorted(loading), "failed": dict(failed),
                "engines": {v: getattr(runtime, "engine", lambda _: None)(v) for v in runtime.loaded()}}

    @app.put("/v1/models/{version_id}", status_code=202)
    def put_model(version_id: str, body: PutModel):
        vid = _vid(version_id)
        # Idempotent: the same sha already loaded (or a load without a recorded sha) needs no reload.
        if vid in runtime.loaded() and getattr(runtime, "models", {}).get(vid, {}).get("sha256") in (None, body.sha256):
            return {"state": "loaded"}
        loading.add(vid)
        failed.pop(vid, None)
        if sync_loads:
            _load(vid, body)
        else:
            pool.submit(_load, vid, body)
        return {"state": "loading"}

    @app.delete("/v1/models/{version_id}", status_code=204)
    def delete_model(version_id: str):
        runtime.unload(_vid(version_id))
        failed.pop(version_id, None)

    @app.post("/v1/infer")
    async def infer(request: Request, model: str, classes: str | None = None, conf: float = 0.25):
        _vid(model)
        if not 0.0 <= conf <= 1.0:
            raise HTTPException(422, "conf must be 0..1")
        try:
            class_filter = {int(c) for c in classes.split(",") if c != ""} if classes else None
        except ValueError:
            raise HTTPException(422, "classes must be comma-separated ids") from None
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "image too large")
        body = await request.body()
        if len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "image too large")
        try:
            dets, ms = runtime.infer(model, body, class_filter, conf)
        except KeyError:
            raise HTTPException(404, "model not loaded") from None
        except ValueError:
            raise HTTPException(422, "body is not a decodable image") from None
        return {"model": model, "ms": ms, "detections": dets}

    @app.post("/v1/benchmark")
    def benchmark(model: str, frames: int = 20):
        _vid(model)
        if not 1 <= frames <= MAX_BENCH_FRAMES:
            raise HTTPException(422, f"frames must be 1..{MAX_BENCH_FRAMES}")
        try:
            return runtime.benchmark(model, frames)
        except KeyError:
            raise HTTPException(404, "model not loaded") from None

    return app


def main() -> None:   # pragma: no cover — container entry point
    import uvicorn
    from .runtime import Runtime
    from .store import ModelStore
    uvicorn.run(create_app(Runtime(), ModelStore(os.environ.get("MODEL_DIR", "/models"))),
                host="0.0.0.0", port=int(os.environ.get("PORT", "9000")), log_level=os.environ.get("LOG_LEVEL", "warning"))


if __name__ == "__main__":  # pragma: no cover
    main()
