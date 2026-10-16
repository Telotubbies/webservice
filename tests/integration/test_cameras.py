"""Camera CRUD: roles, same-site edge, write-only RTSP URL, config bump, audit."""

import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, EDGE_UUID, ORG_ID, SITE_ID, VIEWER_TOKEN  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/cameras"
VIDEOS = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/videos"
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 256
SECRET_URL = "rtsp://user:s3cr3tpw@10.9.9.9:554/stream1"


def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=15.0, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture()
def admin_api(base_url):
    with _client(base_url, ADMIN_TOKEN) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    with _client(base_url, VIEWER_TOKEN) as c:
        yield c


@pytest.fixture()
def camera(admin_api):
    r = admin_api.post(BASE, json={"name": f"pytest-{uuid.uuid4().hex[:8]}", "kind": "rtsp",
                                   "rtsp_url": SECRET_URL, "fps_sample": 2})
    assert r.status_code == 201, r.text
    cam = r.json()["camera"]
    yield cam
    admin_api.delete(f"{BASE}/{cam['id']}")


def test_rtsp_url_never_in_api_or_audit(admin_api, camera):
    assert camera["has_rtsp_url"] is True
    assert "s3cr3tpw" not in admin_api.get(BASE).text
    assert "s3cr3tpw" not in admin_api.get(f"/api/v1/orgs/{ORG_ID}/audit").text


def test_create_bumps_config_version(admin_api):
    a = admin_api.post(BASE, json={"name": f"pytest-{uuid.uuid4().hex[:8]}", "kind": "rtsp",
                                   "rtsp_url": "rtsp://10.0.0.1/s"}).json()
    b = admin_api.patch(f"{BASE}/{a['camera']['id']}", json={"fps_sample": 3}).json()
    admin_api.delete(f"{BASE}/{a['camera']['id']}")
    assert b["config_version"] > a["config_version"]


def test_upload_camera_requires_existing_video_422(admin_api):
    r = admin_api.post(BASE, json={"name": "nov", "kind": "upload", "video_id": str(uuid.uuid4())})
    assert r.status_code == 422
    r = admin_api.post(BASE, json={"name": "nov2", "kind": "upload"})
    assert r.status_code == 422


def test_rtsp_requires_rtsp_scheme_422(admin_api):
    for bad in ("http://10.0.0.1/s", "file:///etc/passwd", "rtsp://"):
        r = admin_api.post(BASE, json={"name": "bad", "kind": "rtsp", "rtsp_url": bad})
        assert r.status_code == 422, bad


def test_camera_must_be_same_site_edge(admin_api):
    r = admin_api.post(f"/api/v1/orgs/{ORG_ID}/edges/{uuid.uuid4()}/cameras",
                       json={"name": "x", "kind": "rtsp", "rtsp_url": "rtsp://10.0.0.1/s"})
    assert r.status_code == 404


def test_upload_camera_roundtrip_and_video_in_use(admin_api):
    v = admin_api.post(VIDEOS, params={"filename": "d.mp4"}, content=MP4).json()
    c = admin_api.post(BASE, json={"name": f"pytest-{uuid.uuid4().hex[:8]}", "kind": "upload",
                                   "video_id": v["id"]})
    assert c.status_code == 201, c.text
    cam = c.json()["camera"]
    try:
        assert cam["video_id"] == v["id"] and cam["has_rtsp_url"] is False
        assert admin_api.delete(f"{VIDEOS}/{v['id']}").status_code == 409
    finally:
        admin_api.delete(f"{BASE}/{cam['id']}")
        assert admin_api.delete(f"{VIDEOS}/{v['id']}").status_code == 204


def test_viewer_403_nonmember_404(viewer_api, camera):
    assert viewer_api.get(BASE).status_code == 200
    assert viewer_api.post(BASE, json={"name": "v", "kind": "rtsp", "rtsp_url": "rtsp://1.1.1.1/s"}).status_code == 403
    assert viewer_api.delete(f"{BASE}/{camera['id']}").status_code == 403
    assert viewer_api.get(f"/api/v1/orgs/{uuid.uuid4()}/edges/{EDGE_UUID}/cameras").status_code == 404


def test_duplicate_name_409(admin_api, camera):
    r = admin_api.post(BASE, json={"name": camera["name"], "kind": "rtsp", "rtsp_url": "rtsp://1.1.1.1/s"})
    assert r.status_code == 409
