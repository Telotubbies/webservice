"""API keys (service accounts) - role gates, one-time secret, auth, revocation."""

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN  # noqa: E402

URL = f"/api/v1/orgs/{ORG_ID}/api-keys"


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        yield c


def _bearer(base_url, secret):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=10.0,
                        headers={"Authorization": f"Bearer {secret}"})


def test_viewer_cannot_list_or_create(viewer_api):
    assert viewer_api.get(URL).status_code == 403
    assert viewer_api.post(URL, json={"name": "x", "role": "viewer"}).status_code == 403


def test_owner_role_is_refused(admin_api):
    assert admin_api.post(URL, json={"name": "x", "role": "owner"}).status_code == 400


def test_key_lifecycle(admin_api, base_url):
    r = admin_api.post(URL, json={"name": "pytest reader", "role": "viewer", "expires_days": 1})
    assert r.status_code == 201, r.text
    body = r.json()
    secret, key = body["secret"], body["key"]
    assert secret.startswith("wds_sk_") and secret.startswith(key["prefix"])
    try:
        # the secret is never listed again
        listed = admin_api.get(URL).json()["items"]
        assert secret not in str(listed)
        assert any(k["id"] == key["id"] for k in listed)

        # it authenticates, with exactly the role it was given
        with _bearer(base_url, secret) as svc:
            assert svc.get(f"/api/v1/orgs/{ORG_ID}/sites").status_code == 200
            assert svc.post("/api/alarms/does-not-matter/ack").status_code in (403, 404, 422)
            # a key cannot manage keys
            assert svc.get(URL).status_code == 403
            assert svc.post(URL, json={"name": "child", "role": "viewer"}).status_code == 403

        # service accounts do not show up as org members
        members = admin_api.get(f"/api/v1/orgs/{ORG_ID}/members").json()["items"]
        assert not any(m["sub"].startswith("svc:") for m in members)
    finally:
        assert admin_api.delete(f"{URL}/{key['id']}").status_code == 204

    # revocation is immediate
    with _bearer(base_url, secret) as svc:
        assert svc.get(f"/api/v1/orgs/{ORG_ID}/sites").status_code == 401
    assert admin_api.delete(f"{URL}/{key['id']}").status_code == 404


def test_garbage_key_is_401(base_url):
    with _bearer(base_url, "wds_sk_" + "x" * 43) as svc:
        assert svc.get(f"/api/v1/orgs/{ORG_ID}/sites").status_code == 401
