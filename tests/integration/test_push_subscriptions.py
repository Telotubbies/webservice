"""Web Push subscription API over HTTP: endpoint policy, key checks, per-user cap,
the default channel, and the mobile_control policy switch. Nothing here sends a
real push (the endpoints are never contacted)."""

import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID  # noqa: E402

ORG = f"/api/v1/orgs/{ORG_ID}"


def _keys():
    pytest.importorskip("cryptography")
    from cryptography.hazmat.primitives.asymmetric import ec
    from app.alarming import webpush as W
    return {"p256dh": W.b64e(W.public_bytes(ec.generate_private_key(ec.SECP256R1()))),
            "auth": W.b64e(b"0123456789abcdef")}


def _endpoint():
    return f"https://fcm.googleapis.com/fcm/send/it-{uuid.uuid4().hex}"


@pytest.fixture()
def admin(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=15.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def made(admin):
    eps: list[str] = []
    yield eps
    for e in eps:
        admin.delete(f"{ORG}/push-subscriptions", params={"endpoint": e})


def test_vapid_key_is_a_p256_point(admin):
    r = admin.get("/api/v1/push/vapid-key")
    assert r.status_code == 200
    from app.alarming import webpush as W
    raw = W.b64d(r.json()["key"])
    assert len(raw) == 65 and raw[0] == 4


def test_subscribe_validates_endpoint_and_keys(admin, made):
    bad_host = admin.post(f"{ORG}/push-subscriptions",
                          json={"endpoint": "https://internal.example/x", "keys": _keys()})
    assert bad_host.status_code == 422 and "endpoint_not_allowed" in bad_host.text
    http_ep = admin.post(f"{ORG}/push-subscriptions",
                         json={"endpoint": "http://fcm.googleapis.com/x", "keys": _keys()})
    assert http_ep.status_code == 422
    bad_keys = admin.post(f"{ORG}/push-subscriptions",
                          json={"endpoint": _endpoint(), "keys": {"p256dh": "AAAA", "auth": "AAAA"}})
    assert bad_keys.status_code == 422

    ep = _endpoint()
    ok = admin.post(f"{ORG}/push-subscriptions", json={"endpoint": ep, "keys": _keys(), "ua": "pytest"})
    assert ok.status_code == 201
    made.append(ep)
    mine = admin.get(f"{ORG}/push-subscriptions").json()["items"]
    assert any(i["ua"] == "pytest" for i in mine)
    assert all("endpoint" not in i and "auth" not in i for i in mine)   # never echoed back


def test_resubscribing_the_same_device_does_not_duplicate(admin, made):
    ep = _endpoint()
    for _ in range(3):
        assert admin.post(f"{ORG}/push-subscriptions", json={"endpoint": ep, "keys": _keys()}).status_code == 201
    made.append(ep)
    before = len(admin.get(f"{ORG}/push-subscriptions").json()["items"])
    admin.post(f"{ORG}/push-subscriptions", json={"endpoint": ep, "keys": _keys()})
    assert len(admin.get(f"{ORG}/push-subscriptions").json()["items"]) == before


def test_a_user_keeps_at_most_five_devices(admin, made):
    for _ in range(7):
        ep = _endpoint()
        assert admin.post(f"{ORG}/push-subscriptions", json={"endpoint": ep, "keys": _keys()}).status_code == 201
        made.append(ep)
    assert len(admin.get(f"{ORG}/push-subscriptions").json()["items"]) <= 5


def test_unsubscribe_and_the_default_channel(admin, made):
    ep = _endpoint()
    admin.post(f"{ORG}/push-subscriptions", json={"endpoint": ep, "keys": _keys()})
    chans = admin.get(f"{ORG}/notification-channels").json()
    assert any(c["type"] == "webpush" for c in chans["items"]), "a webpush channel is created on first subscribe"
    n = len(admin.get(f"{ORG}/push-subscriptions").json()["items"])
    assert admin.delete(f"{ORG}/push-subscriptions", params={"endpoint": ep}).status_code == 204
    assert len(admin.get(f"{ORG}/push-subscriptions").json()["items"]) == n - 1


def test_mobile_control_policy_round_trip(admin):
    start = admin.get(f"{ORG}/security").json()
    assert start["mobile_control"] is False                       # off unless an admin turns it on
    try:
        on = admin.patch(f"{ORG}/security", json={"mobile_control": True})
        assert on.status_code == 200 and on.json()["mobile_control"] is True
        assert admin.get(f"{ORG}/security").json()["mobile_control"] is True
        assert admin.patch(f"{ORG}/security", json={}).status_code == 422
    finally:
        admin.patch(f"{ORG}/security", json={"mobile_control": False})
    assert admin.get(f"{ORG}/security").json()["mobile_control"] is False


def test_operators_cannot_change_the_policy(base_url, operator_headers):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0, headers=operator_headers) as c:
        assert c.patch(f"{ORG}/security", json={"mobile_control": True}).status_code == 403
        assert c.get(f"{ORG}/security").status_code == 200       # but may read it
