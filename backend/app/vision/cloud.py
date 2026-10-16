"""Cloud inference pool client (roadmap 9.5/9.10): the backend forwards a
gateway's sampled JPEG to a model server under the same /v1 contract the edge
uses locally, and returns the (sanitized) detections.

The pool URL is CLOUD_MODEL_SERVER_URL; an empty value means "no cloud pool" —
the edge-cloud-infer route answers 502 and Auto cameras simply stay on the
gateway at lower FPS (the spec's degrade path).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.request
from uuid import UUID

from ..core import config
from ..db.context import global_tx
from .classes import model_sig
from .results import clean_test_result

log = logging.getLogger("wds.vision.cloud")

TIMEOUT_S = 10.0
MAX_RESP = 4 * 1024 * 1024

_loaded: set[str] = set()   # versions confirmed loaded this process lifetime


class CloudInferError(Exception):
    pass


def _base() -> str:
    # operator env var; empty = no cloud pool (Auto cameras stay on the edge)
    return (os.environ.get("CLOUD_MODEL_SERVER_URL") or "").rstrip("/")


def _call(method: str, path: str, body: bytes | None = None,
          ctype: str = "application/json", timeout: float = TIMEOUT_S) -> dict:
    req = urllib.request.Request(_base() + path, data=body, method=method,
                                 headers={"Content-Type": ctype} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 — operator-set URL
            raw = r.read(MAX_RESP)
    except urllib.error.HTTPError as e:
        raise CloudInferError(f"model server answered {e.code}") from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise CloudInferError("model server unreachable") from None
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        raise CloudInferError("model server sent an invalid response") from None


def _ensure(version_row, edge_id: UUID) -> None:
    """Load the pinned version on the cloud pool once per process (9.10 PUT)."""
    vid = str(version_row["id"])
    if vid in _loaded:
        return
    try:
        health = _call("GET", "/v1/health")
    except CloudInferError:
        raise
    if vid in (health.get("loaded") or []):
        _loaded.add(vid)
        return
    url = (f"{config.EDGE_MEDIA_BASE_URL}/api/v1/edge-models/{vid}"
           f"?edge={edge_id}&sig={model_sig(edge_id, version_row['id'], version_row['sha256'])}")
    _call("PUT", f"/v1/models/{vid}", json.dumps({
        "url": url, "sha256": version_row["sha256"], "task": version_row["task"],
        "imgsz": version_row["imgsz"], "classes": version_row["classes"]}).encode())
    # loading is async on the server; the caller's infer will retry briefly
    for _ in range(40):
        try:
            h = _call("GET", "/v1/health")
        except CloudInferError:
            raise
        if vid in (h.get("loaded") or []):
            _loaded.add(vid)
            return
        failed = (h.get("failed") or {}).get(vid)
        if failed is not None:
            raise CloudInferError(f"model load failed: {str(failed)[:80]}")
        time.sleep(0.5)
    raise CloudInferError("model load timed out")


async def infer(st, version_id: UUID, jpeg: bytes, class_config: dict,
                edge_id: UUID) -> dict:
    """One frame through the cloud pool -> {ms, engine, detections} sanitized
    through results.py exactly like edge output (9.10 untrusted input)."""
    if not _base():
        raise CloudInferError("no cloud pool configured")
    async with global_tx(st.pools.system) as conn:
        v = await conn.fetchrow(
            "SELECT v.id, v.sha256, v.imgsz, v.classes, v.status, m.task"
            " FROM vision_model_versions v JOIN vision_models m ON m.id=v.model_id"
            " WHERE v.id=$1", version_id)
    if v is None or v["classes"] is None or v["status"] not in ("active", "archived"):
        raise CloudInferError("version_not_loadable")
    classes = list(v["classes"])
    scores = {int(k): float(c["min_score"]) for k, c in class_config.items()
              if isinstance(c, dict) and c.get("enabled") and isinstance(c.get("min_score"), (int, float))}
    ids = sorted(i for i in scores if 0 <= i < len(classes))
    if not ids:
        return {"ms": 0.0, "engine": None, "detections": []}
    conf = min(scores[i] for i in ids)

    def _work() -> dict:
        _ensure(v, edge_id)
        q = f"/v1/infer?model={version_id}&conf={conf:.3f}&classes={','.join(map(str, ids))}"
        return _call("POST", q, jpeg, "image/jpeg")

    doc = await asyncio.to_thread(_work)
    return clean_test_result(doc, classes)


async def usage_summary(st, org_id: UUID) -> list[dict]:
    """inference_usage rows for the current month (gateway UI, 9.9)."""
    async with global_tx(st.pools.system) as conn:
        rows = await conn.fetch(
            "SELECT day, placement, frames, gpu_seconds FROM inference_usage"
            " WHERE org_id=$1 AND day >= date_trunc('month', CURRENT_DATE)"
            " ORDER BY day", org_id)
    return [dict(r) for r in rows]
