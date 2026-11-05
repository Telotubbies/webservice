"""ONNX Runtime wrapper: best available execution provider, YOLO26 decode per task."""

from __future__ import annotations

import os
import statistics
import threading
import time

import cv2
import numpy as np

cv2.setNumThreads(int(os.environ.get("CV_THREADS", "2")))   # default is one per core

from .postprocess import clean, decode_detect, decode_segment, letterbox

PROVIDER_ORDER = ["TensorrtExecutionProvider", "CUDAExecutionProvider", "OpenVINOExecutionProvider",
                  "CPUExecutionProvider"]


class Runtime:
    def __init__(self, session_factory=None):
        self._factory = session_factory or self._ort_session
        self._models: dict[str, dict] = {}
        self._lock = threading.Lock()

    @staticmethod
    def available() -> list[str]:
        import onnxruntime as ort
        have = ort.get_available_providers()
        return [p for p in PROVIDER_ORDER if p in have] or ["CPUExecutionProvider"]

    def providers(self) -> list[str]:
        try:
            return self.available()
        except ImportError:
            return []

    @staticmethod
    def _ort_session(path: str, providers: list[str]):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.log_severity_level = 3
        # ORT defaults to one intra-op thread per core and spin-waits between
        # runs, which pins every core at 100% even when idle. Cap the pool and
        # sleep instead of spinning.
        so.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "4"))
        so.inter_op_num_threads = 1
        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
        so.add_session_config_entry("session.inter_op.allow_spinning", "0")
        return ort.InferenceSession(path, sess_options=so, providers=providers)

    def load(self, vid: str, path, meta: dict) -> None:
        """Try providers best-first; the first that loads wins (a GPU provider without its driver falls through)."""
        last = None
        for prov in self.providers() or ["CPUExecutionProvider"]:
            try:
                sess = self._factory(str(path), [prov])
                with self._lock:
                    self._models[vid] = {**meta, "session": sess, "engine": prov,
                                         "input": sess.get_inputs()[0].name}
                return
            except Exception as exc:  # noqa: BLE001
                last = exc
        raise RuntimeError(f"model could not be loaded: {last}")

    def unload(self, vid: str) -> None:
        with self._lock:
            self._models.pop(vid, None)

    def loaded(self) -> list[str]:
        with self._lock:
            return list(self._models)

    def engine(self, vid: str) -> str | None:
        m = self._models.get(vid)
        return m["engine"] if m else None

    def _run(self, m: dict, img_bgr, class_filter, conf):
        oh, ow = img_bgr.shape[:2]
        tensor, scale, px, py = letterbox(img_bgr, m["imgsz"])
        outs = m["session"].run(None, {m["input"]: tensor})
        if m["task"] == "segment" and len(outs) >= 2:
            return decode_segment(outs[0], outs[1], scale, px, py, ow, oh, m["imgsz"], m["classes"], class_filter, conf)
        return decode_detect(outs[0], scale, px, py, ow, oh, m["classes"], class_filter, conf)

    def infer(self, vid: str, jpeg: bytes, class_filter, conf: float):
        m = self._models.get(vid)
        if m is None:
            raise KeyError(vid)
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("not an image")
        t0 = time.perf_counter()
        dets = self._run(m, img, class_filter, conf)
        return clean(dets), round((time.perf_counter() - t0) * 1000, 2)

    def benchmark(self, vid: str, frames: int) -> dict:
        m = self._models.get(vid)
        if m is None:
            raise KeyError(vid)
        img = np.full((480, 640, 3), 114, np.uint8)          # a fixed grey frame keeps runs comparable
        self._run(m, img, None, 0.25)                         # warm-up
        ms = []
        for _ in range(frames):
            t0 = time.perf_counter()
            self._run(m, img, None, 0.25)
            ms.append((time.perf_counter() - t0) * 1000)
        ms.sort()
        p50 = statistics.median(ms)
        return {"fps": round(1000.0 / max(sum(ms) / len(ms), 1e-6), 2), "ms_p50": round(p50, 2),
                "ms_p95": round(ms[min(len(ms) - 1, int(len(ms) * 0.95))], 2), "provider": m["engine"]}
