"""Downtimes API — role gates, window validation, create/end/delete roundtrip."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.integration

from conftest import ORG_ID, VIEWER_TOKEN  # noqa: E402

URL = f"/api/v1/orgs/{ORG_ID}/downtimes"


def _body(**kw):
    now = datetime.now(timezone.utc)
    return {"description": "belt swap", "starts_at": (now - timedelta(minutes=5)).isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(), **kw}


@pytest.fixture()
def viewer_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        yield c


def test_viewer_reads_but_cannot_schedule(viewer_api, api):
    dt = api.post(URL, json=_body()).json()["downtime"]
    try:
        seen = {d["id"]: d for d in viewer_api.get(URL).json()["downtimes"]}[dt["id"]]
        # members' emails are admin-only (member:manage) — a viewer must not learn them here
        assert "creator" not in seen and "@" not in str(seen)
        assert seen["mine"] is False and dt["mine"] is True
    finally:
        api.delete(f"{URL}/{dt['id']}")
    assert viewer_api.post(URL, json=_body()).status_code == 403


def test_window_validation(api):
    now = datetime.now(timezone.utc)
    assert api.post(URL, json=_body(ends_at=(now - timedelta(hours=1)).isoformat())).status_code == 400
    long = _body(ends_at=(now + timedelta(days=8)).isoformat(), recurring=True)
    assert api.post(URL, json=long).status_code == 400
    assert api.post(URL, json=_body(rule_id=str(uuid.uuid4()))).status_code == 404  # unknown rule


def test_create_end_delete_roundtrip(api):
    r = api.post(URL, json=_body())
    assert r.status_code == 201, r.text
    dt = r.json()["downtime"]
    assert dt["rule_id"] is None and dt["recurring"] is False
    try:
        listed = api.get(URL).json()
        assert dt["id"] in {d["id"] for d in listed["downtimes"]}
        ended = api.post(f"{URL}/{dt['id']}/end")
        assert ended.status_code == 200
        assert datetime.fromisoformat(ended.json()["downtime"]["ends_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc) + timedelta(seconds=2)
    finally:
        assert api.delete(f"{URL}/{dt['id']}").status_code == 204
    assert api.delete(f"{URL}/{dt['id']}").status_code == 404
