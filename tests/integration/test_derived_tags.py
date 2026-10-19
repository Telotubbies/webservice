"""Derived tags over HTTP: validate with a live preview, role gate, create, chain,
cycle / delete guards, and that the engine really writes samples."""

import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, SITE_ID  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}"


@pytest.fixture()
def admin(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def inputs(admin):
    items = [t for t in admin.get(f"{BASE}/tags").json()["items"]
             if t["type"] == "number" and t["path"].startswith("auto/")]
    assert len(items) >= 2, "needs two numeric device tags (make seed-dev)"
    return items[0], items[1]


@pytest.fixture()
def cleanup(admin):
    made: list[str] = []
    yield made
    for tid in reversed(made):
        admin.delete(f"{BASE}/derived-tags/{tid}")


def _path():
    return f"auto/it{uuid.uuid4().hex[:8]}/calc"


def test_validate_previews_the_current_value_and_points_at_errors(admin, inputs):
    a, b = inputs
    ok = admin.post(f"{BASE}/formulas/validate",
                    json={"expr": "a * 2 + b", "inputs": {"a": a["id"], "b": b["id"]}})
    assert ok.status_code == 200
    j = ok.json()
    assert j["type"] == "number" and j["quality"] in ("good", "uncertain") and j["value"] is not None
    assert {i["var"] for i in j["inputs"]} == {"a", "b"}

    # a mistake in the formula is a normal answer (200, ok=false), not a failed request
    bad = admin.post(f"{BASE}/formulas/validate", json={"expr": "a +", "inputs": {"a": a["id"]}})
    assert bad.status_code == 200 and bad.json()["ok"] is False
    assert bad.json()["error"]["code"] == "unexpected_token"

    unk = admin.post(f"{BASE}/formulas/validate", json={"expr": "a + z", "inputs": {"a": a["id"]}})
    assert unk.json()["error"] == {"code": "unknown_variable", "pos": 4, "name": "z"}

    foreign = admin.post(f"{BASE}/formulas/validate",
                         json={"expr": "a", "inputs": {"a": str(uuid.uuid4())}})
    assert foreign.status_code == 200 and foreign.json()["error"]["code"] == "unknown_input"


def test_only_admins_create_and_the_engine_writes_samples(admin, api, inputs, cleanup):
    a, b = inputs
    body = {"path": _path(), "expr": "a * 2 + b", "unit": "x",
            "inputs": {"a": a["id"], "b": b["id"]}}
    assert api.post(f"{BASE}/derived-tags", json=body).status_code == 403     # operator
    r = admin.post(f"{BASE}/derived-tags", json=body)
    assert r.status_code == 201
    tag = r.json()
    cleanup.append(tag["id"])
    assert tag["type"] == "number" and tag["version"] == 1

    # a calculated tag is not writable and never takes a command
    cmd = admin.post(f"{BASE}/commands", json={"tag_id": tag["id"], "value": 1})
    assert cmd.status_code in (404, 409, 422)

    deadline = time.time() + 15
    latest = None
    while time.time() < deadline:
        resp = admin.get(f"{BASE}/tags/{tag['id']}/latest")
        if resp.status_code == 200 and resp.json().get("v") is not None:
            latest = resp.json()
            break
        time.sleep(0.5)
    assert latest is not None, "engine never wrote a sample"
    assert latest["q"] in ("good", "uncertain")
    listed = {t["id"] for t in admin.get(f"{BASE}/derived-tags").json()["items"]}
    assert tag["id"] in listed


def test_chain_cycle_and_delete_guards(admin, inputs, cleanup):
    a, _ = inputs
    first = admin.post(f"{BASE}/derived-tags",
                       json={"path": _path(), "expr": "a + 1", "inputs": {"a": a["id"]}}).json()
    cleanup.append(first["id"])
    second = admin.post(f"{BASE}/derived-tags",
                        json={"path": _path(), "expr": "a * 2", "inputs": {"a": first["id"]}})
    assert second.status_code == 201                       # derived tags can feed derived tags
    second = second.json()
    cleanup.append(second["id"])

    loop = admin.patch(f"{BASE}/derived-tags/{first['id']}",
                       json={"expr": "a + c", "inputs": {"a": a["id"], "c": second["id"]}})
    assert loop.status_code == 422 and loop.json()["error"]["code"] == "cycle"

    assert admin.delete(f"{BASE}/derived-tags/{first['id']}").status_code == 409   # second reads it
    assert admin.delete(f"{BASE}/derived-tags/{second['id']}").status_code == 204
    cleanup.remove(second["id"])
    assert admin.delete(f"{BASE}/derived-tags/{first['id']}").status_code == 204
    cleanup.remove(first["id"])


def test_edit_bumps_version_and_is_audited(admin, inputs, cleanup):
    a, b = inputs
    tag = admin.post(f"{BASE}/derived-tags",
                     json={"path": _path(), "expr": "a + 1", "inputs": {"a": a["id"]}}).json()
    cleanup.append(tag["id"])
    same = admin.patch(f"{BASE}/derived-tags/{tag['id']}", json={"name": "renamed"}).json()
    assert same["version"] == 1 and same["name"] == "renamed"
    new = admin.patch(f"{BASE}/derived-tags/{tag['id']}",
                      json={"expr": "a + b", "inputs": {"a": a["id"], "b": b["id"]}}).json()
    assert new["version"] == 2
    audit = admin.get(f"/api/v1/orgs/{ORG_ID}/audit?format=json&action=formula.changed&limit=500").json()
    rows = [r for r in audit["items"] if r["target"].get("tag_id") == tag["id"]]
    assert {r["detail"]["action"] for r in rows} >= {"created", "updated"}
    upd = next(r for r in rows if r["detail"]["action"] == "updated")
    assert upd["detail"]["old_expr"] == "a + 1" and upd["detail"]["new_expr"] == "a + b"


def test_path_must_be_valid_and_unique(admin, inputs, cleanup):
    a, _ = inputs
    assert admin.post(f"{BASE}/derived-tags", json={"path": "Bad Path", "expr": "a",
                                                    "inputs": {"a": a["id"]}}).status_code == 422
    p = _path()
    first = admin.post(f"{BASE}/derived-tags", json={"path": p, "expr": "a", "inputs": {"a": a["id"]}})
    assert first.status_code == 201
    cleanup.append(first.json()["id"])
    dup = admin.post(f"{BASE}/derived-tags", json={"path": p, "expr": "a", "inputs": {"a": a["id"]}})
    assert dup.status_code == 409
