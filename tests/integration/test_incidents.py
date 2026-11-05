"""Teams + incidents API — role gates, status machine, timeline."""

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN  # noqa: E402

INC = f"/api/v1/orgs/{ORG_ID}/incidents"
TEAMS = f"/api/v1/orgs/{ORG_ID}/teams"


@pytest.fixture()
def clients(base_url):
    httpx = pytest.importorskip("httpx")
    mk = lambda tok: httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {tok}"})
    with mk(VIEWER_TOKEN) as v, mk(ADMIN_TOKEN) as a:
        yield v, a


def test_incident_lifecycle_and_gates(api, clients):
    viewer, _ = clients
    assert viewer.post(INC, json={"title": "x"}).status_code == 403
    inc = api.post(INC, json={"title": "belt jam", "severity": "critical"}).json()["incident"]
    iid = inc["id"]
    assert inc["status"] == "active" and inc["mine"] is True
    assert api.post(f"{INC}/{iid}/notes", json={"body": "checking belt"}).status_code == 201
    assert api.post(f"{INC}/{iid}/status", json={"status": "acknowledged"}).json()["incident"]["acked_at"]
    assert api.post(f"{INC}/{iid}/status", json={"status": "acknowledged"}).status_code == 409  # already past
    assert api.post(f"{INC}/{iid}/status", json={"status": "resolved"}).json()["incident"]["resolved_at"]
    assert api.post(f"{INC}/{iid}/status", json={"status": "resolved"}).status_code == 409
    d = viewer.get(f"{INC}/{iid}").json()
    assert [e["kind"] for e in d["events"]] == ["created", "note", "status", "status"]
    assert "@" not in str(d)  # display names only


def test_team_admin_only_and_unique_name(api, clients):
    _, admin = clients
    assert api.post(TEAMS, json={"name": "Maint"}).status_code == 403
    r = admin.post(TEAMS, json={"name": "Maint-it"})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    try:
        assert admin.post(TEAMS, json={"name": "maint-IT"}).status_code == 409
        assert admin.put(f"{TEAMS}/{tid}/members", json={"user_ids": ["00000000-0000-4000-8000-000000000000"]}).status_code == 404
        assert tid in {t["id"] for t in api.get(TEAMS).json()["teams"]}
    finally:
        assert admin.delete(f"{TEAMS}/{tid}").status_code == 204
