"""Camera model pin, class config, presets, and the model block in the pushed cfg."""

import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, EDGE_UUID, ORG_ID, VIEWER_TOKEN  # noqa: E402
from onnx_fixtures import detect_onnx  # noqa: E402

VM = f"/api/v1/orgs/{ORG_ID}/vision/models"
CAMS = f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/cameras"


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")

    class _Wait429(httpx.HTTPTransport):
        """The per-user mutation bucket (60/min) is shared by every test in the
        run; wait out a drained bucket instead of failing on someone else's burst."""

        def handle_request(self, request):
            for _ in range(3):
                r = super().handle_request(request)
                if r.status_code != 429:
                    return r
                r.close()
                time.sleep(min(int(r.headers.get("retry-after", "2")) + 1, 30))
            return super().handle_request(request)

    return httpx.Client(base_url=base_url, timeout=30.0, transport=_Wait429(),
                        headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def admin_api(base_url):
    with _client(base_url, ADMIN_TOKEN) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    with _client(base_url, VIEWER_TOKEN) as c:
        yield c


def _active_version(c, model_id, names="{0: 'person', 1: 'bicycle', 2: 'car'}"):
    v = c.post(f"{VM}/{model_id}/versions", params={"filename": "m.onnx"}, content=detect_onnx(names)).json()["version"]
    assert c.post(f"{VM}/{model_id}/versions/{v['id']}/activate", json={"attest": True}).status_code == 200
    return v


@pytest.fixture()
def rig(admin_api):
    """model + active v1 + an rtsp camera; everything removed afterwards."""
    m = admin_api.post(VM, json={"name": f"pin-{uuid.uuid4().hex[:8]}", "task": "detect"}).json()["model"]
    v1 = _active_version(admin_api, m["id"])
    cam = admin_api.post(CAMS, json={"name": f"pin-{uuid.uuid4().hex[:6]}", "kind": "rtsp",
                                     "rtsp_url": "rtsp://10.2.2.2/s"}).json()["camera"]
    url = f"/api/v1/orgs/{ORG_ID}/cameras/{cam['id']}"
    yield m, v1, cam, url
    admin_api.delete(f"{url}/model")
    admin_api.delete(f"{CAMS}/{cam['id']}")
    for v in admin_api.get(f"{VM}/{m['id']}/versions").json()["items"]:
        admin_api.post(f"{VM}/{m['id']}/versions/{v['id']}/archive")
    admin_api.delete(f"{VM}/{m['id']}")


def test_pin_requires_active_version(admin_api, rig):
    m, v1, cam, url = rig
    draft = admin_api.post(f"{VM}/{m['id']}/versions", params={"filename": "d.onnx"}, content=detect_onnx()).json()["version"]
    assert admin_api.put(f"{url}/model", json={"model_version_id": draft["id"]}).status_code == 409
    assert admin_api.put(f"{url}/model", json={"model_version_id": str(uuid.uuid4())}).status_code == 404
    assert admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]}).status_code == 200


def test_pin_bumps_config_and_defaults_cover_classes(admin_api, rig):
    m, v1, cam, url = rig
    before = admin_api.patch(f"{CAMS}/{cam['id']}", json={"fps_sample": 4}).json()["config_version"]
    r = admin_api.put(f"{url}/model", json={"model_version_id": v1["id"], "placement": "edge"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["config_version"] > before and body["placement"] == "edge"
    assert sorted(body["class_config"]) == ["0", "1", "2"]
    got = admin_api.get(f"{url}/model").json()
    assert got["model_version_id"] == v1["id"] and got["classes"] == ["person", "bicycle", "car"]


def test_class_config_patch_validates_and_persists(admin_api, rig):
    m, v1, cam, url = rig
    admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]})
    ok = admin_api.patch(f"{url}/classes", json={"class_config": {"1": {"enabled": False, "min_score": 0.6, "alert": True}}})
    assert ok.status_code == 200 and ok.json()["class_config"]["1"]["enabled"] is False
    assert admin_api.patch(f"{url}/classes", json={"class_config": {"9": {}}}).status_code == 422
    assert admin_api.patch(f"{url}/classes", json={"class_config": {"0": {"min_score": 2}}}).status_code == 422
    assert admin_api.get(f"{url}/model").json()["class_config"]["1"]["min_score"] == 0.6


def test_upgrade_keeps_settings_for_surviving_ids(admin_api, rig):
    m, v1, cam, url = rig
    admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]})
    admin_api.patch(f"{url}/classes", json={"class_config": {"0": {"min_score": 0.7}, "1": {"min_score": 0.6}}})
    v2 = _active_version(admin_api, m["id"], "{0: 'person', 1: 'bike', 2: 'car', 3: 'bus'}")
    r = admin_api.put(f"{url}/model", json={"model_version_id": v2["id"]})
    assert r.status_code == 200
    cfg = r.json()["class_config"]
    assert cfg["0"]["min_score"] == 0.7 and cfg["1"]["min_score"] == 0.25 and sorted(cfg) == ["0", "1", "2", "3"]
    assert r.json()["diff"] == {"added": [3], "removed": [], "renamed": [1]}


def test_cross_org_version_404_and_viewer_403(admin_api, viewer_api, rig):
    m, v1, cam, url = rig
    assert viewer_api.get(f"{url}/model").status_code == 404 or viewer_api.get(f"{url}/model").status_code == 200
    assert viewer_api.put(f"{url}/model", json={"model_version_id": v1["id"]}).status_code == 403
    other = f"/api/v1/orgs/{uuid.uuid4()}/cameras/{cam['id']}/model"
    assert viewer_api.get(other).status_code == 404


def test_archived_version_cannot_be_pinned_and_pinned_cannot_archive(admin_api, rig):
    m, v1, cam, url = rig
    admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]})
    assert admin_api.post(f"{VM}/{m['id']}/versions/{v1['id']}/archive").status_code == 409     # pinned
    assert admin_api.delete(f"{VM}/{m['id']}").status_code == 409
    admin_api.delete(f"{url}/model")
    assert admin_api.post(f"{VM}/{m['id']}/versions/{v1['id']}/archive").status_code == 200
    assert admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]}).status_code == 409


def test_preset_roundtrip(admin_api, rig):
    m, v1, cam, url = rig
    admin_api.put(f"{url}/model", json={"model_version_id": v1["id"]})
    admin_api.patch(f"{url}/classes", json={"class_config": {"2": {"enabled": False}}})
    cfg = admin_api.get(f"{url}/model").json()["class_config"]
    p = admin_api.post(f"{VM}/{m['id']}/presets", json={"name": "QC line A", "class_config": cfg})
    assert p.status_code == 201, p.text
    pid = p.json()["preset"]["id"]
    assert admin_api.post(f"{VM}/{m['id']}/presets", json={"name": "QC line A", "class_config": cfg}).status_code == 409
    admin_api.patch(f"{url}/classes", json={"class_config": {"2": {"enabled": True}}})
    r = admin_api.post(f"{url}/classes/apply-preset", json={"preset_id": pid})
    assert r.status_code == 200 and r.json()["class_config"]["2"]["enabled"] is False
    assert [x["id"] for x in admin_api.get(f"{VM}/{m['id']}/presets").json()["items"]] == [pid]
    assert admin_api.delete(f"{VM}/{m['id']}/presets/{pid}").status_code == 204
