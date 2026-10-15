"""SLO CRUD, correction windows and the status endpoint."""

from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, TAGS, VIEWER_TOKEN  # noqa: E402

URL = f"/api/v1/orgs/{ORG_ID}/slos"


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def admin_api(base_url):
    with _client(base_url, ADMIN_TOKEN) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    with _client(base_url, VIEWER_TOKEN) as c:
        yield c


def test_viewer_reads_but_cannot_write(viewer_api):
    assert viewer_api.get(URL).status_code == 200
    assert viewer_api.get(URL + "/status").status_code == 200
    assert viewer_api.post(URL, json={"name": "x", "tag": "plant1.x", "target": 99}).status_code == 403


def test_validation(admin_api):
    tag = next(iter(TAGS))
    assert admin_api.post(URL, json={"name": "bad", "tag": "nope.nope", "target": 99}).status_code == 400
    assert admin_api.post(URL, json={"name": "bad", "tag": tag, "target": 100}).status_code == 422
    assert admin_api.post(URL, json={"name": "bad", "tag": tag, "target": 99, "warning": 98}).status_code == 400


def test_slo_lifecycle_with_correction(admin_api):
    tag = next(iter(TAGS))
    r = admin_api.post(URL, json={"name": "pytest slo", "tag": tag, "target": 99.0})
    assert r.status_code == 201, r.text
    slo = r.json()["slo"]
    try:
        assert slo["warning"] > slo["target"]
        assert admin_api.post(URL, json={"name": "pytest slo", "tag": tag, "target": 99.0}).status_code == 409

        now = datetime.now(timezone.utc)
        win = {"starts_at": (now - timedelta(hours=1)).isoformat(), "ends_at": now.isoformat(), "reason": "belt swap"}
        c = admin_api.post(f"{URL}/{slo['id']}/corrections", json=win)
        assert c.status_code == 201, c.text
        assert admin_api.post(f"{URL}/{slo['id']}/corrections",
                              json={**win, "ends_at": win["starts_at"]}).status_code == 400

        listed = {s["id"]: s for s in admin_api.get(URL).json()["items"]}[slo["id"]]
        assert [x["reason"] for x in listed["corrections"]] == ["belt swap"]

        st = {s["id"]: s for s in admin_api.get(URL + "/status", params={"days": 1}).json()["items"]}[slo["id"]]
        assert "sli" in st and st["excluded"] >= 0

        p = admin_api.patch(f"{URL}/{slo['id']}", json={"target": 99.9})
        assert p.status_code == 200 and p.json()["slo"]["target"] == 99.9
        assert p.json()["slo"]["warning"] >= 99.9

        assert admin_api.delete(f"{URL}/{slo['id']}/corrections/{c.json()['correction']['id']}").status_code == 204
    finally:
        assert admin_api.delete(f"{URL}/{slo['id']}").status_code == 204
    assert admin_api.delete(f"{URL}/{slo['id']}").status_code == 404
