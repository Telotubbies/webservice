"""Object-storage isolation: one org's uploads are never visible to another,
and a plain member only ever sees their own uploads.

Needs BASE_URL + WDS_TEST_APP_DSN (`make test-security`).
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import ORG_ID as V1_ORG, OPERATOR_TOKEN  # noqa: E402
from security.conftest import ADMIN_UID, _tenant_conn  # noqa: E402


@pytest.fixture()
def b_video(org_b, app_dsn):
    """A video uploaded by org B's admin, inserted as org B's tenant."""
    vid = uuid.uuid4()

    async def go():
        conn = await _tenant_conn(app_dsn, org_b["org"])
        try:
            await conn.execute(
                "INSERT INTO videos(id, org_id, site_id, filename, content_type, size_bytes, sha256,"
                " storage_key, uploaded_by) VALUES ($1,$2,$3,'b-secret.mp4','video/mp4',1234,$4,$5,$6)",
                vid, org_b["org"], org_b["site"], "0" * 64, f"videos/{org_b['org']}/{vid}", ADMIN_UID)
        finally:
            await conn.close()
    asyncio.run(go())
    return vid


def test_nonmember_cannot_read_or_sync_org_b_storage(base_url, org_b):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"}) as c:
        assert c.get(f"/api/v1/orgs/{org_b['org']}/storage").status_code == 404
        assert c.post(f"/api/v1/orgs/{org_b['org']}/storage/sync").status_code == 404


def test_org_a_inventory_never_lists_org_b_objects(admin_api, org_b, b_video):
    a = admin_api.get(f"/api/v1/orgs/{V1_ORG}/storage").json()
    assert str(b_video) not in {i["id"] for i in a["items"]}
    assert all(org_b["org"].hex not in str(i) and str(org_b["org"]) not in str(i) for i in a["items"])
    b = admin_api.get(f"/api/v1/orgs/{org_b['org']}/storage").json()
    assert b["scope"] == "org" and str(b_video) in {i["id"] for i in b["items"]}
    assert b["by_user"] and b["by_user"][0]["objects"] >= 1


def test_plain_member_sees_only_own_uploads(viewer_api, org_b, b_video):
    r = viewer_api.get(f"/api/v1/orgs/{org_b['org']}/storage")
    assert r.status_code == 200
    d = r.json()
    assert d["scope"] == "mine" and d["items"] == [] and d["orphans"] == []


def test_viewer_cannot_trigger_sync(viewer_api, org_b):
    assert viewer_api.post(f"/api/v1/orgs/{org_b['org']}/storage/sync").status_code == 403
