"""MQTT security integration tests — doc 17 binding contract (v4 T6).

These exercise the BROKER, not the app: dynsec ACLs must deny cross-org /
cross-edge publication, v1 topics, wildcard subscriptions and $CONTROL
before a byte reaches the backend. The provisioning lifecycle (provision /
rotate / disable) is driven through the REST API exactly like an operator.

Connects over TLS :8883 as the real dynsec identities — edge creds come
from infra/secrets/* (file-mounted secrets, never env), the fault-injection
`tester` exists only under the test compose overlay.
"""

import json
import os
import queue
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.integration

from conftest import (  # noqa: E402
    EDGE_UUID, MQTT_CA_FILE, MQTT_HOST, MQTT_PORT, ORG_ID, REPO, SITE_ID,
    V2_PREFIX, admin_headers, mqtt_connect, wait_until, _secret,
)

OTHER_ORG = "0199d000-0000-7000-8000-00000000ffff"
OTHER_EDGE = "0199d000-0000-7000-8000-00000000dddd"
OTHER_SITE = "0199d000-0000-7000-8000-00000000eeee"

EDGE_USER = _secret("edge_bootstrap_user")
EDGE_PW = _secret("edge_bootstrap_pw")


def _iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _v5_client(username=None, password=None, client_id=None):
    import paho.mqtt.client as mqtt
    return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                       client_id=client_id or f"pytest-{uuid.uuid4().hex[:8]}",
                       protocol=mqtt.MQTTv5)


class Probe:
    """MQTTv5 client that records CONNACK / PUBACK / SUBACK outcomes — the
    broker's ACL verdicts are only visible at the protocol layer."""

    def __init__(self, username, password):
        self.connack = queue.Queue()
        self.puback = queue.Queue()
        self.suback = queue.Queue()
        self.disconnected = queue.Queue()
        self.client = _v5_client(username, password)
        c = self.client
        c.username_pw_set(username, password)
        c.tls_set(ca_certs=MQTT_CA_FILE)
        c.on_connect = lambda *a: self.connack.put(a[3])
        c.on_disconnect = lambda *a: self.disconnected.put(a[3])
        c.on_publish = lambda *a: self.puback.put(
            _first_reason(a[3]))            # reason_code(s)
        c.on_subscribe = lambda *a: self.suback.put(_first_reason(a[3]))
        c.connect(MQTT_HOST, MQTT_PORT, keepalive=15)
        c.loop_start()

    def pub_rc(self, topic, payload="{}", timeout=8):
        self.client.publish(topic, payload, qos=1)
        return self.puback.get(timeout=timeout)

    def sub_rc(self, topic, timeout=8):
        self.client.subscribe(topic, qos=1)
        return self.suback.get(timeout=timeout)

    def ok(self):
        rc = self.connack.get(timeout=10)
        assert not rc.is_failure, f"CONNACK refused: {rc}"
        return self

    def refused(self):
        rc = self.connack.get(timeout=10)
        assert rc.is_failure, "expected CONNACK refusal, got connected"
        return self

    def stop(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass


def _first_reason(rcs):
    """paho v2 gives ReasonCode or list[ReasonCode] depending on version."""
    if isinstance(rcs, (list, tuple)):
        return rcs[0] if rcs else None
    return rcs


def _rc_value(rc) -> int:
    """Numeric reason code — paho ReasonCode .value; SUBACK may give int."""
    return int(getattr(rc, "value", rc or 0))


def _denied(rc) -> bool:
    return _rc_value(rc) >= 128


def _edge_probe() -> Probe:
    if not EDGE_USER or not EDGE_PW:
        pytest.skip("edge bootstrap secret missing — run `make secrets`")
    return Probe(EDGE_USER, EDGE_PW)


def _needs_broker():
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set")
    if not os.path.exists(MQTT_CA_FILE):
        pytest.skip(f"CA file missing ({MQTT_CA_FILE}) — run `make certs`")


# ===================================================== broker ACL isolation

def test_edge_cannot_publish_cross_org_telemetry():
    """Doc 17 §3: an edge client's ACL is prefix-pinned — a valid v2 topic
    under ANOTHER org must be refused at the broker, not dropped by the app."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        rc = p.pub_rc(
            f"v2/{OTHER_ORG}/{SITE_ID}/{EDGE_UUID}/tele/sort/line1/conv1/temp_c",
            json.dumps({"v": 1.0, "q": "good", "ts": _iso()}))
        assert _denied(rc), f"cross-org publish was allowed (rc={rc})"
    finally:
        p.stop()


def test_edge_cannot_publish_other_edge():
    """Cross-edge publication on hb / tele / cmd-resp is denied — this is
    the spoofing case the v1 shared-credential world could not stop."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        for kind, payload in (
            ("hb", {"status": "up"}),
            ("tele/sort/line1/conv1/temp_c", {"v": 9.9, "q": "good", "ts": _iso()}),
            ("cmd-resp/x", {"command_id": "x", "status": "acknowledged"}),
        ):
            rc = p.pub_rc(
                f"v2/{ORG_ID}/{SITE_ID}/{OTHER_EDGE}/{kind}",
                json.dumps(payload))
            assert _denied(rc), f"cross-edge {kind} allowed (rc={rc})"
    finally:
        p.stop()


def test_edge_cannot_subscribe_broad_wildcard():
    """An edge must never fan in other edges' traffic."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        for sub in ("v2/#", "v2/+/+/+/tele/#", "v2/+/+/+/hb", "#"):
            rc = p.sub_rc(sub)
            assert _denied(rc), f"subscription {sub} allowed (rc={rc})"
    finally:
        p.stop()


def test_edge_cannot_publish_commands():
    """cmd/{id} is subscribe-only for the edge — an edge (or a stolen edge
    credential) must not be able to inject commands at the broker."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        rc = p.pub_rc(
            f"{V2_PREFIX}/cmd/{uuid.uuid4()}",
            json.dumps({"command_id": "x", "tag_path": "a/b/c/d", "value": 1,
                        "issued_at": _iso(), "ttl_s": 5,
                        "idempotency_key": "k", "user": "evil"}))
        assert _denied(rc), f"edge published a command (rc={rc})"
    finally:
        p.stop()


def test_edge_cannot_touch_control_plane():
    """$CONTROL/dynamic-security is svc-dynsec-admin only."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        rc = p.sub_rc("$CONTROL/dynamic-security/v1")
        assert _denied(rc), f"edge subscribed $CONTROL (rc={rc})"
        rc = p.pub_rc("$CONTROL/dynamic-security/v1", "{}")
        assert _denied(rc), f"edge published $CONTROL (rc={rc})"
    finally:
        p.stop()


def test_edge_own_prefix_still_works():
    """Sanity: the same client CAN publish its own tele/hb/cmd-resp."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        for kind, payload in (
            ("tele/sort/line1/conv1/temp_c", {"v": 1.1, "q": "good", "ts": _iso()}),
            ("hb", {"status": "up", "ts": _iso()}),
            ("cmd-resp/x", {"command_id": "x", "status": "rejected",
                            "reason": "ttl_expired"}),
        ):
            rc = p.pub_rc(f"{V2_PREFIX}/{kind}", json.dumps(payload))
            assert not _denied(rc), f"own-prefix {kind} denied (rc={rc})"
    finally:
        p.stop()


def test_v1_topic_rejected_for_everyone():
    """The plant1/... namespace must not exist at the broker — neither an
    edge nor the (wide) tester identity may publish on v1 topics."""
    _needs_broker()
    p = _edge_probe().ok()
    try:
        rc = p.pub_rc("plant1/sort/line1/conv1/temp_c",
                      json.dumps({"v": 1.0, "q": "good", "ts": _iso()}))
        assert _denied(rc), f"edge published v1 topic (rc={rc})"
    finally:
        p.stop()
    if not _secret("tester_pw"):
        pytest.skip("tester secret missing (test overlay)")
    t = Probe("tester", _secret("tester_pw")).ok()
    try:
        rc = t.pub_rc("plant1/edge/edge1/heartbeat", json.dumps({"status": "up"}))
        assert _denied(rc), f"tester published v1 topic (rc={rc})"
    finally:
        t.stop()


# ===================================================== provisioning lifecycle

def _edges(api, headers):
    r = api.get(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_edge_lifecycle_provision_rotate_disable(api, admin_headers):
    """End-to-end doc 17 §5: provision returns the secret ONCE, the new
    client works, rotation moves to v{n+1} and disables the old version,
    disable kills live connections and refuses new ones."""
    _needs_broker()
    name = f"qa-{uuid.uuid4().hex[:8]}"
    r = api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges",
                 headers=admin_headers, json={"name": name})
    assert r.status_code == 201, r.text
    edge, secret = r.json()["edge"], r.json()["secret"]
    eid = edge["id"]
    u1 = edge["mqtt_username"]
    try:
        assert u1 == f"edge-{eid}-v1"
        assert secret

        # v1 credential works
        p = Probe(u1, secret).ok()
        p.stop()

        # rotate -> v2 secret; old creds keep a grace window
        r = api.post(
            f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges/{eid}/rotate",
            headers=admin_headers)
        assert r.status_code == 200, r.text
        u2, secret2 = r.json()["mqtt_username"], r.json()["secret"]
        assert u2 == f"edge-{eid}-v2" and secret2 != secret

        # v2 connects; once it does, the reconciler retires v1 (cut-over)
        p = Probe(u2, secret2).ok()
        p.stop()
        time.sleep(2)  # let the reconcile tick see the v2 connection

        def old_disabled():
            try:
                Probe(u1, secret).refused()
                return True
            except Exception:
                return False
        # cut-over happens on the next reconcile pass (NOTIFY wakes it)
        wait_until(old_disabled, 40, desc="v1 credential disabled after cut-over")
    finally:
        # disable: live connections kicked, reconnects refused, never re-enabled
        r = api.post(
            f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges/{eid}/disable",
            headers=admin_headers)
        assert r.status_code == 200, r.text
    time.sleep(2)
    Probe(u2, secret2).refused()


def test_edge_provision_requires_admin(api, operator_headers, viewer_headers):
    url = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges"
    r = api.post(url, headers=viewer_headers, json={"name": "x"})
    assert r.status_code == 403
    r = api.post(url, headers=operator_headers, json={"name": "x"})
    assert r.status_code == 403


def test_edge_secret_stored_as_fingerprint_only(api, admin_headers):
    """The API returns the secret once; anything persisted is a fingerprint.
    Spot-check via the list endpoint — no field may echo the secret."""
    _needs_broker()
    r = api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges",
                 headers=admin_headers, json={"name": f"fp-{uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    eid = r.json()["edge"]["id"]
    try:
        items = _edges(api, admin_headers)
        row = next(e for e in items if e["id"] == eid)
        assert "secret" not in row
        assert r.json()["secret"] not in json.dumps(items)
    finally:
        api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges/{eid}/disable",
                 headers=admin_headers)


def test_wrong_org_is_404(api, admin_headers):
    """A member of org A poking org B's edge routes sees 404, not 403."""
    r = api.get(f"/api/v1/orgs/{OTHER_ORG}/sites/{SITE_ID}/edges",
                headers=admin_headers)
    assert r.status_code == 404


# ===================================================== backend trust rules

def test_trust_layer_topic_identity_mismatch(mqtt_client, api):
    """Doc 17 §4: a message on a structurally-valid v2 topic whose edge
    doesn't exist (or whose org/site don't match the edge row) is dropped
    and counted as mqtt_topic_identity_mismatch — never parsed."""
    def counter():
        r = api.get("/api/system/health")
        return r.json().get("backend", {}).get("mqtt_topic_identity_mismatch", -1)
    before = counter()
    assert before >= 0, "counter not exposed in /api/system/health"
    mqtt_client.publish(
        f"v2/{ORG_ID}/{SITE_ID}/{OTHER_EDGE}/tele/sort/line1/conv1/temp_c",
        json.dumps({"v": 42.0, "q": "good", "ts": _iso()}), qos=1)
    mqtt_client.publish(
        f"v2/{OTHER_ORG}/{SITE_ID}/{EDGE_UUID}/tele/sort/line1/conv1/temp_c",
        json.dumps({"v": 42.0, "q": "good", "ts": _iso()}), qos=1)
    wait_until(lambda: counter() >= before + 2, 15,
               desc="mqtt_topic_identity_mismatch +2")


# ===================================================== reconciler behaviour

def _dynsec_call(*commands, timeout=10):
    """Issue a dynsec admin request as svc-dynsec-admin (host-side)."""
    import paho.mqtt.client as mqtt
    from paho.mqtt.packettypes import PacketTypes
    from paho.mqtt.properties import Properties

    pw = _secret("svc_dynsec_admin_pw")
    if not pw:
        pytest.skip("svc_dynsec_admin_pw secret missing")
    got = queue.Queue()
    corr = os.urandom(16)
    c = _v5_client()
    c.username_pw_set("svc-dynsec-admin", pw)
    c.tls_set(ca_certs=MQTT_CA_FILE)
    c.connect(MQTT_HOST, MQTT_PORT, keepalive=15)
    c.subscribe("$CONTROL/dynamic-security/v1/response", qos=1)
    c.on_message = lambda *a: got.put(json.loads(a[2].payload))
    c.loop_start()
    try:
        props = Properties(PacketTypes.PUBLISH)
        props.ResponseTopic = "$CONTROL/dynamic-security/v1/response"
        props.CorrelationData = corr
        c.publish("$CONTROL/dynamic-security/v1",
                  json.dumps({"commands": list(commands)}),
                  qos=1, properties=props)
        body = got.get(timeout=timeout)
        return body["responses"]
    finally:
        c.loop_stop()
        c.disconnect()


def test_reconciler_repairs_deleted_and_orphaned_clients():
    """Doc 17 §6: deleting a DB-managed client is repaired by recreate;
    an edge-* client the DB doesn't know gets DISABLED (not deleted —
    the disable is observable evidence)."""
    _needs_broker()
    if not EDGE_USER:
        pytest.skip("edge bootstrap secret missing")
    # orphan: fabricate a client the DB never heard of
    orphan = f"edge-{uuid.uuid4()}-v9"
    res = _dynsec_call(
        {"command": "createClient", "username": orphan, "password": "x" * 20})
    assert not res[0].get("error"), res

    # delete a DB-managed client — the reconciler must restore it
    res = _dynsec_call({"command": "deleteClient", "username": EDGE_USER})
    assert not res[0].get("error"), res

    time.sleep(1)
    # the orphan gets disabled on the next reconcile pass
    def orphan_disabled():
        res = _dynsec_call({"command": "getClient", "username": orphan})
        data = res[0].get("data") or {}
        return bool((data.get("client") or {}).get("disabled"))
    wait_until(orphan_disabled, 45, desc="orphan client disabled by reconciler")

    # and the real edge is back (bootstrap-secret fast path)
    def edge_back():
        try:
            _edge_probe().ok().stop()
            return True
        except Exception:
            return False
    wait_until(edge_back, 45, desc="edge client recreated by reconciler")


# ===================================================== hygiene

def test_healthcheck_credentials_not_in_docker_inspect():
    """Secrets must not be visible via `docker inspect` — env vars and the
    healthcheck command may only reference files, not literal passwords."""
    if shutil.which("docker") is None:
        pytest.skip("docker not available")
    out = subprocess.run(
        ["docker", "compose", "-f", str(REPO / "docker-compose.yml"),
         "-f", str(REPO / "docker-compose.test.yml"),
         "ps", "-q", "mosquitto"],
        capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        pytest.skip("mosquitto container not running")
    cid = out.stdout.strip().splitlines()[0]
    inspect = subprocess.run(["docker", "inspect", cid],
                             capture_output=True, text=True).stdout
    for secret_name in ("svc_dynsec_admin_pw", "svc_backend_pw",
                        "edge_bootstrap_pw", "tester_pw"):
        value = _secret(secret_name)
        if value:
            assert value not in inspect, \
                f"{secret_name} value visible in docker inspect"
