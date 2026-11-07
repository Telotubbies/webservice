"""F18: API key scopes. read:production opens the closed summaries, nothing else does; no scope can control a PLC."""

import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, SITE_ID, TAGS  # noqa: E402

KEYS = f"/api/v1/orgs/{ORG_ID}/api-keys"
SUMMARIES = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/summaries"


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=15.0, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def admin(base_url):
    with _client(base_url, ADMIN_TOKEN) as c:
        yield c


@pytest.fixture()
def make_key(admin, base_url):
    made = []

    def go(scopes, **kw):
        r = admin.post(KEYS, json={"name": f"f18-{uuid.uuid4().hex[:6]}", "role": "viewer", "expires_days": 1, "scopes": scopes, **kw})
        assert r.status_code == 201, r.text
        made.append(r.json()["key"]["id"])
        return r.json()["secret"], r.json()["key"]

    yield go
    for kid in made:
        admin.delete(f"{KEYS}/{kid}")


def test_unknown_scope_and_too_many_scopes_are_refused(admin):
    assert admin.post(KEYS, json={"name": "x", "role": "viewer", "scopes": ["admin:everything"]}).status_code == 400
    assert admin.post(KEYS, json={"name": "x", "role": "viewer", "scopes": ["read:production", "write:orders", "read:production"]}).status_code in (400, 422)


def test_scopes_are_stored_sorted(make_key):
    _, key = make_key(["write:orders", "read:production"])
    assert key["scopes"] == ["read:production", "write:orders"]


def test_read_production_key_reads_summaries(base_url, make_key):
    secret, _ = make_key(["read:production"])
    with _client(base_url, secret) as k:
        for kind in ("shift", "hour"):
            r = k.get(SUMMARIES, params={"kind": kind})
            assert r.status_code == 200 and r.json()["kind"] == kind
        r = k.get(SUMMARIES, params={"format": "csv"})
        assert r.status_code == 200 and r.text.splitlines()[0].startswith("machine,")


def test_key_without_the_scope_is_refused_on_summaries(base_url, make_key):
    for scopes in ([], ["write:orders"]):
        secret, _ = make_key(scopes)
        with _client(base_url, secret) as k:
            assert k.get(SUMMARIES).status_code == 403


def test_summaries_by_a_person_need_no_scope(admin):
    assert admin.get(SUMMARIES).status_code == 200


def test_scoped_key_cannot_use_other_surfaces(base_url, make_key):
    secret, _ = make_key(["read:production", "write:orders"])
    with _client(base_url, secret) as k:
        # viewer role keys cannot configure or export other things
        assert k.get(f"/api/v1/orgs/{ORG_ID}/integration/outbox").status_code == 403
        assert k.post(KEYS, json={"name": "esc", "role": "viewer"}).status_code in (401, 403)


def test_no_scope_lets_a_key_control_a_plc(base_url, make_key):
    secret, key = make_key(["read:production", "write:orders"])
    assert key["allow_control"] is False
    with _client(base_url, secret) as k:
        r = k.post("/api/commands", json={"reason": "scope probe", "tag": TAGS["speed_sp"], "value": 30,
                                          "idempotency_key": f"f18-{uuid.uuid4()}", "ttl_s": 15})
    assert r.status_code in (401, 403), r.text


def test_revoked_key_stops_working(admin, base_url, make_key):
    secret, key = make_key(["read:production"])
    with _client(base_url, secret) as k:
        assert k.get(SUMMARIES).status_code == 200
        assert admin.delete(f"{KEYS}/{key['id']}").status_code in (200, 204)
        assert k.get(SUMMARIES).status_code == 401
