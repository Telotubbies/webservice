"""v1 endpoints scoped by X-WDS-Org / X-WDS-Site headers (multi-org console). Needs `make up-test`."""

from __future__ import annotations

import asyncio
import os
import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.integration

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")
OPERATOR_ID = uuid.UUID("0199d000-0000-7000-8000-00000000d001")


@pytest.fixture()
def new_org(api):
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set")

    async def verify():
        c = await asyncpg.connect(APP_DSN)
        try:
            await c.execute("UPDATE users SET email_verified=true WHERE id=$1", OPERATOR_ID)
        finally:
            await c.close()
    asyncio.run(verify())
    r = api.post("/api/v1/orgs", json={"name": "Scope Test", "slug": "sc-" + uuid.uuid4().hex[:10]})
    assert r.status_code == 201, r.text
    j = r.json()
    return {"X-WDS-Org": j["org"]["id"], "X-WDS-Site": j["site"]["id"]}


def test_no_headers_still_serves_the_seeded_org(api):
    r = api.get("/api/tags")
    assert r.status_code == 200 and len(r.json()) > 0


def test_scoped_new_org_has_no_tags_alarms_commands(api, new_org):
    assert api.get("/api/tags", headers=new_org).json() == []
    assert api.get("/api/tags/latest", headers=new_org).json() == []
    assert api.get("/api/alarms", headers=new_org).json() == []
    assert api.get("/api/alarm-rules", headers=new_org).json() == []
    assert api.get("/api/commands", headers=new_org).json() == []


def test_seeded_tag_names_do_not_resolve_in_other_org(api, new_org):
    name = api.get("/api/tags").json()[0]["name"]
    assert api.get(f"/api/tags/{name}/latest", headers=new_org).status_code == 404
    assert api.get(f"/api/tags/{name}/history", headers=new_org).json() == []


def test_non_member_header_is_404(viewer_headers, new_org, base_url):
    import httpx
    with httpx.Client(base_url=base_url, timeout=10, headers={**viewer_headers, **new_org}) as v:
        assert v.get("/api/tags").status_code == 404


def test_site_from_another_org_is_404(api, new_org):
    # a real site id that belongs to the seeded org, paired with the new org
    seeded_org = next(m for m in api.get("/api/v1/me").json()["memberships"]
                      if m["org_id"] != new_org["X-WDS-Org"])
    site = api.get(f"/api/v1/orgs/{seeded_org['org_id']}/sites").json()["items"][0]["id"]
    r = api.get("/api/tags", headers={"X-WDS-Org": new_org["X-WDS-Org"], "X-WDS-Site": site})
    assert r.status_code == 404


def test_half_scope_is_400(api, new_org):
    assert api.get("/api/tags", headers={"X-WDS-Org": new_org["X-WDS-Org"]}).status_code == 400


def test_malformed_ids_are_404(api):
    assert api.get("/api/tags", headers={"X-WDS-Org": "nope", "X-WDS-Site": "nope"}).status_code == 404


def test_viewer_cannot_send_commands_in_scope(api, new_org):
    # operator owns the new org -> allowed to reach the endpoint; unknown tag is a clean 4xx, not a 500
    r = api.post("/api/commands", headers=new_org, json={"tag": "x.y.z", "value": 1})
    assert 400 <= r.status_code < 500
