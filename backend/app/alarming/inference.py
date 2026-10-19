"""External AI inference hook. The org's latest tag values are POSTed to
INFERENCE_URL; the model server answers with labelled scores that the console
shows (Assistant page). Results are cached per org for INFERENCE_PERIOD_S, so
page polling never turns into model traffic.

Request : {"org_id", "ts", "tags": [{"name", "v", "q", "ts"}]}
Response: {"model": str, "results": [{"tag"?: str, "label": str, "score": 0..1,
           "severity"?: "info"|"warning"|"critical", "detail"?: str}]}

Implementation notes: the cache is in-memory and per-process (single
replica); HTTP uses stdlib urllib in a worker thread, so no new dependency.
Move to a shared cache when the backend scales out.
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.request
from uuid import UUID

from ..core import config

_SEV = {"info", "warning", "critical"}
_cache: dict[UUID, dict] = {}
_locks: dict[UUID, asyncio.Lock] = {}


def _post(payload: dict) -> dict:
    req = urllib.request.Request(
        config.INFERENCE_URL, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {config.INFERENCE_API_KEY}"} if config.INFERENCE_API_KEY else {})})
    with urllib.request.urlopen(req, timeout=config.INFERENCE_TIMEOUT_S) as r:  # noqa: S310 — operator-set URL
        return json.loads(r.read(1_000_000))


def _clean(body: dict) -> tuple[str, list[dict]]:
    """Trust boundary: the model server is external, so coerce and cap its output."""
    out = []
    for r in (body.get("results") or [])[:200]:
        try:
            score = float(r.get("score"))
        except (TypeError, ValueError):
            continue
        if score != score:  # NaN
            continue
        out.append({"tag": str(r["tag"])[:200] if r.get("tag") else None,
                    "label": str(r.get("label", ""))[:80], "score": max(0.0, min(1.0, score)),
                    "severity": r["severity"] if r.get("severity") in _SEV else "info",
                    "detail": str(r.get("detail", ""))[:300]})
    return str(body.get("model", ""))[:80], out


async def latest(org_id: UUID, features: list[dict]) -> dict:
    """Cached result for the org; refreshes when older than the period."""
    if not config.INFERENCE_URL:
        return {"configured": False}
    lock = _locks.setdefault(org_id, asyncio.Lock())
    async with lock:
        c = _cache.get(org_id)
        if c and time.monotonic() - c["_at"] < config.INFERENCE_PERIOD_S:
            return {k: v for k, v in c.items() if k != "_at"}
        t0 = time.monotonic()
        res: dict = {"configured": True, "ts": time.time()}
        try:
            body = await asyncio.to_thread(_post, {"org_id": str(org_id), "ts": res["ts"], "tags": features})
            res["model"], res["results"] = _clean(body)
            res["error"] = None
        except Exception as exc:  # model down must not break the page
            res.update(model="", results=[], error=type(exc).__name__)
        res["latency_ms"] = round((time.monotonic() - t0) * 1000)
        _cache[org_id] = {**res, "_at": time.monotonic()}
        return res
