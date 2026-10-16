"""Roadmap 9.1 acceptance: official yolo26n.pt and yolo26n-seg.pt each become a model with 80 classes
and the right task, converted inside the sandbox.

    YOLO_DIR=<folder with the two .pt files> BASE_URL=http://localhost:8001 python tests/e2e/model_official.py

The weights are AGPL-3.0 Ultralytics files: download them yourself, they are not in the repo.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
ORG = os.environ.get("V1_ORG_ID", "0199d000-0000-7000-8000-00000000a001")
YOLO_DIR = Path(os.environ.get("YOLO_DIR", "."))
CASES = [("yolo26n.pt", "detect"), ("yolo26n-seg.pt", "segment")]


def main() -> int:
    ok = True
    with httpx.Client(base_url=BASE, timeout=60, headers={"Authorization": "Bearer demo-admin"}) as c:
        for fname, task in CASES:
            f = YOLO_DIR / fname
            if not f.exists():
                print(f"SKIP {fname}: not found in {YOLO_DIR}")
                continue
            m = c.post(f"/api/v1/orgs/{ORG}/vision/models", json={"name": f"official-{uuid.uuid4().hex[:6]}", "task": task}).json()["model"]
            try:
                v = c.post(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions", params={"filename": fname},
                           content=f.read_bytes()).json()["version"]
                t0, cur = time.time(), v
                while time.time() - t0 < 300 and cur["status"] == "processing":
                    time.sleep(3)
                    cur = c.get(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions/{v['id']}").json()["version"]
                n = len(cur["classes"] or [])
                good = cur["status"] == "draft" and n == 80 and cur["task"] == task
                ok &= good
                print(("OK  " if good else "FAIL"), fname, "->", cur["status"], f"{n} classes", cur["task"],
                      f"imgsz={cur['imgsz']}", f"{time.time() - t0:.0f}s", cur["failure_reason"] or "")
            finally:
                for x in c.get(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions").json()["items"]:
                    c.delete(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions/{x['id']}")
                c.delete(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
