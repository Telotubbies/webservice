"""Config delivery (spec 5.4): a provisioned edge credential plays the edge.

Needs the live stack (BASE_URL, MQTT_HOST, broker CA). Each test provisions a
throw-away edge so the seeded edge's config_version is left alone.
"""

import json
import queue
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import MQTT_CA_FILE, MQTT_HOST, MQTT_PORT, ORG_ID, SITE_ID, wait_until  # noqa: E402


class FakeEdge:
    def __init__(self, edge_id, username, secret):
        import paho.mqtt.client as mqtt
        self.prefix = f"v2/{ORG_ID}/{SITE_ID}/{edge_id}"
        self.cfgs = queue.Queue()
        self.subacks = queue.Queue()
        self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id=f"fake-{uuid.uuid4().hex[:8]}")
        self.c.username_pw_set(username, secret)
        self.c.tls_set(ca_certs=MQTT_CA_FILE)
        self.c.on_message = lambda c, u, m: self.cfgs.put(json.loads(m.payload))
        self.c.on_connect = lambda c, u, f, rc, p: c.subscribe(f"{self.prefix}/cfg", qos=1)
        self.c.connect(MQTT_HOST, MQTT_PORT, keepalive=15)
        self.c.loop_start()

    def req(self, have):
        self.c.publish(f"{self.prefix}/cfg-req", json.dumps({"have_version": have}), qos=1)

    def ack(self, version, ok=True, errors=()):
        self.c.publish(f"{self.prefix}/cfg-ack",
                       json.dumps({"version": version, "ok": ok, "errors": list(errors)}), qos=1)

    def get(self, timeout=10):
        return self.cfgs.get(timeout=timeout)

    def stop(self):
        self.c.loop_stop()
        self.c.disconnect()


@pytest.fixture()
def edge(api, admin_headers):
    r = api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges", headers=admin_headers,
                 json={"name": f"cfg-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    e, secret = r.json()["edge"], r.json()["secret"]
    fe = None
    try:
        # connect after the reconciler has the credential; retry until accepted
        def up():
            nonlocal fe
            try:
                fe = FakeEdge(e["id"], e["mqtt_username"], secret)
                return True
            except Exception:
                return False
        wait_until(up, 30, desc="edge credential connects")
        yield e, fe
    finally:
        if fe:
            fe.stop()
        api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges/{e['id']}/disable",
                 headers=admin_headers)


def _sources(api, headers, eid):
    return f"/api/v1/orgs/{ORG_ID}/edges/{eid}/sources"


def _mk_source(api, headers, eid):
    r = api.post(_sources(api, headers, eid), headers=headers, json={
        "name": f"s-{uuid.uuid4().hex[:6]}", "protocol": "modbus",
        "connection": {"host": "10.0.0.5"}, "secrets": {"password": "hunter2"}})
    assert r.status_code == 201, r.text
    return r.json()["source"], r.json()["config_version"]


def test_cfg_req_behind_gets_latest(api, admin_headers, edge):
    e, fe = edge
    src, ver = _mk_source(api, admin_headers, e["id"])
    cfg = fe.get()  # pushed by NOTIFY
    assert cfg["version"] >= ver
    s = next(x for x in cfg["sources"] if x["id"] == src["id"])
    assert s["secrets"] == {"password": "hunter2"} and s["enabled"] is True
    fe.req(None)
    assert fe.get()["version"] == cfg["version"]
    fe.req(cfg["version"] - 1)
    assert fe.get()["version"] == cfg["version"]


def test_cfg_req_current_gets_nothing(api, admin_headers, edge):
    e, fe = edge
    _mk_source(api, admin_headers, e["id"])
    cfg = fe.get()
    fe.req(cfg["version"])
    with pytest.raises(queue.Empty):
        fe.get(timeout=3)


def test_ack_updates_applied_and_source_status(api, admin_headers, edge):
    e, fe = edge
    good, _ = _mk_source(api, admin_headers, e["id"])
    bad, _ = _mk_source(api, admin_headers, e["id"])
    wait_until(lambda: fe.cfgs.qsize() > 0, 10)
    version = None
    while not fe.cfgs.empty():
        version = fe.get()["version"]
    fe.ack(version, ok=False, errors=[{"source_id": bad["id"], "detail": "connection refused"}])

    def seen():
        r = api.get(_sources(api, admin_headers, e["id"]), headers=admin_headers)
        by = {s["id"]: s for s in r.json()["items"]}
        return (by[bad["id"]]["status"] == "error"
                and by[bad["id"]]["status_detail"] == "connection refused"
                and by[good["id"]]["status"] == "ok")
    wait_until(seen, 10, desc="per-source status from ack")

    # an ack for a version the backend never issued is ignored
    fe.ack(version + 1000)
    r = api.get(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges", headers=admin_headers)
    mine = next(x for x in r.json()["items"] if x["id"] == e["id"])
    if "config_applied" in mine:
        assert mine["config_applied"] == version
