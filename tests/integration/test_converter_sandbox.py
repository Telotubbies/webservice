"""Converter sandbox (roadmap 9.1 acceptance): a crafted pickle that writes outside its folder
or opens a socket must fail without effect. Needs the stack incl. `model-converter`
(`make up-test`) and the docker CLI on the test host."""

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

CONTAINER = "webservice-model-converter-1"
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


def test_crafted_pickle_fails_without_effect(base_url, converter):
    import httpx
    with httpx.Client(base_url=base_url, timeout=30, headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        m = c.post(BASE, json={"name": f"evil-{uuid.uuid4().hex[:6]}", "task": "detect"}).json()["model"]
        try:
            v = c.post(f"{BASE}/{m['id']}/versions", params={"filename": "weights.pt"}, content=_evil_pt()).json()["version"]
            deadline, status = time.time() + 120, "processing"
            while time.time() < deadline and status == "processing":
                time.sleep(2)
                status = c.get(f"{BASE}/{m['id']}/versions/{v['id']}").json()["version"]["status"]
            assert status == "failed", f"expected failed, got {status}"
            reason = c.get(f"{BASE}/{m['id']}/versions/{v['id']}").json()["version"]["failure_reason"]
        finally:
            for x in c.get(f"{BASE}/{m['id']}/versions").json()["items"]:
                c.delete(f"{BASE}/{m['id']}/versions/{x['id']}")
            c.delete(f"{BASE}/{m['id']}")
    spool = _docker("exec", converter, "ls", "-a", "/spool").stdout
    _docker("exec", converter, "sh", "-c", "rm -f /spool/PROBE-*")
    assert "PROBE-fs" not in spool and "PROBE-net" not in spool, f"the pickle had an effect: {spool}"
    assert _docker("exec", converter, "ls", "/escape.txt").returncode != 0      # nothing written outside
    if "PROBE-none" not in spool:
        # the loader refused to unpickle (or the job failed earlier): safe, but the sandbox itself was not exercised
        pytest.skip(f"the crafted pickle never executed, so the sandbox was not exercised; failure reason: {reason}")
