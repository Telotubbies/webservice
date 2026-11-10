"""Security design section 7 tests that had no file yet: T8 (converter swap/rescan/provenance), T9 (WS cap not
per-IP only), T12 (viewer cannot command, API level) and the closed self-registration of the realm.

T1/T10 live in edge-bridge/tests/test_plc_write_gate.py and tests/contract/test_mfa_stepup.py;
T2 in tests/integration/test_f21_arming.py; T11 in tests/integration/test_f18_webhook_hmac.py;
T13/T14 in tests/e2e/e2e_f21_security.py.
"""

import asyncio
import contextlib
import json
import os
import pickle
import sys
import time
import uuid
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "model-converter"))

import converter  # noqa: E402


# ---------------- T8: a .pt swapped after upload is refused ----------------

class _Evil:
    def __reduce__(self):
        return (os.system, ("echo pwned",))


def _pt(path: Path, payload: bytes) -> bytes:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("archive/data.pkl", payload)
    return path.read_bytes()


def _job(spool: Path, pt_bytes: bytes, sha: str | None):
    jid = str(uuid.uuid4())
    (spool / f"{jid}.pt").write_bytes(pt_bytes)
    meta = {"id": jid, "task_hint": "detect", "queued_at": time.time()}
    if sha is not None:
        meta["sha256"] = sha
    (spool / f"{jid}.json").write_text(json.dumps(meta))
    return jid


def _result(spool, jid):
    return json.loads((spool / f"{jid}.result.json").read_text())


def _fake_convert(src, out, task):
    o = out / "m.onnx"
    o.write_bytes(b"onnx-bytes")
    return o


def test_t8_file_swapped_after_scan_is_refused_by_hash(tmp_path):
    good = _pt(tmp_path / "good.pt", pickle.dumps({"a": 1}, protocol=2))
    sha_scanned = converter.hashlib.sha256(good).hexdigest()
    swapped = _pt(tmp_path / "swap.pt", pickle.dumps({"a": 2}, protocol=2))        # still harmless, but not the scanned file
    spool = tmp_path / "spool"
    spool.mkdir()
    jid = _job(spool, swapped, sha_scanned)
    called = []
    converter.process_job(spool, jid, lambda *a: called.append(1) or _fake_convert(*a))
    r = _result(spool, jid)
    assert r["ok"] is False and r["error"].startswith("hash_mismatch")
    assert not called, "the exporter must never see a file that failed the hash check"
    assert not (spool / f"{jid}.pt").exists() and not (spool / f"{jid}.onnx").exists()


def test_t8_hostile_pickle_with_a_matching_hash_is_caught_by_the_rescan(tmp_path):
    evil = _pt(tmp_path / "evil.pt", pickle.dumps(_Evil(), protocol=4))
    spool = tmp_path / "spool"
    spool.mkdir()
    jid = _job(spool, evil, converter.hashlib.sha256(evil).hexdigest())          # backend scan was bypassed, hash agrees
    called = []
    converter.process_job(spool, jid, lambda *a: called.append(1) or _fake_convert(*a))
    r = _result(spool, jid)
    assert r["ok"] is False and "unsafe_checkpoint on rescan" in r["error"]
    assert not called


def test_t8_clean_checkpoint_records_provenance_of_the_onnx(tmp_path):
    good = _pt(tmp_path / "good.pt", pickle.dumps({"a": 1}, protocol=2))
    sha = converter.hashlib.sha256(good).hexdigest()
    spool = tmp_path / "spool"
    spool.mkdir()
    jid = _job(spool, good, sha)
    converter.process_job(spool, jid, _fake_convert)
    r = _result(spool, jid)
    assert r["ok"] is True and r["rescan"] == "clean"
    assert r["pt_sha256"] == sha                                                   # the .onnx is tied to the scanned .pt
    assert r["onnx_sha256"] == converter.hashlib.sha256((spool / f"{jid}.onnx").read_bytes()).hexdigest()


def test_t8_container_mode_refuses_a_job_without_the_backend_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("CONVERTER_REQUIRE_SHA", "1")
    good = _pt(tmp_path / "good.pt", pickle.dumps({"a": 1}, protocol=2))
    spool = tmp_path / "spool"
    spool.mkdir()
    jid = _job(spool, good, None)
    converter.process_job(spool, jid, _fake_convert)
    assert _result(spool, jid)["ok"] is False


# ---------------- T9: WS cap must not punish other users behind the same IP ----------------

@pytest.mark.integration
def test_t9_one_users_sockets_do_not_block_another_user_on_the_same_ip(ws_base):
    websockets = pytest.importorskip("websockets")
    from conftest import OPERATOR_TOKEN, VIEWER_TOKEN
    cap = int(os.environ.get("RATE_WS_PER_USER", "20"))

    async def connect(token):
        ws = await websockets.connect(f"{ws_base}/ws", open_timeout=10)
        await ws.send(json.dumps({"type": "auth", "token": token}))
        await asyncio.wait_for(ws.recv(), timeout=8)
        return ws

    async def run():
        held = []
        try:
            for _ in range(cap):                         # the viewer fills the per-IP budget
                held.append(await connect(VIEWER_TOKEN))
            await asyncio.sleep(0.3)
            held.append(await connect(OPERATOR_TOKEN))     # a different user, same IP: must still get in
        finally:
            for s in held:
                with contextlib.suppress(Exception):
                    await s.close()

    asyncio.run(run())


# ---------------- T12 (API level): a viewer cannot command, even by calling the API directly ----------------

@pytest.mark.integration
@pytest.mark.security
def test_t12_viewer_direct_command_is_403(base_url):
    httpx = pytest.importorskip("httpx")
    from conftest import TAGS, VIEWER_TOKEN
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as v:
        r = v.post("/api/commands", json={"reason": "t12", "tag": TAGS["speed_sp"], "value": 20,
                                          "idempotency_key": f"t12-{uuid.uuid4()}", "ttl_s": 15})
        assert r.status_code == 403, r.text


# ---------------- self-registration is closed ----------------

@pytest.mark.parametrize("realm", ["infra/keycloak/realm-wds.json", "infra/keycloak-prod/realm-wds.json"])
def test_realm_files_have_self_registration_off(realm):
    j = json.loads((REPO / realm).read_text(encoding="utf-8"))
    assert j["registrationAllowed"] is False


@pytest.mark.integration
@pytest.mark.security
def test_live_realm_does_not_serve_a_registration_form():
    httpx = pytest.importorskip("httpx")
    kc = os.environ.get("KC_URL", "http://localhost:8080").rstrip("/")
    try:
        r = httpx.get(f"{kc}/realms/wds/protocol/openid-connect/registrations",
                      params={"client_id": "wds-web", "response_type": "code", "scope": "openid",
                              "redirect_uri": "http://localhost:5173/"}, follow_redirects=True, timeout=15.0)
    except httpx.HTTPError:
        pytest.skip("keycloak not reachable")
    body = r.text.lower()
    assert 'name="password-confirm"' not in body and 'id="password-confirm"' not in body, "a registration form was served"
