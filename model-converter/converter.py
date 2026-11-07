"""model-converter: turn uploaded `.pt` weights into ONNX inside a sandbox (plan M1-04 T4).

Spool protocol (shared volume, the only thing this container can reach):
    in : {id}.pt + {id}.json   {"id", "task_hint", "queued_at"}
    out: {id}.onnx + {id}.result.json   {"ok": bool, "error"?: str}
The `.pt` and the job file are deleted whatever happens. `process_job` takes the
convert function as an argument so the protocol is testable without torch.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Callable

log = logging.getLogger("model-converter")

JOB_TIMEOUT_S = 300          # wall clock for one conversion
STALE_S = 600                # a job that waited longer than this is failed, not run
ERR_MAX = 500


def pending_jobs(spool: Path) -> list[str]:
    """Job ids with a job file and a .pt but no result yet. Ids must be UUIDs: a file name is never a path."""
    out = []
    for j in sorted(spool.glob("*.json")):
        stem = j.name[:-len(".json")]
        if stem.endswith(".result"):
            continue
        try:
            jid = str(uuid.UUID(stem))
        except ValueError:
            continue
        if (spool / f"{jid}.pt").exists() and not (spool / f"{jid}.result.json").exists():
            out.append(jid)
    return out


def _write_result(spool: Path, jid: str, doc: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=spool, prefix=".res-")
    with os.fdopen(fd, "w") as f:
        json.dump(doc, f)
    os.replace(tmp, spool / f"{jid}.result.json")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def process_job(spool: Path, jid: str, convert: Callable[[Path, Path, str], Path | None],
                timeout_s: int = JOB_TIMEOUT_S) -> None:
    pt, job = spool / f"{jid}.pt", spool / f"{jid}.json"
    result: dict
    try:
        meta = json.loads(job.read_text())
        task = str(meta.get("task_hint") or "detect")
        pt_sha = sha256_file(pt)
        # The container sets CONVERTER_REQUIRE_SHA=1, so a job without the backend's hash is refused there.
        # Left unset (unit tests with fake weights) a job without a hash skips the integrity checks.
        verify = "sha256" in meta or os.environ.get("CONVERTER_REQUIRE_SHA") == "1"
        if time.time() - float(meta.get("queued_at") or 0) > STALE_S:
            result = {"ok": False, "error": "timeout: job waited too long"}
        elif verify and meta.get("sha256") != pt_sha:
            # the file changed between the backend's scan and now: never hand it to the exporter
            result = {"ok": False, "error": "hash_mismatch: the checkpoint is not the one that was uploaded"}
        elif verify and (_unsafe := _rescan(pt)) is not None:
            result = {"ok": False, "error": f"unsafe_checkpoint on rescan: {_unsafe}"}
        else:
            work = Path(tempfile.mkdtemp(prefix="job-"))
            try:
                src = work / "weights.pt"
                shutil.copyfile(pt, src)            # exporters write next to the weights; keep that off the spool
                onnx = convert(src, work, task)
                if onnx is None or not Path(onnx).exists():
                    result = {"ok": False, "error": "conversion produced no ONNX file"}
                else:
                    shutil.copyfile(onnx, spool / f"{jid}.onnx")
                    result = {"ok": True}
                    if verify:
                        result.update(pt_sha256=pt_sha, onnx_sha256=sha256_file(spool / f"{jid}.onnx"), rescan="clean")
            finally:
                shutil.rmtree(work, ignore_errors=True)
    except Exception as exc:  # noqa: BLE001 — any failure becomes a result, never a crash
        result = {"ok": False, "error": (str(exc) or type(exc).__name__)[:ERR_MAX]}
    for p in (pt, job):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
    if result["ok"] is False:
        try:
            (spool / f"{jid}.onnx").unlink()
        except FileNotFoundError:
            pass
    _write_result(spool, jid, result)


def _rescan(pt: Path) -> str | None:
    """Second, independent scan inside the converter (ptscan.py is a copy of backend/app/vision/ptscan.py)."""
    from ptscan import UnsafeCheckpoint, scan_pt
    try:
        scan_pt(pt)
    except UnsafeCheckpoint as e:
        return str(getattr(e, "code", e))
    return None


def convert_with_ultralytics(pt: Path, out_dir: Path, task: str) -> Path | None:
    """Run the real exporter in a child process so the wall-clock limit can kill it.
    This is where a hostile pickle would execute: the container is the boundary."""
    p = subprocess.run([sys.executable, str(Path(__file__).with_name("worker.py")), str(pt)],
                       cwd=str(out_dir), capture_output=True, text=True, timeout=JOB_TIMEOUT_S)
    if p.returncode != 0:
        raise RuntimeError(("export failed: " + (p.stderr or p.stdout)).strip()[-ERR_MAX:])
    outs = sorted(out_dir.glob("*.onnx"))
    return outs[0] if outs else None


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    spool = Path(os.environ.get("SPOOL_DIR", "/spool"))
    log.info("model-converter watching %s", spool)
    while True:
        for jid in pending_jobs(spool):
            log.info("job %s", jid)
            try:
                process_job(spool, jid, convert_with_ultralytics)
            except subprocess.TimeoutExpired:   # not reachable through process_job's catch-all, kept explicit
                log.warning("job %s timed out", jid)
        time.sleep(1.0)


if __name__ == "__main__":
    raise SystemExit(main())
