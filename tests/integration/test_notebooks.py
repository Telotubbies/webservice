"""Notebooks API — visibility (shared vs private), role gate, CRUD roundtrip."""

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN  # noqa: E402

URL = f"/api/v1/orgs/{ORG_ID}/notebooks"


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {token}"})


def test_roundtrip_and_private_visibility(api, base_url):
    r = api.post(URL, json={"title": "shift log", "body": "# hi", "shared": False})
    assert r.status_code == 201, r.text
    nb = r.json()["notebook"]
    try:
        assert nb["mine"] is True
        assert api.put(f"{URL}/{nb['id']}", json={"title": "shift log", "body": "# edited", "shared": False}).json()["notebook"]["body"] == "# edited"
        with _client(base_url, VIEWER_TOKEN) as viewer:
            assert nb["id"] not in {n["id"] for n in viewer.get(URL).json()["notebooks"]}  # private
            assert viewer.post(URL, json={"title": "x"}).status_code == 403
        with _client(base_url, ADMIN_TOKEN) as admin:  # admin can't read others' private notes either
            assert nb["id"] not in {n["id"] for n in admin.get(URL).json()["notebooks"]}
    finally:
        assert api.delete(f"{URL}/{nb['id']}").status_code == 204


def test_shared_visible_and_title_validated(api, base_url):
    assert api.post(URL, json={"title": ""}).status_code == 400
    nb = api.post(URL, json={"title": "pm plan", "shared": True}).json()["notebook"]
    try:
        with _client(base_url, VIEWER_TOKEN) as viewer:
            seen = {n["id"]: n for n in viewer.get(URL).json()["notebooks"]}
            assert nb["id"] in seen and seen[nb["id"]]["mine"] is False
            assert viewer.put(f"{URL}/{nb['id']}", json={"title": "hijack"}).status_code == 403
    finally:
        api.delete(f"{URL}/{nb['id']}")


def test_stale_update_is_409_not_silent_overwrite(api):
    nb = api.post(URL, json={"title": "pm", "body": "v1"}).json()["notebook"]
    try:
        first = api.put(f"{URL}/{nb['id']}", json={"title": "pm", "body": "v2", "base_updated_at": nb["updated_at"]})
        assert first.status_code == 200, first.text
        stale = api.put(f"{URL}/{nb['id']}", json={"title": "pm", "body": "lost?", "base_updated_at": nb["updated_at"]})
        assert stale.status_code == 409
        fresh = api.put(f"{URL}/{nb['id']}", json={"title": "pm", "body": "v3", "base_updated_at": first.json()["notebook"]["updated_at"]})
        assert fresh.status_code == 200 and fresh.json()["notebook"]["body"] == "v3"
    finally:
        api.delete(f"{URL}/{nb['id']}")
