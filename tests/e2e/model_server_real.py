"""Real-model proof of the gateway model server: YOLO26n (and -seg) through ONNX Runtime on a real photo.

    YOLO_DIR=<folder with yolo26n.onnx, yolo26n-seg.onnx, bus.jpg> python tests/e2e/model_server_real.py

The ONNX files come from the sandboxed converter (M1-04); bus.jpg is the standard Ultralytics sample image.
Neither is committed. Starts a throw-away `webservice-model-server` container and removes it.
"""

from __future__ import annotations

import functools
import hashlib
import http.server
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

YOLO_DIR = Path(os.environ.get("YOLO_DIR", "."))
IMAGE = os.environ.get("MODEL_SERVER_IMAGE", "webservice-model-server")
PORT = int(os.environ.get("MS_PORT", "9100"))

# COCO class ids used in the checks
PERSON, BUS = 0, 5


def coco_names() -> list[str]:
    return ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
            "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
            "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
            "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
            "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
            "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
            "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
            "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
            "scissors", "teddy bear", "hair drier", "toothbrush"]


def main() -> int:
    for need in ("yolo26n.onnx", "bus.jpg"):
        if not (YOLO_DIR / need).exists():
            print(f"SKIP: {need} not found in {YOLO_DIR}")
            return 2
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(YOLO_DIR))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    fport = srv.server_address[1]
    name = f"ms-real-{os.getpid()}"
    subprocess.run(["docker", "run", "-d", "--rm", "--name", name, "-p", f"127.0.0.1:{PORT}:9000", IMAGE],
                   check=True, capture_output=True)
    ok = True
    try:
        base = f"http://127.0.0.1:{PORT}"
        for _ in range(60):
            try:
                if httpx.get(f"{base}/v1/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.5)
        h = httpx.get(f"{base}/v1/health").json()
        print("providers:", h["providers"])
        img = (YOLO_DIR / "bus.jpg").read_bytes()
        for fname, task, vid in (("yolo26n.onnx", "detect", "real-detect"), ("yolo26n-seg.onnx", "segment", "real-seg")):
            f = YOLO_DIR / fname
            if not f.exists():
                print("SKIP", fname)
                continue
            sha = hashlib.sha256(f.read_bytes()).hexdigest()
            r = httpx.put(f"{base}/v1/models/{vid}", timeout=30, json={
                "url": f"http://host.docker.internal:{fport}/{fname}", "sha256": sha, "task": task,
                "imgsz": 640, "classes": coco_names()})
            assert r.status_code == 202, r.text
            for _ in range(120):
                h = httpx.get(f"{base}/v1/health").json()
                if vid in h["loaded"] or vid in h["failed"]:
                    break
                time.sleep(0.5)
            if vid not in h["loaded"]:
                print("FAIL load", fname, h["failed"])
                ok = False
                continue
            r = httpx.post(f"{base}/v1/infer", params={"model": vid, "conf": 0.4}, content=img, timeout=30)
            dets = r.json()["detections"]
            classes = {d["class_id"] for d in dets}
            good = PERSON in classes and BUS in classes and r.json()["ms"] > 0
            if task == "segment":
                good = good and any(len(d.get("polygon", [])) >= 3 for d in dets)
            persons = sum(1 for d in dets if d["class_id"] == PERSON)
            b = httpx.post(f"{base}/v1/benchmark", params={"model": vid, "frames": 20}, timeout=120).json()
            print(("OK  " if good else "FAIL"), fname, f"{len(dets)} detections ({persons} person, bus={BUS in classes})",
                  f"infer {r.json()['ms']} ms", f"| benchmark {b['fps']} fps p50 {b['ms_p50']} ms p95 {b['ms_p95']} ms [{b['provider']}]")
            ok &= good
        # filter works: asking for only the bus returns only the bus
        r = httpx.post(f"{base}/v1/infer", params={"model": "real-detect", "conf": 0.4, "classes": str(BUS)}, content=img, timeout=30)
        only = {d["class_id"] for d in r.json()["detections"]}
        print(("OK  " if only == {BUS} else "FAIL"), "class filter:", only)
        ok &= only == {BUS}
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        srv.shutdown()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
