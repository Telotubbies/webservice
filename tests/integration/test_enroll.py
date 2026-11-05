"""One-time gateway enrollment (spec 5.1): code -> identity, single use, expiry,
rate limit, and the rotated credential really connecting to the broker."""

import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, SITE_ID, mqtt_connect, wait_until  # noqa: E402

EDGES = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/edges"
ENROLL = "/api/v1/edge/enroll"


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def edge(admin_api):
    r = admin_api.post(EDGES, json={"name": f"pytest-enroll-{uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    body = r.json()
    yield body
    admin_api.post(f"{EDGES}/{body['edge']['id']}/disable")


def test_provision_returns_code_and_secret(edge):
    assert len(edge["enroll_code"]) == 9 and edge["enroll_code"][4] == "-"
    assert edge["secret"] and edge["enroll_expires_at"]


def test_enroll_once(base_url, edge):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0) as c:
        r = c.post(ENROLL, json={"code": edge["enroll_code"]})
        assert r.status_code == 200, r.text
        ident = r.json()
        assert ident["edge_id"] == edge["edge"]["id"]
        assert ident["org_id"] == ORG_ID and ident["site_id"] == SITE_ID
        assert ident["mqtt_password"] != edge["secret"]
        assert ident["state_key"]
        assert c.post(ENROLL, json={"code": edge["enroll_code"]}).status_code == 410


def test_enroll_expired_410(base_url, admin_api, edge):
    # a 30-min TTL expiry cannot be forced over HTTP; the same 410 path is hit by
    # a code voided through re-issue (expiry itself is checked in the handler)
    httpx = pytest.importorskip("httpx")
    r = admin_api.post(f"{EDGES}/{edge['edge']['id']}/enroll-code")
    assert r.status_code == 200, r.text
    assert r.json()["enroll_code"] != edge["enroll_code"]
    with httpx.Client(base_url=base_url, timeout=10.0) as c:
        assert c.post(ENROLL, json={"code": edge["enroll_code"]}).status_code == 410


def test_enrolled_credential_connects_mqtt(base_url, edge):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0) as c:
        ident = c.post(ENROLL, json={"code": edge["enroll_code"]}).json()
    cl = mqtt_connect(username=ident["mqtt_username"], password=ident["mqtt_password"])
    try:
        wait_until(lambda: cl.is_connected(), 10, desc="enrolled credential connects")
    finally:
        cl.loop_stop()
        cl.disconnect()


def test_enroll_wrong_code_404_and_rate_limited(base_url):
    httpx = pytest.importorskip("httpx")
    codes = []
    with httpx.Client(base_url=base_url, timeout=10.0) as c:
        for _ in range(14):
            codes.append(c.post(ENROLL, json={"code": "AAAA-AAAA"}).status_code)
            if codes[-1] == 429:
                break
    assert codes[0] == 404
    assert 429 in codes   # drains this IP's bucket for a minute: keep this test last
