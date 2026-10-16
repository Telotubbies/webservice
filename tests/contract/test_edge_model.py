"""Edge side of gateway inference: model client, class filter, overlay, failure isolation (plan M1-05 Task 3)."""

from __future__ import annotations

import http.server
import json
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

import base64  # noqa: E402

from edge_bridge import ops  # noqa: E402
from edge_bridge.vision.detector import ModelDetector, ModelNotReady, NullDetector  # noqa: E402
from edge_bridge.vision.modelclient import ModelClient, ModelServerError  # noqa: E402
from edge_bridge.vision.overlay import draw_overlay  # noqa: E402
from edge_bridge.vision.runner import VisionRunner  # noqa: E402

RED, GREEN = "#ff0000", "#00ff00"


def _cfg(**over):
    base = {"0": {"enabled": True, "names": {"en": "person", "th": "person"}, "min_score": 0.6, "colour": RED, "alert": False},
            "1": {"enabled": True, "names": {"en": "bus", "th": "bus"}, "min_score": 0.25, "colour": GREEN, "alert": False}}
    for k, v in over.items():
        base[k] = {**base[k], **v}
    return base


def _model(**kw):
    m = {"version_id": "11111111-1111-1111-1111-111111111111", "sha256": "a" * 64, "size_bytes": 10, "task": "detect",
         "imgsz": 640, "classes": ["person", "bus"], "class_config": _cfg(), "placement": "edge",
         "url": "http://backend/x"}
    m.update(kw)
    return m


class FakeServer:
    """A model server that records requests; `dets` is what infer returns."""

    def __init__(self, dets=None, load_fails=None, ready_after=0):
        self.puts, self.infers, self.loaded, self.dets = [], [], set(), dets or []
        self.load_fails, self.ready_after, self.health_calls = load_fails, ready_after, 0
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def _send(self, code, doc):
                b = json.dumps(doc).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                outer.health_calls += 1
                failed = {k: outer.load_fails for k in outer.puts_ids()} if outer.load_fails else {}
                loaded = [] if outer.health_calls <= outer.ready_after else [v for v in outer.loaded]
                self._send(200, {"loaded": loaded, "failed": failed, "loading": [], "providers": ["CPUExecutionProvider"],
                                 "engines": {v: "CPUExecutionProvider" for v in loaded}})

            def do_PUT(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                vid = self.path.rsplit("/", 1)[1]
                outer.puts.append((vid, body))
                if not outer.load_fails:
                    outer.loaded.add(vid)
                self._send(202, {"state": "loading"})

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                q = parse_qs(urlsplit(self.path).query)
                if self.path.startswith("/v1/benchmark"):
                    return self._send(200, {"fps": 12.0, "ms_p50": 80.0, "ms_p95": 95.0, "provider": "CPUExecutionProvider"})
                outer.infers.append({k: v[0] for k, v in q.items()})
                self._send(200, {"model": q["model"][0], "ms": 7.5, "detections": outer.dets})

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def puts_ids(self):
        return [v for v, _ in self.puts]

    def stop(self):
        self.srv.shutdown()


@pytest.fixture()
def server():
    s = FakeServer()
    yield s
    s.stop()


def _det(cid, score, box=(0.1, 0.1, 0.3, 0.3), poly=None):
    d = {"class_id": cid, "class": ["person", "bus"][cid], "score": score, "bbox": list(box)}
    if poly:
        d["polygon"] = poly
    return d


def _frame():
    return np.zeros((240, 320, 3), np.uint8)


def test_ensure_puts_once_per_version(server):
    c = ModelClient(server.url)
    m = _model()
    states = [c.ensure(m) for _ in range(3)]
    assert states[-1] == "loaded" and len(server.puts) == 1
    vid, body = server.puts[0]
    assert vid == m["version_id"] and body["sha256"] == "a" * 64 and body["classes"] == ["person", "bus"]
    assert body["url"] == "http://backend/x" and body["task"] == "detect" and body["imgsz"] == 640


def test_ensure_reports_failed_reason(server):
    server.load_fails = "sha256 mismatch"
    c = ModelClient(server.url)
    assert c.ensure(_model()).startswith("failed:") and "sha256 mismatch" in c.ensure(_model())


def test_filter_uses_enabled_ids_and_per_class_score(server):
    server.dets = [_det(0, 0.5), _det(0, 0.7), _det(1, 0.9)]
    cfg = _cfg(**{"1": {"enabled": False}})
    det = ModelDetector(ModelClient(server.url), _model(class_config=cfg))
    out = det.detect(_frame())
    assert [(d["class_id"], d["score"]) for d in out] == [(0, 0.7)]          # person<0.6 dropped, bus disabled
    q = server.infers[-1]
    assert q["classes"] == "0" and float(q["conf"]) == pytest.approx(0.6)    # lowest enabled min score


def test_detector_not_ready_raises_for_runner_to_fall_back(server):
    server.ready_after = 10**6                         # never reports loaded
    det = ModelDetector(ModelClient(server.url), _model())
    with pytest.raises(ModelNotReady):
        det.detect(_frame())
    assert det.state == "loading" and server.infers == []


def test_no_enabled_class_skips_inference(server):
    cfg = _cfg(**{"0": {"enabled": False}, "1": {"enabled": False}})
    det = ModelDetector(ModelClient(server.url), _model(class_config=cfg))
    assert det.detect(_frame()) == [] and server.infers == []


def test_overlay_draws_box_and_polygon():
    f = _frame()
    out = draw_overlay(f, [_det(0, 0.9, (0.1, 0.2, 0.3, 0.4)),
                           _det(1, 0.8, (0.6, 0.2, 0.2, 0.3), poly=[[0.6, 0.2], [0.8, 0.2], [0.7, 0.5]])], _cfg())
    assert out is not f and f.sum() == 0                                   # input frame untouched
    red = (out[:, :, 2] == 255) & (out[:, :, 1] == 0) & (out[:, :, 0] == 0)
    green = (out[:, :, 1] > 100) & (out[:, :, 2] < 120)
    assert red.any() and green.any()                                       # person box red, bus polygon green tint


def test_disabled_class_absent_from_overlay(server):
    server.dets = [_det(0, 0.9), _det(1, 0.9, (0.6, 0.6, 0.2, 0.2))]
    cfg = _cfg(**{"0": {"min_score": 0.25}, "1": {"enabled": False}})
    det = ModelDetector(ModelClient(server.url), _model(class_config=cfg))
    out = draw_overlay(_frame(), det.detect(_frame()), cfg)
    assert ((out[:, :, 2] == 255) & (out[:, :, 1] == 0)).any()
    assert not ((out[:, :, 1] > 100) & (out[:, :, 2] < 120)).any()          # no green pixels: bus is off


# --------------------------------------------------------- runner behaviour
def _video(tmp_path):
    p = tmp_path / "v.mp4"
    w = cv2.VideoWriter(str(p), cv2.VideoWriter_fourcc(*"mp4v"), 10, (160, 120))
    for i in range(20):
        w.write(np.full((120, 160, 3), (i * 10) % 255, np.uint8))
    w.release()
    return p


class Sink:
    def __init__(self):
        self.frames, self.stats, self.lock = {}, [], threading.Lock()

    def frame(self, cid, jpeg):
        with self.lock:
            self.frames.setdefault(cid, []).append(jpeg)

    def stat(self, doc):
        with self.lock:
            self.stats.append(doc)


def _wait(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def _runner(sink, tmp_path, client, **kw):
    import hashlib
    video = _video(tmp_path)

    def fetch(url, sha256, size_bytes, dest_dir):
        return video

    r = VisionRunner(publish_frame=sink.frame, publish_stat=sink.stat, state_dir=tmp_path, fetch=fetch,
                     detector_factory=lambda cam: ModelDetector(client, cam["model"]) if cam.get("model") else NullDetector(),
                     stat_period_s=0.2, **kw)
    data = video.read_bytes()
    cam = {"id": "c1", "name": "c1", "kind": "upload", "fps_sample": 10.0, "enabled": True,
           "video": {"url": "http://x/y", "sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)}}
    return r, cam


def test_failed_load_reports_error_and_frames_stay_raw(server, tmp_path):
    server.load_fails = "model could not be loaded: bad opset"
    sink = Sink()
    r, cam = _runner(sink, tmp_path, ModelClient(server.url))
    try:
        r.apply([{**cam, "model": _model()}])
        assert _wait(lambda: len(sink.frames.get("c1", [])) >= 3)                      # raw frames keep flowing
        assert _wait(lambda: any(s.get("c1", {}).get("model_state") == "error" for s in sink.stats))
        st = next(s["c1"] for s in sink.stats if s.get("c1", {}).get("model_state") == "error")
        assert "bad opset" in st["model_detail"] and st["status"] == "ok"
    finally:
        r.stop()


def test_server_down_does_not_stop_frames(tmp_path):
    sink = Sink()
    r, cam = _runner(sink, tmp_path, ModelClient("http://127.0.0.1:9", timeout=0.5))
    try:
        r.apply([{**cam, "model": _model()}])
        assert _wait(lambda: len(sink.frames.get("c1", [])) >= 3)
        assert _wait(lambda: any(s.get("c1", {}).get("model_state") in ("error", "loading") for s in sink.stats))
    finally:
        r.stop()


def test_ready_model_reports_engine_latency_and_benchmark(server, tmp_path):
    server.dets = [_det(0, 0.9)]
    sink = Sink()
    r, cam = _runner(sink, tmp_path, ModelClient(server.url))
    try:
        r.apply([{**cam, "model": _model()}])
        assert _wait(lambda: any(s.get("c1", {}).get("model_state") == "ready" and s["c1"].get("bench_fps") for s in sink.stats), 15)
        st = next(s["c1"] for s in sink.stats if s.get("c1", {}).get("model_state") == "ready" and s["c1"].get("bench_fps"))
        assert st["engine"] == "CPUExecutionProvider" and st["latency_ms"] > 0 and st["bench_fps"] == 12.0
    finally:
        r.stop()


def test_class_config_change_restarts_the_camera(server, tmp_path):
    server.dets = [_det(0, 0.9)]
    sink = Sink()
    r, cam = _runner(sink, tmp_path, ModelClient(server.url))
    try:
        r.apply([{**cam, "model": _model()}])
        assert _wait(lambda: len(server.infers) >= 2)
        r.apply([{**cam, "model": _model(class_config=_cfg(**{"0": {"enabled": False}}))}])
        time.sleep(1.0)
        n = len(server.infers)
        assert {q["classes"] for q in server.infers[n - 2:]} <= {"1", "0,1"}
        assert all("0" not in q["classes"].split(",") for q in server.infers[-2:])      # person no longer asked for
    finally:
        r.stop()


# --------------------------------------------------------- ensure / deadline (Task 4)
def test_ensure_stays_loading_without_repeated_put(server):
    server.ready_after = 10 ** 6                        # health never reports loaded here
    c = ModelClient(server.url)
    states = [c.ensure(_model()) for _ in range(4)]
    assert all(s == "loading" for s in states)
    assert len(server.puts) == 1                        # one PUT, then idempotent loading


def test_expired_deadline_makes_no_http_call(server):
    c = ModelClient(server.url, deadline=time.monotonic() - 1)
    with pytest.raises(ModelServerError, match="timeout"):
        c.health()
    assert server.health_calls == 0                     # checked before the request goes out


def test_benchmark_runs_off_the_detect_thread(server):
    server.dets = [_det(0, 0.9)]
    client = ModelClient(server.url)
    entered, release = threading.Event(), threading.Event()
    orig = client.benchmark

    def slow(vid, frames=20):
        entered.set()
        release.wait(10)
        return orig(vid, frames)

    client.benchmark = slow
    det = ModelDetector(client, _model())
    try:
        out = det.detect(_frame())                      # inference must not wait for benchmark
        assert out and det.state == "ready"
        assert entered.wait(5)                          # benchmark thread started
        assert det.bench_fps is None                    # still blocked — camera kept going
        release.set()
        assert _wait(lambda: det.bench_fps == 12.0)
    finally:
        release.set()


# --------------------------------------------------------- model_test op
def _jpeg_bytes():
    ok, buf = cv2.imencode(".jpg", _frame())
    assert ok
    return buf.tobytes()


def test_ops_model_test_roundtrip(server):
    res = ops.run("model_test",
                  {"model": _model(), "image_b64": base64.b64encode(_jpeg_bytes()).decode()},
                  model_server_url=server.url)
    assert res["ms"] == 7.5 and res["engine"] == "CPUExecutionProvider"
    assert isinstance(res["detections"], list)
    q = server.infers[-1]
    assert float(q["conf"]) == pytest.approx(0.05) and "classes" not in q   # all classes, floor score


def test_ops_model_test_rejects_bad_images(server):
    bad = ["!!!not-base64!!!",
           base64.b64encode(b"PK\x03\x04" + b"x" * 64).decode(),            # not jpeg/png
           base64.b64encode(b"\xff\xd8\xff" + b"0" * (6 * 1024 * 1024)).decode()]  # decoded >5 MiB
    for payload in bad:
        with pytest.raises(ops.OpError, match="invalid_image"):
            ops.run("model_test", {"model": _model(), "image_b64": payload},
                    model_server_url=server.url)


def test_ops_model_test_loading_uses_the_shared_deadline(server):
    server.ready_after = 10 ** 9                        # never finishes loading
    with pytest.raises(ops.OpError, match="timeout"):
        ops.run("model_test",
                {"model": _model(), "image_b64": base64.b64encode(_jpeg_bytes()).decode()},
                deadline_s=0.4, model_server_url=server.url)


# --------------------------------------------------------- capability reports (Task 4)
class CapsSink:
    def __init__(self):
        self.docs, self.ev = [], threading.Event()

    def __call__(self, doc):
        self.docs.append(doc)
        self.ev.set()


def test_caps_published_with_zero_cameras_and_on_request(server, tmp_path):
    caps = CapsSink()
    r = VisionRunner(publish_frame=lambda *a: None, publish_stat=lambda d: None,
                     state_dir=tmp_path, publish_caps=caps,
                     model_client=ModelClient(server.url), caps_period_s=60.0)
    try:
        assert _wait(lambda: len(caps.docs) >= 1)                       # startup report, no cameras
        doc = caps.docs[0]
        assert doc["cpu_cores"] >= 1 and doc["providers"] == ["CPUExecutionProvider"]
        assert doc["loaded"] == []
        r.request_caps()                                                # reconnect signal republishes
        assert _wait(lambda: len(caps.docs) >= 2, 5)
    finally:
        r.stop()


def test_caps_survives_malformed_health(tmp_path):
    class BadHealth:
        def health(self):
            return "junk"                                               # not a dict at all

    caps = CapsSink()
    r = VisionRunner(publish_frame=lambda *a: None, publish_stat=lambda d: None,
                     state_dir=tmp_path, publish_caps=caps,
                     model_client=BadHealth(), caps_period_s=60.0)
    try:
        assert _wait(lambda: len(caps.docs) >= 1)
        doc = caps.docs[0]
        assert doc["device"] is None and doc["providers"] == [] and doc["loaded"] == []
    finally:
        r.stop()
