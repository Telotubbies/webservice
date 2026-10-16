"""Video upload: sniffing, size cap, roles, in-use delete, edge media download."""

import pytest

pytestmark = pytest.mark.integration

from conftest import ADMIN_TOKEN, EDGE_UUID, ORG_ID, SITE_ID, VIEWER_TOKEN  # noqa: E402

BASE = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/videos"
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 512


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


def _up(c, data=MP4, name="demo.mp4", url=BASE):
    # raw body (no multipart dependency); the filename rides in the query string
    return c.post(url, params={"filename": name}, content=data)


@pytest.fixture()
def video(admin_api):
    r = _up(admin_api)
    assert r.status_code == 201, r.text
    v = r.json()
    yield v
    admin_api.delete(f"{BASE}/{v['id']}")


def test_upload_ok_then_listed(admin_api, video):
    assert video["size_bytes"] == len(MP4) and len(video["sha256"]) == 64
    ids = [v["id"] for v in admin_api.get(BASE).json()["items"]]
    assert video["id"] in ids


def test_upload_rejects_non_video_415(admin_api):
    r = _up(admin_api, b"MZ\x90\x00" + b"\x00" * 100, "evil.mp4")
    assert r.status_code == 415


def test_viewer_cannot_upload_403_nonmember_404(viewer_api, base_url):
    assert _up(viewer_api).status_code == 403
    import uuid
    other = f"/api/v1/orgs/{uuid.uuid4()}/sites/{SITE_ID}/videos"
    assert _up(viewer_api, url=other).status_code == 404


def test_media_download_needs_valid_sig(admin_api, base_url, video, monkeypatch):
    import uuid
    from conftest import REPO
    from app.core import config
    from app.vision.videos import media_sig
    keyfile = REPO / "infra" / "secrets" / "data_source_key"
    if not keyfile.exists():
        pytest.skip("infra/secrets/data_source_key missing (make secrets)")
    # the backend container reads this file; mirror its key derivation
    monkeypatch.setenv("DATA_SOURCE_KEY_FILE", str(keyfile))
    monkeypatch.setattr(config, "DATA_SOURCE_KEY", config._load_data_source_key())
    sig = media_sig(uuid.UUID(EDGE_UUID), uuid.UUID(video["id"]), video["sha256"])
    anon = _client(base_url, "")
    anon.headers.pop("Authorization")
    ok = anon.get(f"/api/v1/edge-media/{video['id']}", params={"edge": EDGE_UUID, "sig": sig})
    assert ok.status_code == 200 and ok.content == MP4
    assert anon.get(f"/api/v1/edge-media/{video['id']}", params={"edge": EDGE_UUID, "sig": "0" * 64}).status_code == 404
    other_edge = str(uuid.uuid4())
    assert anon.get(f"/api/v1/edge-media/{video['id']}", params={"edge": other_edge, "sig": sig}).status_code == 404


def test_upload_too_large_413(admin_api, monkeypatch):
    # the cap is enforced while streaming; a body over MAX_VIDEO_BYTES is cut off
    from app.vision import storage
    big = MP4 + bytes(storage.MAX_VIDEO_BYTES + 1)
    r = _up(admin_api, big)
    assert r.status_code == 413


def test_delete_in_use_409(admin_api, video):
    # a camera (Task 3) pins the video; until it exists the DB constraint is covered in tenancy tests
    pytest.importorskip("app.vision.cameras")
    r = admin_api.post(f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/cameras",
                       json={"name": "pin-test", "kind": "upload", "video_id": video["id"]})
    if r.status_code == 404:
        pytest.skip("camera routes not mounted yet")
    cam = r.json()["camera"]["id"]
    try:
        assert admin_api.delete(f"{BASE}/{video['id']}").status_code == 409
    finally:
        admin_api.delete(f"/api/v1/orgs/{ORG_ID}/edges/{EDGE_UUID}/cameras/{cam}")
