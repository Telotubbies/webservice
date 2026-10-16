"""Data sources + tags CRUD: versioning, write-only secrets, roles, bulk CSV, in-use delete."""

import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, EDGE_UUID, ORG_ID, SITE_ID, VIEWER_TOKEN  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/sources"
CSV_HDR = "line,device,signal,address,type,unit,writable,min,max,scale\n"


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


@pytest.fixture()
def source(admin_api):
    """A throw-away modbus source; tags are removed, then the source."""
    name = f"pytest-{uuid.uuid4().hex[:8]}"
    r = admin_api.post(BASE, json={"name": name, "protocol": "modbus",
                                   "connection": {"host": "10.0.0.5"}})
    assert r.status_code == 201, r.text
    src = r.json()["source"]
    yield src
    url = f"{BASE}/{src['id']}"
    for t in admin_api.get(f"{url}/tags").json().get("items", []):
        admin_api.delete(f"{url}/tags/{t['id']}")
    admin_api.delete(url)


def _tag(sig, address="40001", **kw):
    return {"line": "PyLine", "device": "PyDev", "signal": sig, "address": address, **kw}


def test_create_source_and_tag_visible_in_registry(admin_api, source):
    sig = f"sig_{uuid.uuid4().hex[:6]}"
    r = admin_api.post(f"{BASE}/{source['id']}/tags", json=_tag(sig, scale=0.1, offset=1))
    assert r.status_code == 201, r.text
    tag = r.json()["tag"]
    assert tag["path"] == f"pyline/pydev/{sig}" and tag["offset"] == 1
    assert tag["address"]["area"] == "holding_register"
    deadline = time.time() + 2
    paths = []
    while time.time() < deadline:
        paths = [t["path"] for t in admin_api.get(
            f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/tags").json()["items"]]
        if tag["path"] in paths:
            break
        time.sleep(0.2)
    assert tag["path"] in paths


def test_version_bumps_per_write(admin_api, source):
    v0 = admin_api.post(f"{BASE}/{source['id']}/tags", json=_tag("v_a")).json()["config_version"]
    v1 = admin_api.post(f"{BASE}/{source['id']}/tags", json=_tag("v_b")).json()["config_version"]
    p = admin_api.patch(f"{BASE}/{source['id']}", json={"poll_ms": 500})
    assert p.status_code == 200, p.text
    v2 = p.json()["config_version"]
    assert v0 < v1 < v2


def test_secret_write_only(admin_api, source):
    url = f"{BASE}/{source['id']}"
    assert source["has_secret"] is False
    p = admin_api.patch(url, json={"secrets": {"password": "hunter2-pytest"}})
    assert p.status_code == 200, p.text
    assert p.json()["source"]["has_secret"] is True
    assert "hunter2-pytest" not in p.text
    listed = admin_api.get(BASE)
    assert "hunter2-pytest" not in listed.text and "secret_enc" not in listed.text
    assert admin_api.patch(url, json={"secrets": {}}).json()["source"]["has_secret"] is False
    big = admin_api.patch(url, json={"secrets": {"x": "a" * 5000}})
    assert big.status_code == 422


def test_viewer_403_nonmember_404(viewer_api, admin_api):
    assert viewer_api.get(BASE).status_code == 200
    r = viewer_api.post(BASE, json={"name": "nope", "protocol": "sim"})
    assert r.status_code == 403
    other = f"/api/v1/orgs/{uuid.uuid4()}/edges/{EDGE_UUID}/sources"
    assert admin_api.get(other).status_code == 404
    assert admin_api.post(other, json={"name": "x", "protocol": "sim"}).status_code == 404


def test_bulk_csv_all_or_nothing(admin_api, source):
    url = f"{BASE}/{source['id']}"
    bad = CSV_HDR + "l1,m1,ok1,40001,number,,,,,\nl1,m1,bad,zzz,number,,,,,\n"
    r = admin_api.post(f"{url}/tags:bulk", content=bad, headers={"Content-Type": "text/csv"})
    assert r.status_code == 422, r.text
    errs = r.json()["errors"]
    assert errs[0]["row"] == 3 and errs[0]["field"].startswith("address")
    assert admin_api.get(f"{url}/tags").json()["items"] == []  # nothing inserted

    good = CSV_HDR + "l1,m1,ok1,40001,number,rpm,false,0,100,0.1\nl1,m1,run,%QX0.0,bool,,true,,,\n"
    r = admin_api.post(f"{url}/tags:bulk", content=good, headers={"Content-Type": "text/csv"})
    assert r.status_code == 201, r.text
    assert r.json()["created"] == 2
    assert len(admin_api.get(f"{url}/tags").json()["items"]) == 2


def test_delete_tag_in_use(admin_api, source):
    url = f"{BASE}/{source['id']}"
    tag = admin_api.post(f"{url}/tags", json=_tag("inuse")).json()["tag"]
    rule = admin_api.post(
        f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/alarm-rules",
        json={"name": "pytest ds rule", "tag_id": tag["id"], "kind": "hi",
              "threshold": 10, "severity": "warning"})
    assert rule.status_code == 201, rule.text
    rid = rule.json().get("rule", rule.json())["id"]
    try:
        r = admin_api.delete(f"{url}/tags/{tag['id']}")
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == "tag_in_use"
        assert any(x["kind"] == "alarm_rule" for x in r.json()["referrers"])
    finally:
        admin_api.delete(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/alarm-rules/{rid}")
    assert admin_api.delete(f"{url}/tags/{tag['id']}").status_code == 204


def test_test_route_roundtrip(admin_api, viewer_api):
    """Draft sim source tested through the real edge over MQTT (no DB rows)."""
    body = {"protocol": "sim", "connection": {}, "tags": [
        {"path": "l/d/s", "type": "float",
         "address": {"behavior": "random_walk", "initial": 1.0}}]}
    assert viewer_api.post(f"{BASE}:test", json=body).status_code == 403
    bad = admin_api.post(f"{BASE}:test", json={"protocol": "opcua",
                                               "connection": {"endpoint": "http://x"}})
    assert bad.status_code == 422, bad.text
    r = admin_api.post(f"{BASE}:test", json=body)
    if r.status_code == 504:
        pytest.skip("edge not connected in this stack")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["ok"] is True and 1 <= len(out["sample"]) <= 5
    assert {"path", "v", "q"} <= set(out["sample"][0])
