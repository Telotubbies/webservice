"""POST /api/v1/orgs — self-serve org creation (roadmap 1.1/1.2). Needs `make up-test`."""

from __future__ import annotations

import asyncio
import os
import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.integration

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")
OPERATOR_ID = uuid.UUID("0199d000-0000-7000-8000-00000000d001")  # seed.DEMO_USERS demo-operator


def _slug() -> str:
    return "t-" + uuid.uuid4().hex[:10]


def _body(slug=None, **kw):
    return {"name": "Acme Plant", "slug": slug or _slug(), **kw}


def _set_verified(value: bool):
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set")

    async def go():
        c = await asyncpg.connect(APP_DSN)
        try:
            await c.execute("UPDATE users SET email_verified=$2 WHERE id=$1", OPERATOR_ID, value)
        finally:
            await c.close()
    asyncio.run(go())


@pytest.fixture()
def verified():
    _set_verified(True)
    yield


def test_create_org_returns_owner_and_default_site(api, verified):
    r = api.post("/api/v1/orgs", json=_body(timezone="Asia/Tokyo", language="th"))
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["role"] == "owner" and j["org"]["timezone"] == "Asia/Tokyo" and j["org"]["language"] == "th"
    sites = api.get(f"/api/v1/orgs/{j['org']['id']}/sites").json()["items"]
    assert [s["id"] for s in sites] == [j["site"]["id"]]


def test_creator_me_shows_org_immediately(api, verified):
    org = api.post("/api/v1/orgs", json=_body()).json()["org"]["id"]
    me = api.get("/api/v1/me").json()
    assert any(m["org_id"] == org and m["role"] == "owner" for m in me["memberships"])


def test_unverified_email_gets_403(api):
    _set_verified(False)
    try:
        r = api.post("/api/v1/orgs", json=_body())
        assert r.status_code == 403 and "email_not_verified" in r.text
    finally:
        _set_verified(True)


def test_duplicate_slug_409(api, verified):
    s = _slug()
    assert api.post("/api/v1/orgs", json=_body(s)).status_code == 201
    r = api.post("/api/v1/orgs", json=_body(s))
    assert r.status_code == 409 and "slug_taken" in r.text


def test_concurrent_same_slug_one_wins(base_url, operator_headers, verified):
    import httpx
    s = _slug()

    async def go():
        async with httpx.AsyncClient(base_url=base_url, headers=operator_headers, timeout=10) as c:
            return await asyncio.gather(*[c.post("/api/v1/orgs", json=_body(s)) for _ in range(2)])
    codes = sorted(r.status_code for r in asyncio.run(go()))
    assert codes == [201, 409]


@pytest.mark.parametrize("bad", ["Bad Slug", "ab", "admin", "-x-"])
def test_bad_slug_422(api, verified, bad):
    assert api.post("/api/v1/orgs", json=_body(bad)).status_code == 422


def test_other_user_cannot_see_new_org(api, viewer_headers, base_url, verified):
    import httpx
    org = api.post("/api/v1/orgs", json=_body()).json()["org"]["id"]
    with httpx.Client(base_url=base_url, headers=viewer_headers, timeout=10) as v:
        assert v.get(f"/api/v1/orgs/{org}").status_code == 404


def test_anonymous_cannot_create(anon_api):
    assert anon_api.post("/api/v1/orgs", json=_body()).status_code == 401
