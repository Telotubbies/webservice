"""Cameras inside the edge cfg payload (plan M1-03 Task 3)."""

import uuid

from app.datasources.publisher import cfg_payload
from app.vision.cameras import camera_cfg, camera_json
from app.vision.videos import media_sig

EDGE = uuid.uuid4()


def _row(**kw):
    base = {"id": uuid.uuid4(), "org_id": uuid.uuid4(), "site_id": uuid.uuid4(), "edge_id": EDGE,
            "name": "cam1", "kind": "rtsp", "rtsp_url_enc": b"x", "video_id": None, "fps_sample": 5.0,
            "enabled": True, "status": "unknown", "status_detail": None, "status_at": None,
            "created_at": None, "updated_at": None, "material": None}
    base.update(kw)
    return base


def test_camera_json_never_exposes_rtsp_url():
    j = camera_json(_row(created_at=__import__("datetime").datetime(2026, 1, 1),
                         updated_at=__import__("datetime").datetime(2026, 1, 1)))
    assert j["has_rtsp_url"] is True
    assert "rtsp_url_enc" not in j and "rtsp_url" not in j


def test_camera_cfg_rtsp_carries_opened_url():
    c = camera_cfg(_row(), rtsp_url="rtsp://u:p@10.0.0.9/s", video=None, base_url="http://b")
    assert c["kind"] == "rtsp" and c["rtsp_url"] == "rtsp://u:p@10.0.0.9/s" and "video" not in c
    assert c["fps_sample"] == 5.0 and c["enabled"] is True


def test_camera_cfg_upload_has_signed_url_and_hash():
    vid = uuid.uuid4()
    sha = "a" * 64
    c = camera_cfg(_row(kind="upload", rtsp_url_enc=None, video_id=vid), rtsp_url=None,
                   video={"size_bytes": 99, "sha256": sha}, base_url="http://b")
    sig = media_sig(EDGE, vid, sha)
    assert c["video"] == {"url": f"http://b/api/v1/edge-media/{vid}?edge={EDGE}&sig={sig}",
                          "sha256": sha, "size_bytes": 99}
    assert "rtsp_url" not in c


def test_cfg_payload_includes_cameras_and_defaults_empty():
    assert cfg_payload(3, [], {})["cameras"] == []
    cams = [{"id": "c1"}]
    assert cfg_payload(3, [], {}, cameras=cams)["cameras"] == cams


def test_camera_cfg_carries_model_block_when_pinned():
    blk = {"version_id": "v", "url": "http://b/x"}
    c = camera_cfg(_row(), rtsp_url="rtsp://h/s", video=None, base_url="http://b", model=blk)
    assert c["model"] == blk
    assert "model" not in camera_cfg(_row(), rtsp_url="rtsp://h/s", video=None, base_url="http://b")


def test_material_settings_ride_the_cfg_only_when_enabled():
    on = {"enabled": True, "dry_run": True, "conf": 0.3}
    assert camera_cfg(_row(material=on), rtsp_url="rtsp://h/s", video=None, base_url="http://b")["material"] == on
    off = camera_cfg(_row(material={"enabled": False}), rtsp_url="rtsp://h/s", video=None, base_url="http://b")
    assert "material" not in off
    assert "material" not in camera_cfg(_row(), rtsp_url="rtsp://h/s", video=None, base_url="http://b")
