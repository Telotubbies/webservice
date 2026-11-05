"""model-server: post-processing of YOLO26 outputs and the HTTP contract (plan M1-05 Task 1).
No ONNX Runtime needed: the runtime is a fake behind the same interface."""

from __future__ import annotations

import hashlib
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "model-server"))

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")
pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from server.app import create_app  # noqa: E402
from server.postprocess import (MAX_DETECTIONS, clean, decode_detect, decode_segment,  # noqa: E402
                                letterbox)
from server.store import ModelStore  # noqa: E402

CLASSES = ["person", "bus", "car"]


def _jpeg(w=320, h=240, value=100) -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((h, w, 3), value, np.uint8))
    assert ok
    return buf.tobytes()


# ------------------------------------------------------------- letterbox
def test_letterbox_shape_and_pad():
    img = np.zeros((240, 320, 3), np.uint8)            # 4:3, wider than tall
    t, scale, px, py = letterbox(img, 640)
    assert t.shape == (1, 3, 640, 640) and t.dtype == np.float32 and 0 <= t.min() and t.max() <= 1
    assert scale == 2.0 and px == 0 and py == 80        # 480 tall content centred in 640
    assert np.isclose(t[0, 0, 0, 0], 114 / 255)        # padding is 114 grey


# ---------------------------------------------------------------- detect
def _rows(*rows):
    return np.array([list(rows)], dtype=np.float32)


def test_decode_detect_maps_boxes_to_original_frame():
    # box in 640-letterboxed space for a 320x240 frame: scale 2, pad (0, 80)
    out = _rows([100, 180, 300, 380, 0.9, 0])
    d = decode_detect(out, 2.0, 0, 80, 320, 240, CLASSES, None, 0.25)
    assert len(d) == 1 and d[0]["class"] == "person" and d[0]["class_id"] == 0
    x, y, w, h = d[0]["bbox"]
    close = dict(abs_tol=1e-5)        # float32 model output
    assert math.isclose(x, 50 / 320, **close) and math.isclose(y, 50 / 240, **close)
    assert math.isclose(w, 100 / 320, **close) and math.isclose(h, 100 / 240, **close)


def test_decode_filters_class_and_conf():
    out = _rows([0, 100, 50, 150, 0.9, 0], [0, 100, 50, 150, 0.8, 1], [0, 100, 50, 150, 0.1, 2])
    assert [d["class"] for d in decode_detect(out, 1.0, 0, 0, 640, 640, CLASSES, None, 0.25)] == ["person", "bus"]
    assert [d["class"] for d in decode_detect(out, 1.0, 0, 0, 640, 640, CLASSES, {1}, 0.25)] == ["bus"]


def test_decode_ignores_out_of_range_class_ids():
    out = _rows([0, 0, 10, 10, 0.9, 7])
    assert decode_detect(out, 1.0, 0, 0, 640, 640, CLASSES, None, 0.25) == []


def test_clean_clamps_nan_huge_and_long_strings():
    dets = [{"class_id": 0, "class": "x" * 500, "score": float("nan"), "bbox": [-1, 2, 5, 5]},
            {"class_id": 1, "class": "ok", "score": 7.0, "bbox": [0.1, 0.1, 0.2, 0.2]},
            {"class_id": 2, "class": "bad", "score": 0.5, "bbox": [float("inf"), 0, 1, 1]}]
    out = clean(dets)
    assert all(len(d["class"]) <= 80 for d in out)
    assert all(0.0 <= d["score"] <= 1.0 for d in out)
    assert all(0.0 <= v <= 1.0 for d in out for v in d["bbox"])
    assert not any(d["class"] == "bad" for d in out)             # non-finite box dropped
    many = [{"class_id": 0, "class": "p", "score": 0.5, "bbox": [0, 0, 0.1, 0.1]}] * 10_000
    assert len(clean(many)) == MAX_DETECTIONS


# --------------------------------------------------------------- segment
def test_decode_segment_polygon_capped_at_64_points():
    nm, mh = 4, 160
    proto = np.full((1, nm, mh, mh), -10.0, np.float32)
    yy, xx = np.mgrid[0:mh, 0:mh]
    circle = ((yy - 80) ** 2 + (xx - 80) ** 2) < 40 ** 2          # a round blob: many contour points
    proto[0, 0][circle] = 10.0
    coeffs = [1.0, 0, 0, 0]
    out = _rows([200, 200, 440, 440, 0.9, 0] + coeffs)
    d = decode_segment(out, proto, 1.0, 0, 0, 640, 640, 640, CLASSES, None, 0.25)
    assert len(d) == 1 and d[0]["polygon"]
    assert 3 <= len(d[0]["polygon"]) <= 64
    assert all(0 <= px <= 1 and 0 <= py <= 1 for px, py in d[0]["polygon"])


# ------------------------------------------------------------------- app
class FakeRuntime:
    def __init__(self):
        self.models, self.calls = {}, []

    def providers(self):
        return ["CPUExecutionProvider"]

    def load(self, vid, path, meta):
        self.models[vid] = meta

    def unload(self, vid):
        self.models.pop(vid, None)

    def loaded(self):
        return list(self.models)

    def infer(self, vid, jpeg, class_filter, conf):
        if vid not in self.models:
            raise KeyError(vid)
        if cv2.imdecode(np.frombuffer(jpeg, np.uint8), 1) is None:
            raise ValueError("not an image")
        self.calls.append((vid, class_filter, conf))
        return [{"class_id": 0, "class": "person", "score": 0.9, "bbox": [0.1, 0.1, 0.2, 0.2]}], 12.5

    def benchmark(self, vid, frames):
        if vid not in self.models:
            raise KeyError(vid)
        return {"fps": 20.0, "ms_p50": 40.0, "ms_p95": 55.0, "provider": "CPUExecutionProvider"}


def _store(tmp_path, payload=b"onnx-bytes", fail=False):
    def fetch(url, dest):
        if fail:
            raise OSError("network down")
        dest.write_bytes(payload)
    return ModelStore(tmp_path, fetch=fetch)


def _put(client, vid, payload=b"onnx-bytes", sha=None, **kw):
    body = {"url": "http://x/m", "sha256": sha or hashlib.sha256(payload).hexdigest(), "task": "detect",
            "imgsz": 640, "classes": CLASSES}
    body.update(kw)
    return client.put(f"/v1/models/{vid}", json=body)


def test_put_loads_and_health_lists_it(tmp_path):
    rt = FakeRuntime()
    c = TestClient(create_app(rt, _store(tmp_path), sync_loads=True))
    assert _put(c, "v1").status_code == 202
    h = c.get("/v1/health").json()
    assert h["loaded"] == ["v1"] and h["providers"] == ["CPUExecutionProvider"] and h["failed"] == {}


def test_put_wrong_sha_rejected_keeps_previous(tmp_path):
    rt = FakeRuntime()
    c = TestClient(create_app(rt, _store(tmp_path), sync_loads=True))
    _put(c, "v1")
    _put(c, "v2", sha="0" * 64)                                  # payload hash does not match
    h = c.get("/v1/health").json()
    assert h["loaded"] == ["v1"] and "sha256" in h["failed"]["v2"]
    assert c.post("/v1/infer?model=v1", content=_jpeg()).status_code == 200


def test_put_download_failure_is_reported_not_raised(tmp_path):
    c = TestClient(create_app(FakeRuntime(), _store(tmp_path, fail=True), sync_loads=True))
    assert _put(c, "v1").status_code == 202
    assert "network down" in c.get("/v1/health").json()["failed"]["v1"]


def test_put_validates_body(tmp_path):
    c = TestClient(create_app(FakeRuntime(), _store(tmp_path), sync_loads=True))
    assert c.put("/v1/models/v1", json={"url": "file:///etc/passwd", "sha256": "a" * 64, "task": "detect",
                                        "imgsz": 640, "classes": ["a"]}).status_code == 422
    assert c.put("/v1/models/v1", json={"url": "http://x", "sha256": "zz", "task": "detect", "imgsz": 640,
                                        "classes": ["a"]}).status_code == 422
    assert c.put("/v1/models/v1", json={"url": "http://x", "sha256": "a" * 64, "task": "pose", "imgsz": 640,
                                        "classes": ["a"]}).status_code == 422


def test_infer_unknown_model_404_and_class_filter_parsed(tmp_path):
    rt = FakeRuntime()
    c = TestClient(create_app(rt, _store(tmp_path), sync_loads=True))
    assert c.post("/v1/infer?model=nope", content=_jpeg()).status_code == 404
    _put(c, "v1")
    r = c.post("/v1/infer?model=v1&classes=0,2&conf=0.4", content=_jpeg())
    assert r.status_code == 200 and r.json()["detections"][0]["class"] == "person" and r.json()["ms"] == 12.5
    assert rt.calls[-1] == ("v1", {0, 2}, 0.4)
    assert c.post("/v1/infer?model=v1&classes=a,b", content=_jpeg()).status_code == 422
    assert c.post("/v1/infer?model=v1&conf=2", content=_jpeg()).status_code == 422


def test_infer_rejects_non_jpeg_and_oversize(tmp_path):
    c = TestClient(create_app(FakeRuntime(), _store(tmp_path), sync_loads=True))
    _put(c, "v1")
    assert c.post("/v1/infer?model=v1", content=b"not an image at all").status_code == 422
    assert c.post("/v1/infer?model=v1", content=b"\xff\xd8" + b"0" * (6 * 1024 * 1024)).status_code == 413


def test_delete_unloads(tmp_path):
    rt = FakeRuntime()
    c = TestClient(create_app(rt, _store(tmp_path), sync_loads=True))
    _put(c, "v1")
    assert c.delete("/v1/models/v1").status_code == 204
    assert c.get("/v1/health").json()["loaded"] == []
    assert c.delete("/v1/models/v1").status_code == 204          # idempotent


def test_benchmark_route(tmp_path):
    c = TestClient(create_app(FakeRuntime(), _store(tmp_path), sync_loads=True))
    _put(c, "v1")
    r = c.post("/v1/benchmark?model=v1&frames=20")
    assert r.status_code == 200 and r.json()["fps"] == 20.0
    assert c.post("/v1/benchmark?model=nope&frames=20").status_code == 404
    assert c.post("/v1/benchmark?model=v1&frames=9999").status_code == 422


def test_store_keeps_last_two(tmp_path):
    n = [0]

    def fetch(url, dest):
        n[0] += 1
        dest.write_bytes(f"model-{n[0]}".encode())
    s = ModelStore(tmp_path, fetch=fetch, keep=2)
    paths = []
    for i in range(1, 4):
        payload = f"model-{i}".encode()
        paths.append(s.ensure("http://x/m", hashlib.sha256(payload).hexdigest()))
    left = sorted(p.name for p in tmp_path.glob("*.onnx"))
    assert len(left) == 2 and paths[2].exists() and paths[1].exists() and not paths[0].exists()


def test_store_cached_sha_needs_no_network(tmp_path):
    payload = b"cached"
    sha = hashlib.sha256(payload).hexdigest()
    (tmp_path / f"{sha}.onnx").write_bytes(payload)

    def boom(url, dest):
        raise AssertionError("must not download")
    assert ModelStore(tmp_path, fetch=boom).ensure("http://x/m", sha).read_bytes() == payload
