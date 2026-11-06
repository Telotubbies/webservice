"""Converter sandbox (roadmap 9.1 acceptance): a crafted pickle that writes outside its folder
or opens a socket must fail without effect. Needs the stack incl. `model-converter`
(`make up-test`) and the docker CLI on the test host."""

import json
import os
import pickle
import shutil
import subprocess
import time
import uuid
import zipfile
import io

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID  # noqa: E402

CONTAINER = os.environ.get("CONVERTER_CONTAINER", "webservice-model-converter-1")  # compose project name varies
BASE = f"/api/v1/orgs/{ORG_ID}/vision/models"

PAYLOAD = """
import socket
res = []
try:
    open('/escape.txt', 'w').write('x'); res.append('fs')
except Exception:
    pass
try:
    socket.create_connection(('1.1.1.1', 53), 2); res.append('net')
except Exception:
    pass
open('/spool/PROBE-' + '-'.join(res or ['none']), 'w').write('')
"""


class _Evil:
    def __reduce__(self):
        return (exec, (PAYLOAD,))


def _evil_pt() -> bytes:
    """A zip shaped like torch.save output whose data.pkl runs EVIL when unpickled."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("archive/data.pkl", pickle.dumps(_Evil(), protocol=2))  # only ever built here, never loaded here
        z.writestr("archive/version", "3\n")
        z.writestr("archive/byteorder", "little")
    return buf.getvalue()


def _docker(*args):
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=30)


@pytest.fixture()
def converter():
    if not shutil.which("docker"):
        pytest.skip("docker CLI not available")
    r = _docker("inspect", "-f", "{{.State.Running}}", CONTAINER)
    if r.returncode != 0 or "true" not in r.stdout:
        pytest.skip(f"{CONTAINER} is not running (make up-test)")
    return CONTAINER


def test_container_is_locked_down(converter):
    out = _docker("inspect", "-f",
                  "{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Memory}}|{{.HostConfig.PidsLimit}}"
                  "|{{.HostConfig.CapDrop}}|{{.Config.User}}", converter).stdout.strip()
    net, ro, mem, pids, caps, user = out.split("|")
    assert net == "none" and ro == "true" and int(mem) > 0 and int(pids) > 0 and "ALL" in caps and user.startswith("10001")


def _drop_job(converter, jid, data: bytes):
    """Hand the crafted .pt straight to the converter's spool. Upload now refuses it first (ptscan, 422);
    this test is about the second gate, so it must not depend on the first one being bypassable."""
    put = lambda name, body: subprocess.run(["docker", "exec", "-i", converter, "sh", "-c", f"cat > /spool/{name}"],
                                            input=body, capture_output=True, timeout=30, check=True)
    put(f"{jid}.pt", data)
    put(f"{jid}.json", json.dumps({"id": jid, "task_hint": "detect", "queued_at": time.time()}).encode())  # job file last


def test_crafted_pickle_fails_without_effect(base_url, converter):
    jid = str(uuid.uuid4())
    _drop_job(converter, jid, _evil_pt())
    deadline = time.time() + 120
    while time.time() < deadline:                        # the converter deletes the .pt once the job has run
        time.sleep(2)
        if _docker("exec", converter, "ls", f"/spool/{jid}.pt").returncode != 0:
            break
    else:
        pytest.fail("the converter never finished the crafted job")
    reason = "job ran in the converter"
    spool = _docker("exec", converter, "ls", "-a", "/spool").stdout
    _docker("exec", converter, "sh", "-c", "rm -f /spool/PROBE-*")
    assert "PROBE-fs" not in spool and "PROBE-net" not in spool, f"the pickle had an effect: {spool}"
    assert _docker("exec", converter, "ls", "/escape.txt").returncode != 0      # nothing written outside
    if "PROBE-none" not in spool:
        # the loader refused to unpickle (or the job failed earlier): safe, but the sandbox itself was not exercised
        pytest.skip(f"the crafted pickle never executed, so the sandbox was not exercised; failure reason: {reason}")
