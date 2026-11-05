"""Model registry routes: upload/inspect, classes, activation, roles, pinned deletes, .pt spool."""

import concurrent.futures
import json
import os
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN  # noqa: E402
from onnx_fixtures import NAMES3, detect_onnx, make_onnx  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/vision/models"


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
    r = admin_api.post(BASE, json={"name": f"pytest-{uuid.uuid4().hex[:8]}", "task": "detect"})
    assert r.status_code == 201, r.text
    m = r.json()["model"]
    yield m
    for v in admin_api.get(f"{BASE}/{m['id']}/versions").json()["items"]:
        admin_api.post(f"{BASE}/{m['id']}/versions/{v['id']}/archive")
    admin_api.delete(f"{BASE}/{m['id']}")


def _up(c, model, data, name="m.onnx"):
    return c.post(f"{BASE}/{model['id']}/versions", params={"filename": name}, content=data)


def test_upload_onnx_becomes_draft_with_classes(admin_api, model):
    r = _up(admin_api, model, detect_onnx())
    assert r.status_code == 201, r.text
    v = r.json()["version"]
    assert v["status"] == "draft" and v["classes"] == ["person", "bicycle", "car"]
    assert v["task"] == "detect" and v["imgsz"] == 640 and v["version"] == 1 and len(v["sha256"]) == 64
    assert _up(admin_api, model, detect_onnx()).json()["version"]["version"] == 2


def test_upload_onnx_without_names_needs_classes_then_ok(admin_api, model):
    v = _up(admin_api, model, detect_onnx(names=None)).json()["version"]
    assert v["classes"] is None
    url = f"{BASE}/{model['id']}/versions/{v['id']}"
    assert admin_api.post(f"{url}/activate", json={"attest": True}).status_code == 409   # classes_required
    r = admin_api.post(f"{url}/classes", json={"names": ["ok", "defect"]})
    assert r.status_code == 200 and r.json()["version"]["classes"] == ["ok", "defect"]
    assert admin_api.post(f"{url}/classes", json={"names": ["x"]}).status_code == 409    # immutable once set


def test_wrong_name_count_422_shows_both_counts(admin_api, model):
    v = _up(admin_api, model, detect_onnx(names=None, extra={"nc": "3"})).json()["version"]
    r = admin_api.post(f"{BASE}/{model['id']}/versions/{v['id']}/classes", json={"names": ["a", "b"]})
    assert r.status_code == 422 and "3" in r.text and "2" in r.text


def test_bad_uploads_are_refused_without_a_version(admin_api, model):
    assert _up(admin_api, model, b"not an onnx file at all").status_code == 422
    nms = make_onnx(((1, 84, 8400),), {"names": NAMES3})
    r = _up(admin_api, model, nms)
    assert r.status_code == 422 and "re-export" in r.text.lower()
    seg = make_onnx(((1, 300, 38), (1, 32, 160, 160)), {"names": NAMES3, "task": "segment"})
    assert _up(admin_api, model, seg).status_code == 422                       # task_mismatch (model is detect)
    assert _up(admin_api, model, detect_onnx(), "model.exe").status_code == 415
    assert admin_api.get(f"{BASE}/{model['id']}/versions").json()["items"] == []


def test_activate_requires_attestation(admin_api, model):
    v = _up(admin_api, model, detect_onnx()).json()["version"]
    url = f"{BASE}/{model['id']}/versions/{v['id']}/activate"
    assert admin_api.post(url, json={"attest": False}).status_code == 400
    assert admin_api.post(url, json={}).status_code in (400, 422)
    ok = admin_api.post(url, json={"attest": True})
    assert ok.status_code == 200 and ok.json()["version"]["status"] == "active"
    assert ok.json()["version"]["license_attested_at"]


def test_concurrent_activate_one_wins(admin_api, model, base_url):
    v = _up(admin_api, model, detect_onnx()).json()["version"]
    url = f"{BASE}/{model['id']}/versions/{v['id']}/activate"

    def go(_):
        with _client(base_url, ADMIN_TOKEN) as c:
            return c.post(url, json={"attest": True}).status_code
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        codes = sorted(ex.map(go, range(2)))
    assert codes == [200, 409]


def test_archive_then_delete_and_states(admin_api, model):
    v = _up(admin_api, model, detect_onnx()).json()["version"]
    base = f"{BASE}/{model['id']}/versions/{v['id']}"
    assert admin_api.post(f"{base}/archive").status_code == 409          # draft cannot be archived
    admin_api.post(f"{base}/activate", json={"attest": True})
    assert admin_api.post(f"{base}/archive").status_code == 200
    assert admin_api.post(f"{base}/activate", json={"attest": True}).status_code == 409   # no way back
    assert admin_api.delete(base).status_code == 204


def test_nonmember_404_viewer_403(viewer_api, model):
    assert viewer_api.get(BASE).status_code == 200
    assert viewer_api.post(BASE, json={"name": "x", "task": "detect"}).status_code == 403
    assert _up(viewer_api, model, detect_onnx()).status_code == 403
    assert viewer_api.get(f"/api/v1/orgs/{uuid.uuid4()}/vision/models").status_code == 404
    assert viewer_api.get(f"{BASE}/{uuid.uuid4()}/versions").status_code == 404


def test_pt_upload_queues_job_and_never_becomes_a_model_file(admin_api, model):
    r = _up(admin_api, model, b"\x80\x04\x95 pretend pickle bytes", "weights.pt")
    assert r.status_code == 201, r.text
    v = r.json()["version"]
    assert v["status"] == "processing" and v["source_format"] == "pt" and v["sha256"] is None
    got = admin_api.get(f"{BASE}/{model['id']}/versions/{v['id']}").json()["version"]
    assert got["status"] in ("processing", "failed")        # a converter may already have rejected it
    # a processing version cannot be activated
    assert admin_api.post(f"{BASE}/{model['id']}/versions/{v['id']}/activate", json={"attest": True}).status_code == 409


def test_duplicate_model_name_409(admin_api, model):
    assert admin_api.post(BASE, json={"name": model["name"], "task": "detect"}).status_code == 409
