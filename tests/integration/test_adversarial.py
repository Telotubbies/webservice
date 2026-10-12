"""Adversarial integration tests — implements ATTACK_PLAN items against a live
system. Needs BASE_URL for REST attacks and/or MQTT_HOST for broker attacks.
"""

import json
import queue
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.integration

from conftest import EDGE_ID, SITE, TAGS, wait_until  # noqa: E402


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _cmd_payload(req_id, tag, value, ttl_s=30, issued_at=None, idem=None):
    return {
        "command_id": f"cmd-{req_id}",
        "tag": tag,
        "value": value,
        "issued_at": _iso(issued_at or datetime.now(timezone.utc)),
        "ttl_s": ttl_s,
        "idempotency_key": idem or f"idem-{req_id}",
        "user": "qa-adversarial",
    }


class RespCollector:
    """Subscribes to cmd-resp/# and collects matching responses."""

    def __init__(self, client):
        self.client = client
        self.responses: queue.Queue = queue.Queue()

    def __enter__(self):
        def on_message(client, userdata, msg):
            try:
                body = json.loads(msg.payload)
            except Exception:
                body = {"_raw": msg.payload.decode(errors="replace")}
            body["_topic"] = msg.topic
            self.responses.put(body)

        self.client.on_message = on_message
        self.client.subscribe(f"{SITE}/cmd-resp/{EDGE_ID}/#", qos=1)
        return self

    def __exit__(self, *exc):
        self.client.on_message = None

    def wait_for(self, req_id, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                body = self.responses.get(
                    timeout=max(0.05, deadline - time.monotonic())
                )
            except queue.Empty:
                break
            if body.get("_topic", "").endswith(req_id):
                return body
        raise AssertionError(f"no cmd-resp for {req_id} within {timeout}s")


# =========================================================== REST attacks

def test_concurrent_same_tag_post_one_409(api, operator_headers):
    """09 §6.6: two clients POST to the same tag concurrently → one 201, one
    409 with active_command_id. No double-write allowed."""
    body = {"tag": TAGS["speed_sp"], "value": 25.0, "ttl_s": 30}

    def exchange():
        barrier = threading.Barrier(2)
        results = []

        def post():
            barrier.wait()
            results.append(api.post("/api/commands",
                                    headers=operator_headers, json=body))

        t1, t2 = threading.Thread(target=post), threading.Thread(target=post)
        t1.start(); t2.start(); t1.join(); t2.join()
        return results

    results = exchange()
    # v4 T4: a 429 loser just means the per-tag bucket was still draining from
    # a prior suite's commands — wait out the window and rerun the exchange
    if any(r.status_code == 429 for r in results):
        ra = max(int(r.headers.get("retry-after", "5"))
                 for r in results if r.status_code == 429)
        time.sleep(min(ra + 2, 15))
        results = exchange()

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], f"expected one 201 + one 409, got {codes}"
    win = next(r for r in results if r.status_code == 201).json()["command_id"]
    conflict = next(r for r in results if r.status_code == 409).json()
    assert conflict["active_command_id"] == win


def test_idempotent_replay_after_409(api, operator_headers):
    """09 §6.6: dedup must run before the conflict check — resending the same
    idempotency_key while another command is in-flight replays (200), not 409."""
    key = f"replay-{uuid.uuid4()}"
    tag = TAGS["running"]
    r1 = api.post("/api/commands", headers=operator_headers,
                  json={"tag": tag, "value": True, "idempotency_key": key, "ttl_s": 30})
    assert r1.status_code == 201
    id1 = r1.json()["command_id"]

    # different key, same tag → should 409 while first is in-flight
    r2 = api.post("/api/commands", headers=operator_headers,
                  json={"tag": tag, "value": False,
                        "idempotency_key": f"other-{uuid.uuid4()}", "ttl_s": 30})
    # (may be 201 if r1 already finished — race is fine, key assertion is r3)
    if r2.status_code == 409:
        assert r2.json()["active_command_id"] == id1

    # same key replay must return the original command, never 409
    r3 = api.post("/api/commands", headers=operator_headers,
                  json={"tag": tag, "value": True, "idempotency_key": key, "ttl_s": 30})
    assert r3.status_code == 200
    assert r3.json()["command_id"] == id1


def test_command_burst_no_5xx(api, operator_headers):
    """Rapid-fire 20 commands across both writable tags. Contract does not
    define a rate limit (06 §6 mentions 30/min — DIVERGENCE, not enforced in
    the demo contract) — accept 201/409/429 but never 5xx."""
    codes = []
    for i in range(20):
        tag = TAGS["speed_sp"] if i % 2 else TAGS["running"]
        r = api.post("/api/commands", headers=operator_headers,
                     json={"tag": tag, "value": 10.0 + i if i % 2 else bool(i % 2),
                           "idempotency_key": f"burst-{uuid.uuid4()}", "ttl_s": 30})
        codes.append(r.status_code)
    assert all(c in (201, 409, 429) for c in codes), codes


def test_sqlish_tag_name_no_500(api, operator_headers):
    """ATTACK_PLAN: `a.b'; DROP TABLE--` must be a clean 4xx, never a 500."""
    for evil in ("a.b'; DROP TABLE--", "plant1.sort.line1.conv1.' OR 1=1--",
                 "plant1.sort.line1.conv1.temp_c;DELETE FROM telemetry"):
        r = api.post("/api/commands", headers=operator_headers,
                     json={"tag": evil, "value": 1})
        assert r.status_code in (400, 404, 422), (evil, r.status_code)
        r = api.get(f"/api/tags/{evil}/latest")
        assert r.status_code in (400, 404, 422), (evil, r.status_code)
    assert api.get("/api/health").json()["status"] == "ok"


def test_oversized_payload_rejected(api, operator_headers):
    big = {"tag": TAGS["running"], "value": True,
           "idempotency_key": "x" * (1024 * 1024)}
    r = api.post("/api/commands", headers=operator_headers, json=big)
    assert r.status_code in (400, 404, 413, 422), r.status_code


def test_malformed_json_body(api, operator_headers):
    r = api.post("/api/commands", headers=operator_headers,
                 content=b'{"tag": "x",,}',  # noqa: S608 — intentionally malformed
                 )
    assert r.status_code in (400, 415, 422), r.status_code


# =========================================================== MQTT attacks

def test_edge_ttl_expired_command_denied(mqtt_client):
    """09 §6.6 test_command_ttl_expired_edge: cmd with stale issued_at must be
    dropped and denied (ttl_expired) — never executed."""
    req_id = f"ttl-{uuid.uuid4()}"
    payload = _cmd_payload(req_id, TAGS["running"], True, ttl_s=5,
                           issued_at=datetime.now(timezone.utc) - timedelta(seconds=60))
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)  # let subscription land
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}",
                            json.dumps(payload), qos=1)
        body = resp.wait_for(req_id, timeout=10)
    assert body["status"] == "denied"
    assert "ttl_expired" in str(body.get("detail", ""))


def test_edge_nonwritable_tag_denied(mqtt_client):
    req_id = f"nw-{uuid.uuid4()}"
    payload = _cmd_payload(req_id, TAGS["temp_c"], 99.0)
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}",
                            json.dumps(payload), qos=1)
        body = resp.wait_for(req_id, timeout=10)
    assert body["status"] == "denied"
    assert "not_writable" in str(body.get("detail", ""))


def test_edge_out_of_range_denied(mqtt_client):
    req_id = f"oor-{uuid.uuid4()}"
    payload = _cmd_payload(req_id, TAGS["speed_sp"], 9999.0)
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}",
                            json.dumps(payload), qos=1)
        body = resp.wait_for(req_id, timeout=10)
    assert body["status"] == "denied"
    assert "out_of_range" in str(body.get("detail", ""))


def test_edge_duplicate_req_id_no_double_apply(mqtt_client):
    """ATTACK_PLAN: replay the same req_id + idempotency_key — edge keeps the
    last N keys (04 §5) and must return the same result, not re-write."""
    req_id = f"dup-{uuid.uuid4()}"
    payload = json.dumps(_cmd_payload(req_id, TAGS["speed_sp"], 42.0))
    topic = f"{SITE}/cmd/{EDGE_ID}/{req_id}"
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)
        mqtt_client.publish(topic, payload, qos=1)
        mqtt_client.publish(topic, payload, qos=1)
        r1 = resp.wait_for(req_id, timeout=10)
        r2 = resp.wait_for(req_id, timeout=10)
    assert r1["status"] == r2["status"] == "done"
    assert r1.get("command_id") == r2.get("command_id")


def test_edge_malformed_cmd_payload_ignored(mqtt_client, api):
    """ATTACK_PLAN: garbage on cmd topic must not crash the edge."""
    req_id = f"bad-{uuid.uuid4()}"
    for junk in (b"not json at all", b'{"tag": 5, "value":', b"{}"):
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}", junk, qos=1)
    time.sleep(1)
    # edge still alive: it should still answer a well-formed command
    good_id = f"ok-{uuid.uuid4()}"
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{good_id}",
                            json.dumps(_cmd_payload(good_id, TAGS["running"], True)),
                            qos=1)
        assert resp.wait_for(good_id, timeout=10)["status"] == "done"


def test_backend_unknown_telemetry_tag_dropped(mqtt_client, api):
    """05 §1 governance + 09 §6.5: telemetry on an unregistered tag must be
    dropped (metric telemetry_unknown_tag), never stored."""
    ghost = f"{SITE}/sort/line1/ghost{uuid.uuid4().hex[:6]}/sig"
    mqtt_client.publish(ghost, json.dumps(
        {"v": 1.0, "q": "good",
         "ts": _iso(datetime.now(timezone.utc))}), qos=1)
    time.sleep(2)
    r = api.get(f"/api/tags/{ghost.replace('/', '.')}/latest")
    assert r.status_code == 404
    assert api.get("/api/health").json()["status"] == "ok"


def test_backend_malformed_telemetry_ignored(mqtt_client, api):
    """Garbage payloads on valid telemetry topics must not wedge ingest."""
    topic = f"{SITE}/sort/line1/conv1/temp_c"
    for junk in (b'\x00\xff garbage', b'{"v":', b"[1,2,3]",
                 json.dumps({"v": "hot", "q": "good",
                             "ts": _iso(datetime.now(timezone.utc))})):
        mqtt_client.publish(topic, junk if isinstance(junk, bytes) else junk.encode(),
                            qos=1)
    time.sleep(1)
    assert api.get("/api/health").json()["status"] == "ok"


def test_telemetry_qos1_duplicate_tolerated(mqtt_client, api):
    """QoS1 duplicates are legal on the wire — dedupe key (tag, ts)."""
    ts = _iso(datetime.now(timezone.utc))
    topic = f"{SITE}/sort/line1/motor1/speed_sp"
    payload = json.dumps({"v": 7.7, "q": "good", "ts": ts})
    mqtt_client.publish(topic, payload, qos=1)
    mqtt_client.publish(topic, payload, qos=1)
    time.sleep(1.5)
    assert api.get("/api/health").json()["status"] == "ok"


def test_heartbeat_present_and_shaped(mqtt_client):
    """Edge must heartbeat every ~5s on {site}/edge/{edge}/heartbeat."""
    got = queue.Queue()

    def on_message(client, userdata, msg):
        got.put(msg.payload)

    mqtt_client.on_message = on_message
    mqtt_client.subscribe(f"{SITE}/edge/{EDGE_ID}/heartbeat", qos=1)
    try:
        payload = got.get(timeout=15)
    except queue.Empty:
        pytest.fail("no heartbeat within 15s (contract: every 5s)")
    body = json.loads(payload)
    assert body["status"] == "up"
    assert isinstance(body["clock_ok"], bool)
    assert body["adapter"] == "sim"


def test_clock_skew_commands_denied(mqtt_client):
    """ATTACK_PLAN clock skew: with EDGE_CLOCK_SKEW_MS>500 the heartbeat shows
    clock_ok=false and commands → denied/clock_untrusted. Needs the compose
    stack started with a skewed EDGE_CLOCK_SKEW_MS — auto-skips otherwise."""
    got = queue.Queue()
    mqtt_client.on_message = lambda c, u, m: got.put(json.loads(m.payload))
    mqtt_client.subscribe(f"{SITE}/edge/{EDGE_ID}/heartbeat", qos=1)
    try:
        hb = got.get(timeout=15)
    except queue.Empty:
        pytest.fail("no heartbeat within 15s")
    if hb.get("clock_ok") is not False:
        pytest.skip("edge clock is trusted; rerun compose with "
                    "EDGE_CLOCK_SKEW_MS>500 to exercise clock_untrusted")
    req_id = f"skew-{uuid.uuid4()}"
    with RespCollector(mqtt_client) as resp:
        time.sleep(0.5)
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}",
                            json.dumps(_cmd_payload(req_id, TAGS["running"], True)),
                            qos=1)
        body = resp.wait_for(req_id, timeout=10)
    assert body["status"] == "denied"
    assert "clock_untrusted" in str(body.get("detail", ""))


# -------------------------------------------------- disruptive (opt-in)

@pytest.mark.disruptive
def test_command_timeout_edge_offline(api, operator_headers, disruptive, compose_file):
    """Backend must mark a command 'timeout' when no cmd-resp arrives in ttl_s.
    Stops edge-bridge via compose — DISRUPTIVE=1 + docker required."""
    import subprocess

    def compose(*args):
        subprocess.run(["docker", "compose", "-f", compose_file, *args],
                       check=True, capture_output=True)

    compose("stop", "edge-bridge")
    try:
        r = api.post("/api/commands", headers=operator_headers,
                     json={"tag": TAGS["running"], "value": True, "ttl_s": 3})
        assert r.status_code == 201
        command_id = r.json()["command_id"]

        def poll():
            b = api.get(f"/api/commands/{command_id}",
                        headers=operator_headers)
            return b.json() if b.status_code == 200 and \
                b.json()["status"] == "timeout" else None
        wait_until(poll, 30, desc="command timeout")
    finally:
        compose("start", "edge-bridge")


@pytest.mark.disruptive
def test_retained_command_denied_on_edge_restart(
        api, operator_headers, mqtt_client, disruptive, compose_file):
    """Retained-command replay exploit: a command published with retain=True
    while the edge is offline is replayed by the broker on resubscribe. The
    edge must answer denied/retained_command and must NOT execute the write —
    a retained message is stale operator intent, not a live command.
    DISRUPTIVE=1 + docker required."""
    import subprocess

    def compose(*args):
        subprocess.run(["docker", "compose", "-f", compose_file, *args],
                       check=True, capture_output=True)

    req_id = f"retained-{uuid.uuid4()}"
    compose("stop", "edge-bridge")
    try:
        # Broker stores this under the topic and replays it (retain flag set)
        # to the next subscriber — i.e. the edge when it comes back.
        mqtt_client.publish(
            f"{SITE}/cmd/{EDGE_ID}/{req_id}",
            json.dumps(_cmd_payload(req_id, TAGS["running"], True)),
            qos=1, retain=True)
        time.sleep(1)

        with RespCollector(mqtt_client) as resp:
            compose("start", "edge-bridge")
            body = resp.wait_for(req_id, timeout=45)
        assert body["status"] == "denied"
        assert "retained_command" in str(body.get("detail", ""))

        # Prove no write reached the sim: once fresh telemetry resumes the
        # tag must not carry the commanded value.
        def fresh_running():
            r = api.get(f"/api/tags/{TAGS['running']}/latest")
            if r.status_code != 200:
                return None
            j = r.json()
            return j if j["q"] == "good" else None
        rec = wait_until(fresh_running, 30, desc="fresh running telemetry")
        assert rec["v"] is not True, \
            "retained command was executed after restart"
    finally:
        # Clear the retained slot so future edge restarts don't replay it.
        mqtt_client.publish(f"{SITE}/cmd/{EDGE_ID}/{req_id}",
                            "", qos=1, retain=True)
        compose("start", "edge-bridge")


@pytest.mark.disruptive
def test_alarm_survives_bad_quality_telemetry(
        api, operator_headers, mqtt_client, disruptive, compose_file):
    """Fail-safe alarm semantics: telemetry with q!=good must neither raise
    nor clear an alarm — a comms fault must not silently clear an active
    over-temperature alarm, and must not fabricate one either. Stops the
    edge so injected telemetry is the sole source for the tag.
    DISRUPTIVE=1 + docker required."""
    import subprocess

    def compose(*args):
        subprocess.run(["docker", "compose", "-f", compose_file, *args],
                       check=True, capture_output=True)

    topic = TAGS["temp_c"].replace(".", "/")

    def pub(v, q):
        mqtt_client.publish(topic, json.dumps(
            {"v": v, "q": q,
             "ts": _iso(datetime.now(timezone.utc))}), qos=1)
        time.sleep(0.4)

    def temp_alarm(state):
        r = api.get("/api/alarms")
        if r.status_code != 200:
            return None
        for a in r.json():
            if a.get("tag") == TAGS["temp_c"] and a.get("state") == state:
                return a
        return None

    compose("stop", "edge-bridge")
    try:
        # Precondition: no active alarm on the tag.
        pub(30.0, "good")
        wait_until(lambda: not temp_alarm("active"), 15,
                   desc="no active temp alarm")

        # Bad-quality above-threshold sample must NOT raise an alarm.
        pub(95.0, "bad")
        time.sleep(2)
        assert temp_alarm("active") is None, \
            "q=bad sample raised an alarm"

        # Good-quality above-threshold raises it.
        pub(95.0, "good")
        alarm = wait_until(lambda: temp_alarm("active"), 15,
                           desc="active over-temp alarm")
        assert alarm["severity"] == "critical"

        # Bad-quality below-threshold must NOT clear it — comms loss is
        # not evidence the plant recovered.
        pub(30.0, "bad")
        time.sleep(2)
        assert temp_alarm("active") is not None, \
            "q=bad sample cleared an active critical alarm"

        # Recovery is confirmed only by good-quality data.
        pub(30.0, "good")
        wait_until(lambda: not temp_alarm("active"), 15,
                   desc="alarm cleared on good telemetry")
    finally:
        compose("start", "edge-bridge")
