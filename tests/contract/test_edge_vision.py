"""Edge vision runtime: sampler, JPEG cap, runner diffing, failure isolation (plan M1-03 T4)."""

from __future__ import annotations

import hashlib
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from edge_bridge.vision.runner import VisionRunner, download_to_cache  # noqa: E402
from edge_bridge.vision.source import FileSource, encode_jpeg  # noqa: E402


def _make_video(path: Path, frames=20, fps=10, size=(160, 120)) -> Path:
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(frames):
        img = np.full((size[1], size[0], 3), (i * 10) % 255, np.uint8)
        w.write(img)
    w.release()
    return path


def _wait(cond, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture()
def video(tmp_path):
    return _make_video(tmp_path / "v.mp4")


class Sink:
    def __init__(self):
        self.frames: dict[str, list[bytes]] = {}
        self.stats: list[dict] = []
        self.lock = threading.Lock()

    def frame(self, camera_id, jpeg):
        with self.lock:
            self.frames.setdefault(camera_id, []).append(jpeg)

    def stat(self, doc):
        with self.lock:
            self.stats.append(doc)

    def count(self, camera_id):
        with self.lock:
            return len(self.frames.get(camera_id, []))


def _cam(video: Path, cid="c1", fps=10.0, **kw):
    data = video.read_bytes()
    return {"id": cid, "name": cid, "kind": "upload", "fps_sample": fps, "enabled": True,
            "video": {"url": "http://x/y", "sha256": hashlib.sha256(data).hexdigest(),
                      "size_bytes": len(data)}, **kw}


def _runner(sink, video: Path, tmp_path, **kw):
    def fetch(url, sha256, size_bytes, dest_dir):   # local stand-in for the HTTP download
        return video
    return VisionRunner(publish_frame=sink.frame, publish_stat=sink.stat, state_dir=tmp_path,
                        fetch=kw.pop("fetch", fetch), stat_period_s=0.2, **kw)


def test_file_source_loops_past_end(video):
    src = FileSource(video, fps_sample=10.0)
    try:
        frames = [src.read() for _ in range(35)]   # clip has 20 frames
    finally:
        src.close()
    assert all(f is not None for f in frames)


def test_sampler_respects_fps(video, tmp_path):
    sink = Sink()
    r = _runner(sink, video, tmp_path)
    r.apply([_cam(video, fps=2.0)])
    try:
        time.sleep(3.2)
    finally:
        r.stop()
    n = sink.count("c1")
    assert 4 <= n <= 9, n      # ~2 fps over ~3 s, plus startup slack


def test_encode_jpeg_downscales_and_caps_size():
    big = np.random.randint(0, 255, (1080, 1920, 3), np.uint8)
    out = encode_jpeg(big, max_w=960, quality=70)
    # noise does not compress: either it fits the cap and is <= 960 px wide, or it is dropped
    if out is not None:
        assert len(out) <= 100_000
        assert cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR).shape[1] <= 960
    smooth = np.full((720, 1280, 3), 90, np.uint8)
    out = encode_jpeg(smooth)
    assert out is not None and cv2.imdecode(np.frombuffer(out, np.uint8), 1).shape[1] == 960


def test_runner_apply_diff_starts_and_stops(video, tmp_path):
    sink = Sink()
    r = _runner(sink, video, tmp_path)
    try:
        r.apply([_cam(video, "a"), _cam(video, "b")])
        assert _wait(lambda: sink.count("a") and sink.count("b"))
        r.apply([_cam(video, "a")])                       # b removed
        time.sleep(0.4)
        nb = sink.count("b")
        time.sleep(0.8)
        assert sink.count("b") == nb and sink.count("a") > 0
        r.apply([_cam(video, "a", enabled=False)])        # a disabled
        time.sleep(0.4)
        na = sink.count("a")
        time.sleep(0.8)
        assert sink.count("a") == na
    finally:
        r.stop()


def test_missing_video_sets_error_status_not_raise(video, tmp_path):
    sink = Sink()

    def boom(*a, **k):
        raise OSError("video gone")
    r = _runner(sink, video, tmp_path, fetch=boom)
    try:
        r.apply([_cam(video, "bad"), {"id": "junk"}])     # malformed entry must not raise either
        assert _wait(lambda: any(s.get("bad", {}).get("status") == "error" for s in sink.stats))
        detail = next(s["bad"]["detail"] for s in sink.stats if s.get("bad", {}).get("status") == "error")
        assert "video gone" in detail
    finally:
        r.stop()


def test_rtsp_unreachable_reports_error_and_backs_off(tmp_path):
    sink = Sink()
    r = VisionRunner(publish_frame=sink.frame, publish_stat=sink.stat, state_dir=tmp_path,
                     fetch=None, stat_period_s=0.2)
    try:
        r.apply([{"id": "r1", "name": "r1", "kind": "rtsp", "fps_sample": 5, "enabled": True,
                  "rtsp_url": "rtsp://127.0.0.1:9/none"}])
        assert _wait(lambda: any(s.get("r1", {}).get("status") == "error" for s in sink.stats), 20)
        d = next(s["r1"]["detail"] for s in sink.stats if s.get("r1", {}).get("status") == "error")
        assert "s3cr3t" not in d
    finally:
        r.stop()


def test_rtsp_credentials_never_in_status(tmp_path):
    sink = Sink()
    r = VisionRunner(publish_frame=sink.frame, publish_stat=sink.stat, state_dir=tmp_path,
                     fetch=None, stat_period_s=0.2)
    try:
        r.apply([{"id": "r2", "name": "r2", "kind": "rtsp", "fps_sample": 5, "enabled": True,
                  "rtsp_url": "rtsp://admin:s3cr3t@127.0.0.1:9/none"}])
        assert _wait(lambda: any(s.get("r2", {}).get("status") == "error" for s in sink.stats), 20)
        assert "s3cr3t" not in repr(sink.stats)
    finally:
        r.stop()


def test_sha_mismatch_rejected(tmp_path):
    import http.server
    import socketserver

    body = b"not the file you were promised"

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    with socketserver.TCPServer(("127.0.0.1", 0), H) as srv:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/v"
        with pytest.raises(ValueError, match="sha256"):
            download_to_cache(url, "0" * 64, len(body), tmp_path)
        ok = download_to_cache(url, hashlib.sha256(body).hexdigest(), len(body), tmp_path)
        assert ok.read_bytes() == body
        srv.shutdown()
