"""Frame relay end to end: a provisioned edge credential publishes JPEG frames,
the browser side reads them back (snapshot + MJPEG), and signatures hold."""

import json
import queue
import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import MQTT_CA_FILE, MQTT_HOST, MQTT_PORT, ORG_ID, SITE_ID, wait_until  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0" + b"fake-jpeg-body" * 20 + b"\xff\xd9"


class FakeEdge:
    def __init__(self, edge_id, username, secret):
        import paho.mqtt.client as mqtt
        self.prefix = f"v2/{ORG_ID}/{SITE_ID}/{edge_id}"
        self.ready = queue.Queue()
        self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fake-{uuid.uuid4().hex[:8]}")
        self.c.username_pw_set(username, secret)
        self.c.tls_set(ca_certs=MQTT_CA_FILE)
        self.c.on_connect = lambda c, u, f, rc, p: self.ready.put(rc)
        self.c.connect(MQTT_HOST, MQTT_PORT, keepalive=15)
        self.c.loop_start()

    def wait_ready(self, timeout=10):
        rc = self.ready.get(timeout=timeout)
        assert not rc.is_failure, f"connect refused: {rc}"

    def frame(self, camera_id, data=JPEG):
        self.c.publish(f"{self.prefix}/vision/frame/{camera_id}", data, qos=0)

    def stat(self, doc):
        self.c.publish(f"{self.prefix}/vision/stat", json.dumps(doc), qos=0)

    def stop(self):
        self.c.loop_stop()
        self.c.disconnect()


@pytest.fixture()
def rig(api, admin_headers):
    """(edge dict, FakeEdge, camera id) on a throw-away edge."""
    r = api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges", headers=admin_headers,
                 json={"name": f"cam-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    e, secret = r.json()["edge"], r.json()["secret"]
    fe = None

    def up():
        nonlocal fe
        try:
            cand = FakeEdge(e["id"], e["mqtt_username"], secret)
            cand.wait_ready()
        except Exception:
            return False
        fe = cand
        return True
    try:
        wait_until(up, 30, desc="edge credential connects")
        c = api.post(f"/api/v1/orgs/{ORG_ID}/edges/{e['id']}/cameras", headers=admin_headers,
                     json={"name": "cam", "kind": "rtsp", "rtsp_url": "rtsp://10.1.1.1/s"})
        assert c.status_code == 201, c.text
        yield e, fe, c.json()["camera"]["id"]
    finally:
        if fe:
            fe.stop()
        api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges/{e['id']}/disable", headers=admin_headers)


def _snapshot_is(api, headers, cam, data):
    r = api.get(f"/api/v1/orgs/{ORG_ID}/cameras/{cam}/snapshot", headers=headers)
    return r.status_code == 200 and r.content == data


def test_stream_yields_published_frame(api, admin_headers, rig):
    e, fe, cam = rig
    wait_until(lambda: (fe.frame(cam), _snapshot_is(api, admin_headers, cam, JPEG))[1], 15,
               desc="frame reaches the relay")
    url = api.post(f"/api/v1/orgs/{ORG_ID}/cameras/{cam}/stream-url", headers=admin_headers).json()["url"]
    with api.stream("GET", url) as r:
        assert r.status_code == 200 and "multipart/x-mixed-replace" in r.headers["content-type"]
        buf = b""
        for chunk in r.iter_bytes():
            buf += chunk
            if JPEG in buf:
                break
    assert b"Content-Type: image/jpeg" in buf and JPEG in buf


def test_forged_and_expired_sig_401(api, admin_headers, rig):
    e, fe, cam = rig
    exp = int(time.time()) + 60
    assert api.get(f"/api/v1/orgs/{ORG_ID}/cameras/{cam}/stream",
                   params={"exp": exp, "sig": "0" * 64}).status_code == 401
    assert api.get(f"/api/v1/orgs/{ORG_ID}/cameras/{cam}/stream",
                   params={"exp": int(time.time()) - 5, "sig": "0" * 64}).status_code == 401


def test_other_org_gets_404_for_stream_url(api, viewer_headers, rig):
    e, fe, cam = rig
    assert api.post(f"/api/v1/orgs/{uuid.uuid4()}/cameras/{cam}/stream-url", headers=viewer_headers).status_code == 404
    assert api.post(f"/api/v1/orgs/{ORG_ID}/cameras/{uuid.uuid4()}/stream-url", headers=viewer_headers).status_code == 404


def test_frame_for_foreign_camera_is_ignored(api, admin_headers, rig):
    e, fe, cam = rig
    ghost = uuid.uuid4()
    fe.frame(ghost)
    time.sleep(1.5)
    r = api.get(f"/api/v1/orgs/{ORG_ID}/cameras/{ghost}/snapshot", headers=admin_headers)
    assert r.status_code == 404


def test_stat_updates_camera_status(api, admin_headers, rig):
    e, fe, cam = rig

    def status():
        items = api.get(f"/api/v1/orgs/{ORG_ID}/edges/{e['id']}/cameras", headers=admin_headers).json()["items"]
        return next(c for c in items if c["id"] == cam)
    fe.stat({cam: {"status": "error", "detail": "cannot open stream at 10.1.1.1:554", "fps": 0}})
    wait_until(lambda: (fe.stat({cam: {"status": "error", "detail": "cannot open stream at 10.1.1.1:554", "fps": 0}}),
                        status()["status"] == "error")[1], 20, desc="status written")
    assert "10.1.1.1" in status()["status_detail"]
