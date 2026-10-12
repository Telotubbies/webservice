"""Alarm pipeline integration test — CONTRACT.md: seed rule conv1.temp_c > 80.

Flow: start motor → sim temp drifts up → alarm fires → ack → state=acked.
Marked slow: temp drift takes sim time.
"""

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.slow]

from conftest import TAGS, wait_until  # noqa: E402


@pytest.fixture()
def motor_on(api, operator_headers):
    # Other tests mutate speed_sp (burst test leaves it at an arbitrary value),
    # so pin it explicitly: 58 Hz -> temp target well past the 80 degC rule.
    r = api.post("/api/commands", headers=operator_headers,
                 json={"tag": TAGS["speed_sp"], "value": 58.0,
                       "idempotency_key": f"alarm-sp-{uuid.uuid4()}", "ttl_s": 20})
    assert r.status_code == 201, r.text
    r = api.post("/api/commands", headers=operator_headers,
                 json={"tag": TAGS["running"], "value": True,
                       "idempotency_key": f"alarm-{uuid.uuid4()}", "ttl_s": 20})
    assert r.status_code == 201, r.text
    yield
    api.post("/api/commands", headers=operator_headers,
             json={"tag": TAGS["running"], "value": False,
                   "idempotency_key": f"alarm-off-{uuid.uuid4()}", "ttl_s": 20})


def test_alarm_fires_above_80_and_ack_works(api, operator_headers, motor_on):
    # 1. wait for temp to actually cross the threshold
    def temp_above():
        r = api.get(f"/api/tags/{TAGS['temp_c']}/latest")
        if r.status_code != 200:
            return None
        return r.json()["v"] if r.json()["v"] > 80 else None

    temp = wait_until(temp_above, 240, interval_s=2,
                      desc="conv1.temp_c > 80 (sim drift)")
    assert temp > 80

    # 2. alarm must appear as active
    def alarm_active():
        r = api.get("/api/alarms")
        if r.status_code != 200:
            return None
        for a in r.json():
            if a.get("tag") == TAGS["temp_c"] and a.get("state") == "active":
                return a
        return None

    alarm = wait_until(alarm_active, 30, desc="active critical alarm")
    assert alarm["severity"] == "critical"

    # 3. viewer cannot ack
    r = api.post(f"/api/alarms/{alarm['id']}/ack",
                 headers={"Authorization": "Bearer demo-viewer"})
    assert r.status_code == 403

    # 4. anonymous cannot ack
    assert api.post(f"/api/alarms/{alarm['id']}/ack").status_code == 401

    # 5. operator acks → state flips to acked
    r = api.post(f"/api/alarms/{alarm['id']}/ack", headers=operator_headers)
    assert r.status_code == 200
    wait_until(
        lambda: any(
            a.get("id") == alarm["id"] and a.get("state") == "acked"
            for a in api.get("/api/alarms").json()
        ) or None,
        15,
        desc="alarm state=acked",
    )
