"""Sign-up / self-serve org isolation (roadmap 1.1-1.2, plan m1-01 Task 6).

Dev tokens are three fixed users, so "a user with no org" is modelled as
demo-viewer addressing an org it is NOT a member of (a freshly created org
owned by demo-operator). A real zero-membership OIDC user is not exercised.

Orgs created here persist (append-only audit_log pins them); slug prefix `sec-`.
Requires BASE_URL + WDS_TEST_APP_DSN (`make test-security`).
"""

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import OPERATOR_TOKEN, VIEWER_TOKEN  # noqa: E402

OPERATOR_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d001")


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _set_verified(dsn, value):
    async def go():
        import asyncpg
        c = await asyncpg.connect(dsn)
        try:
            await c.execute("UPDATE users SET email_verified=$2 WHERE id=$1", OPERATOR_UID, value)
        finally:
            await c.close()
    asyncio.run(go())


@pytest.fixture()
def created_orgs(app_dsn):
    """Orgs cannot be deleted: audit_log is append-only and FK-referenced
    (by design). Slugs start with `sec-` so a superuser can purge them."""
    yield []
    _set_verified(app_dsn, True)


@pytest.fixture()
def operator(base_url):
    with httpx.Client(base_url=base_url, timeout=10, headers=_auth(OPERATOR_TOKEN)) as c:
        yield c


@pytest.fixture()
def viewer(base_url):
    with httpx.Client(base_url=base_url, timeout=10, headers=_auth(VIEWER_TOKEN)) as c:
        yield c


def _new_org(operator, created_orgs):
    r = operator.post("/api/v1/orgs", json={"name": "Sec Test", "slug": "sec-" + uuid.uuid4().hex[:10]})
    assert r.status_code == 201, r.text
    created_orgs.append(r.json()["org"]["id"])
    return r.json()


def _org_routes(base_url):
    spec = httpx.get(f"{base_url}/openapi.json", timeout=10).json()
    for path, ops in spec["paths"].items():
        if path.startswith("/api/v1/orgs/{org}"):
            for method in ops:
                yield method.upper(), path


def test_non_member_gets_404_on_every_org_route(base_url, app_dsn, operator, viewer, created_orgs):
    _set_verified(app_dsn, True)
    new = _new_org(operator, created_orgs)
    org, site = new["org"]["id"], new["site"]["id"]
    routes = list(_org_routes(base_url))
    assert len(routes) > 30, "OpenAPI route discovery returned too few routes"
    ghost = str(uuid.uuid4())
    seen: dict = {}
    for method, path in routes:
        for target in (org, ghost):
            url = path.replace("{org}", target).replace("{site}", site)
            for p in ("tag_id", "alarm_id", "command_id", "edge_id", "rule_id", "dash_id", "nb_id", "dt_id",
                      "team_id", "inc_id", "user_id", "key_id", "slo_id", "cid", "invite_id"):
                url = url.replace("{%s}" % p, str(uuid.uuid4()))
            r = viewer.request(method, url, json={} if method in ("POST", "PUT", "PATCH") else None)
            seen.setdefault((method, path), []).append(r.status_code)
    # no existence oracle: a real org the caller isn't in answers exactly like a nonexistent one, and never 2xx
    bad = [(k, v) for k, v in seen.items() if v[0] != v[1] or not 400 <= v[0] < 500]
    assert not bad, f"non-member response differs from nonexistent org: {bad}"


def test_unverified_user_cannot_create_org(app_dsn, operator, created_orgs):
    _set_verified(app_dsn, False)
    try:
        r = operator.post("/api/v1/orgs", json={"name": "No", "slug": "sec-" + uuid.uuid4().hex[:10]})
        assert r.status_code == 403 and "email_not_verified" in r.text
    finally:
        _set_verified(app_dsn, True)


def test_creating_org_does_not_change_other_orgs_member_count(app_dsn, operator, created_orgs):
    _set_verified(app_dsn, True)
    first = _new_org(operator, created_orgs)["org"]["id"]
    before = operator.get(f"/api/v1/orgs/{first}/members").json()
    _new_org(operator, created_orgs)
    after = operator.get(f"/api/v1/orgs/{first}/members").json()
    assert before == after
