"""Container sniffing and edge-media signatures (plan M1-03 Task 2)."""

import uuid

from app.vision.videos import media_sig, sniff_container

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 20


def test_sniff_accepts_mp4_and_webm():
    assert sniff_container(MP4) == "video/mp4"
    assert sniff_container(WEBM) == "video/webm"


def test_sniff_rejects_exe_html_and_short():
    for head in (b"MZ\x90\x00" + b"\x00" * 60, b"<html><body>hi</body></html>", b"", b"ftyp"):
        assert sniff_container(head) is None


def test_media_sig_bound_to_edge_video_and_hash():
    e, v = uuid.uuid4(), uuid.uuid4()
    s = media_sig(e, v, "a" * 64)
    assert s == media_sig(e, v, "a" * 64)
    assert s != media_sig(uuid.uuid4(), v, "a" * 64)
    assert s != media_sig(e, uuid.uuid4(), "a" * 64)
    assert s != media_sig(e, v, "b" * 64)
