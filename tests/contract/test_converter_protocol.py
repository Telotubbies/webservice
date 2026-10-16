"""model-converter spool protocol (plan M1-04 Task 4). `convert` is injected, so no torch here."""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "model-converter"))

import converter  # noqa: E402


def _job(spool: Path, queued_at=None, with_json=True) -> str:
    jid = str(uuid.uuid4())
    (spool / f"{jid}.pt").write_bytes(b"pretend weights")
    if with_json:
        (spool / f"{jid}.json").write_text(json.dumps(
            {"id": jid, "task_hint": "detect", "queued_at": queued_at if queued_at is not None else time.time()}))
    return jid


def _result(spool, jid):
    return json.loads((spool / f"{jid}.result.json").read_text())


def test_job_success_writes_result_and_deletes_pt(tmp_path):
    jid = _job(tmp_path)

    def fake(pt, out_dir, task):
        o = out_dir / "m.onnx"
        o.write_bytes(b"onnx-bytes")
        return o
    converter.process_job(tmp_path, jid, fake)
    assert _result(tmp_path, jid) == {"ok": True}
    assert (tmp_path / f"{jid}.onnx").read_bytes() == b"onnx-bytes"
    assert not (tmp_path / f"{jid}.pt").exists() and not (tmp_path / f"{jid}.json").exists()


def test_job_failure_reports_error_and_deletes_pt(tmp_path):
    jid = _job(tmp_path)

    def boom(pt, out_dir, task):
        raise RuntimeError("unpickling failed: " + "x" * 5000)
    converter.process_job(tmp_path, jid, boom)
    r = _result(tmp_path, jid)
    assert r["ok"] is False and "unpickling failed" in r["error"] and len(r["error"]) <= 500
    assert not (tmp_path / f"{jid}.pt").exists() and not (tmp_path / f"{jid}.onnx").exists()


def test_stale_job_times_out_without_converting(tmp_path):
    jid = _job(tmp_path, queued_at=time.time() - 10_000)
    called = []
    converter.process_job(tmp_path, jid, lambda *a: called.append(1))
    assert not called and _result(tmp_path, jid) == {"ok": False, "error": "timeout: job waited too long"}
    assert not (tmp_path / f"{jid}.pt").exists()


def test_convert_returning_nothing_is_a_failure(tmp_path):
    jid = _job(tmp_path)
    converter.process_job(tmp_path, jid, lambda pt, out, task: None)
    assert _result(tmp_path, jid)["ok"] is False


def test_pending_jobs_ignores_uploads_in_progress_and_finished(tmp_path):
    ready = _job(tmp_path)
    _job(tmp_path, with_json=False)                       # .pt without its job file: still uploading
    done = _job(tmp_path)
    (tmp_path / f"{done}.result.json").write_text('{"ok": true}')
    assert converter.pending_jobs(tmp_path) == [ready]


def test_hostile_job_ids_are_never_used_as_paths(tmp_path):
    (tmp_path / "..%2fevil.json").write_text("{}")
    (tmp_path / "not-a-uuid.json").write_text("{}")
    assert converter.pending_jobs(tmp_path) == []
