"""Camera demo proof: upload a generated clip -> add camera on the dev gateway ->
first live frame arrives through MQTT and the relay. Runs on Windows and Linux.

    BASE_URL=http://localhost:8001 python tests/e2e/camera_demo.py

Needs the dev stack (`make up-test`) with edge-bridge rebuilt. Cleans up after itself.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import uuid

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.environ.get("ADMIN_TOKEN", "demo-admin")
ORG = os.environ.get("V1_ORG_ID", "0199d000-0000-7000-8000-00000000a001")
SITE = os.environ.get("V1_SITE_ID", "0199d000-0000-7000-8000-00000000b001")
EDGE = os.environ.get("V1_EDGE_ID", "0199d000-0000-7000-8000-00000000c001")
FIRST_FRAME_S = 30


def make_clip(path: str) -> None:
    import cv2
    import numpy as np
    w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 240))
    for i in range(60):
        img = np.zeros((240, 320, 3), np.uint8)
        cv2.rectangle(img, (10 + i * 4, 90), (70 + i * 4, 150), (0, 200, 255), -1)   # a "part" on a belt
        w.write(img)
    w.release()


def main() -> int:
    h = {"Authorization": f"Bearer {TOKEN}"}
    with httpx.Client(base_url=BASE, headers=h, timeout=30) as c, \
            tempfile.TemporaryDirectory() as td:
        clip = os.path.join(td, "belt.mp4")
        make_clip(clip)
        with open(clip, "rb") as f:
            v = c.post(f"/api/v1/orgs/{ORG}/sites/{SITE}/videos", params={"filename": "belt.mp4"}, content=f.read())
        assert v.status_code == 201, v.text
        vid = v.json()["id"]
        cam = None
        try:
            r = c.post(f"/api/v1/orgs/{ORG}/edges/{EDGE}/cameras",
                       json={"name": f"demo-{uuid.uuid4().hex[:6]}", "kind": "upload",
                             "video_id": vid, "fps_sample": 5})
            assert r.status_code == 201, r.text
            cam = r.json()["camera"]["id"]
            t0 = time.time()
            while time.time() - t0 < FIRST_FRAME_S:
                s = c.get(f"/api/v1/orgs/{ORG}/cameras/{cam}/snapshot")
                if s.status_code == 200 and s.content[:2] == b"\xff\xd8":
                    print(f"OK first frame after {time.time() - t0:.1f}s ({len(s.content)} bytes)")
                    return 0
                time.sleep(0.5)
            st = c.get(f"/api/v1/orgs/{ORG}/edges/{EDGE}/cameras").json()["items"]
            print("FAIL no frame in", FIRST_FRAME_S, "s; camera status:",
                  [(x["name"], x["status"], x["status_detail"]) for x in st])
            return 1
        finally:
            if cam:
                c.delete(f"/api/v1/orgs/{ORG}/edges/{EDGE}/cameras/{cam}")
            c.delete(f"/api/v1/orgs/{ORG}/sites/{SITE}/videos/{vid}")


if __name__ == "__main__":
    sys.exit(main())
