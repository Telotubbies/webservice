"""Plant models: upload validation, roles, mapping validation, activation."""

import json
import struct

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, SITE_ID, VIEWER_TOKEN  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/plant-models"
RUN = "sort/line1/motor1/running"      # writable bool (sim seed)
LEVEL = "sort/line1/bin1/level_pct"    # read-only number


def glb_bytes(nodes=3):
    body = json.dumps({"asset": {"version": "2.0"}, "nodes": [{}] * nodes}).encode()
    body += b" " * (-len(body) % 4)
    chunk = struct.pack("<II", len(body), 0x4E4F534A) + body
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunk)) + chunk


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=30.0, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def admin_api(base_url):
    with _client(base_url, ADMIN_TOKEN) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    with _client(base_url, VIEWER_TOKEN) as c:
        yield c


@pytest.fixture()
def model(admin_api):
    # the dev site may already have a real active model: put it back afterwards
    before = admin_api.get(f"{BASE}/active").json()["model"]
    r = admin_api.post(BASE, params={"filename": "t.glb"}, content=glb_bytes())
    assert r.status_code == 201, r.text
    m = r.json()["model"]
    yield m
    admin_api.delete(f"{BASE}/{m['id']}")
    if before:
        admin_api.post(f"{BASE}/{before['id']}/activate")


def test_upload_roundtrip_and_download(admin_api, model):
    assert model["node_count"] == 3 and len(model["sha256"]) == 64
    assert model["id"] in [x["id"] for x in admin_api.get(BASE).json()["items"]]
    f = admin_api.get(f"{BASE}/{model['id']}/file")
    assert f.status_code == 200 and f.content == glb_bytes()


def test_upload_rejects_non_glb_422(admin_api):
    assert admin_api.post(BASE, content=b"MZ\x90\x00" + b"\x00" * 64).status_code == 422


def test_viewer_reads_but_cannot_write(viewer_api, admin_api, model):
    assert viewer_api.get(BASE).status_code == 200
    assert viewer_api.post(BASE, content=glb_bytes()).status_code == 403
    assert viewer_api.put(f"{BASE}/{model['id']}/parts", json={"parts": []}).status_code == 403
    assert viewer_api.delete(f"{BASE}/{model['id']}").status_code == 403


def test_nonmember_gets_404(viewer_api):
    import uuid
    assert viewer_api.get(f"/api/v1/orgs/{uuid.uuid4()}/sites/{SITE_ID}/plant-models").status_code == 404


def test_mapping_validation(admin_api, model):
    url = f"{BASE}/{model['id']}/parts"

    def put(**part):
        body = {"label": "Drive", "kind": "motor", "nodes": [0], "bindings": {}}
        body.update(part)
        return admin_api.put(url, json={"parts": [body]})

    ok = put(bindings={"run": RUN})
    assert ok.status_code == 200, ok.text
    assert ok.json()["parts"][0]["bindings"] == {"run": RUN}
    assert put(kind="spaceship").status_code == 422
    assert put(nodes=[99]).status_code == 422                       # out of range
    assert put(bindings={"nope": RUN}).status_code == 422            # role not on kind
    assert put(bindings={"run": "no/such/tag"}).status_code == 422   # unknown tag
    assert put(bindings={"run": LEVEL}).status_code == 422           # wrong type + read-only
    dup = admin_api.put(url, json={"parts": [
        {"label": "A", "kind": "motor", "nodes": [0]}, {"label": "A", "kind": "pump", "nodes": [1]}]})
    assert dup.status_code == 422


def test_params_roundtrip_and_validation(admin_api, model):
    url = f"{BASE}/{model['id']}/parts"
    good = admin_api.put(url, json={"parts": [
        {"label": "Skip", "kind": "slider", "nodes": [0], "params": {"dir": [1, 1, 0], "dist": 30}},
        {"label": "Air line", "kind": "pipe", "nodes": [1, 2], "params": {"color": "air"}}]})
    assert good.status_code == 200, good.text
    by = {p["label"]: p for p in good.json()["parts"]}
    assert by["Skip"]["params"] == {"dir": [1.0, 1.0, 0.0], "dist": 30.0}
    assert by["Air line"]["params"] == {"color": "air"}
    bad = admin_api.put(url, json={"parts": [{"label": "X", "kind": "motor", "nodes": [0], "params": {"axis": "q"}}]})
    assert bad.status_code == 422


def test_active_model_and_activate(admin_api, model):
    admin_api.put(f"{BASE}/{model['id']}/parts", json={"parts": [
        {"label": "Bin", "kind": "vessel", "nodes": [1, 2], "bindings": {"level": LEVEL}}]})
    r = admin_api.post(f"{BASE}/{model['id']}/activate")
    assert r.status_code == 200 and r.json()["model"]["active"] is True
    a = admin_api.get(f"{BASE}/active").json()
    assert a["model"]["id"] == model["id"]
    assert a["parts"][0]["nodes"] == [1, 2]


def test_kinds_catalog(admin_api):
    k = admin_api.get("/api/v1/plant-kinds").json()["kinds"]
    assert {"motor", "conveyor", "vessel", "valve", "pump", "mixer", "indicator"} <= set(k)


def test_sim_tags_create_idempotent_and_validated(admin_api, viewer_api):
    import uuid
    from conftest import EDGE_UUID
    base = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/plant-sim-tags"
    dev = "t_" + uuid.uuid4().hex[:8]
    run, flow = f"auto/{dev}/running", f"auto/{dev}/flow_lpm"
    body = {"tags": [
        {"path": run, "type": "bool", "writable": True, "behavior": "state", "initial": False},
        {"path": flow, "type": "number", "unit": "L/min", "behavior": "follow",
         "follows": run, "gain": 120.0, "lag": 1.5, "initial": 0}]}
    try:
        assert viewer_api.post(base, json=body).status_code == 403
        r = admin_api.post(base, json=body)
        assert r.status_code == 201, r.text
        assert sorted(r.json()["created"]) == sorted([run, flow])
        again = admin_api.post(base, json=body).json()
        assert again["created"] == [] and sorted(again["existing"]) == sorted([run, flow])
        # bad path, unknown follows target
        assert admin_api.post(base, json={"tags": [{"path": "batch/x/y", "type": "bool"}]}).status_code in (400, 422)
        bad = {"tags": [{"path": f"auto/{dev}/x", "type": "number", "behavior": "follow",
                         "follows": "auto/nope/none"}]}
        assert admin_api.post(base, json=bad).status_code == 422
        # usable in a mapping
        m = admin_api.post(BASE, params={"filename": "t.glb"}, content=glb_bytes()).json()["model"]
        try:
            ok = admin_api.put(f"{BASE}/{m['id']}/parts", json={"parts": [
                {"label": "Pump", "kind": "pump", "nodes": [0], "bindings": {"run": run, "flow": flow}}]})
            assert ok.status_code == 200, ok.text
        finally:
            admin_api.delete(f"{BASE}/{m['id']}")
    finally:
        root = f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/sources"
        srcs = admin_api.get(root).json()["items"]
        src = next((s for s in srcs if s["name"] == "Auto plant (sim)"), None)
        if src:
            for t in admin_api.get(f"{root}/{src['id']}/tags").json()["items"]:
                if f"/{dev}/" in t["path"]:
                    admin_api.delete(f"{root}/{src['id']}/tags/{t['id']}")
