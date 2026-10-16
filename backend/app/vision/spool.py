"""File-based job queue shared with the `model-converter` container (plan M1-04 T3/T4).

The backend never opens a `.pt` file and never talks to Docker: it writes
`{id}.pt` + `{id}.json` into the spool and later reads `{id}.result.json` and
`{id}.onnx` back. The converter has no network and no other shared state.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from uuid import UUID

from ..core import config

RESULT_MAX_BYTES = 8192
STALE_S = 900


def _dir() -> Path:
    p = Path(config.CONVERT_SPOOL)
    p.mkdir(parents=True, exist_ok=True)
    return p


def pt_path(job_id: UUID) -> Path:
    return _dir() / f"{job_id}.pt"


def enqueue(job_id: UUID, task_hint: str) -> None:
    """The .pt is already at pt_path(job_id); publish the job file last so a
    converter never sees a half-written upload."""
    fd, tmp = tempfile.mkstemp(dir=_dir(), prefix=".job-")
    with os.fdopen(fd, "w") as f:
        json.dump({"id": str(job_id), "task_hint": task_hint, "queued_at": time.time()}, f)
    os.replace(tmp, _dir() / f"{job_id}.json")


def results() -> list[tuple[UUID, dict]]:
    """Finished jobs: [(id, {ok, error?})]. Malformed result files count as failures."""
    out = []
    for f in _dir().glob("*.result.json"):
        try:
            jid = UUID(f.name.split(".")[0])
        except ValueError:
            continue
        try:
            raw = f.read_bytes()[:RESULT_MAX_BYTES]
            doc = json.loads(raw)
            if not isinstance(doc, dict):
                raise ValueError
        except (OSError, ValueError):
            doc = {"ok": False, "error": "converter result unreadable"}
        out.append((jid, doc))
    return out


def onnx_path(job_id: UUID) -> Path:
    return _dir() / f"{job_id}.onnx"


def cleanup(job_id: UUID) -> None:
    for suffix in (".pt", ".json", ".onnx", ".result.json"):
        try:
            os.remove(_dir() / f"{job_id}{suffix}")
        except FileNotFoundError:
            pass
