"""Seed the aggregate (gravel/sand) demo through the public API — no DB access.

Uploads the YOLO26-seg weights (+ optional s model) and the CCTV demo clip,
creates an "upload" camera on the site's first edge, pins the default model
and turns the material decision on. Idempotent: existing names are reused.

    python scripts/seed_material_demo.py --n n.pt --s s.pt --video clip.mp4 \
        [--base http://127.0.0.1:8001] [--token demo-admin]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

ORG = "0199d000-0000-7000-8000-00000000a001"
SITE = "0199d000-0000-7000-8000-00000000b001"
CLASSES = ["gravel", "sand"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", required=True)
    ap.add_argument("--s")
    ap.add_argument("--video", required=True)
    ap.add_argument("--base", default="http://127.0.0.1:8001")
    ap.add_argument("--token", default="demo-admin")
    ap.add_argument("--live", action="store_true", help="write to the PLC tags (default: dry-run)")
    ap.add_argument("--org", default=ORG)
    ap.add_argument("--site", default=SITE)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.base, headers={"Authorization": f"Bearer {a.token}"}, timeout=600)
    o = f"/api/v1/orgs/{a.org}"

    def ok(r: httpx.Response) -> dict:
        if r.status_code >= 400:
            sys.exit(f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    def model(name: str, weights: str, notes: str) -> tuple[str, str]:
        have = {m["name"]: m for m in ok(c.get(f"{o}/vision/models"))["items"]}
        m = have.get(name) or ok(c.post(f"{o}/vision/models", json={"name": name, "task": "segment"}))["model"]
        vs = ok(c.get(f"{o}/vision/models/{m['id']}/versions"))["items"]
        v = next((x for x in vs if x["status"] in ("active", "draft", "processing")), None)
        if v is None:
            data = Path(weights).read_bytes()
            v = ok(c.post(f"{o}/vision/models/{m['id']}/versions", params={"filename": Path(weights).name, "notes": notes},
                          content=data, headers={"Content-Type": "application/octet-stream"}))["version"]
        for _ in range(180):                        # the .pt is converted to ONNX by the sandboxed converter
            v = next(x for x in ok(c.get(f"{o}/vision/models/{m['id']}/versions"))["items"] if x["id"] == v["id"])
            if v["status"] != "processing":
                break
            time.sleep(2)
        if v["status"] == "failed":
            sys.exit(f"conversion failed: {v['failure_reason']}")
        if v["status"] == "draft":
            if v["classes"] is None:
                ok(c.post(f"{o}/vision/models/{m['id']}/versions/{v['id']}/classes", json={"names": CLASSES}))
            ok(c.post(f"{o}/vision/models/{m['id']}/versions/{v['id']}/activate", json={"attest": True}))
        print(f"model {name}: version {v['id']} ready")
        return m["id"], v["id"]

    _, vn = model("Aggregate YOLO26n-seg (default)", a.n,
                  "Final Model v1: gravel .942 / sand .856 AP50 (seen-scene split), 159 FPS on 3080 Ti")
    if a.s:
        model("Aggregate YOLO26s-seg", a.s, "YOLO26s-seg: gravel .933 / sand .881 AP50, 131 FPS on 3080 Ti")

    vids = ok(c.get(f"{o}/sites/{a.site}/videos"))["items"]
    name = Path(a.video).name
    vid = next((v for v in vids if v["filename"] == name), None) or ok(
        c.post(f"{o}/sites/{a.site}/videos", params={"filename": name}, content=Path(a.video).read_bytes(),
               headers={"Content-Type": "video/mp4"}))
    print("video", vid["id"])

    edges = ok(c.get(f"{o}/sites/{a.site}/edges"))["items"]
    edge = edges[0]["id"]
    cams = ok(c.get(f"{o}/edges/{edge}/cameras"))["items"]
    cam = next((x for x in cams if x["name"] == "Aggregate CCTV (demo)"), None) or ok(
        c.post(f"{o}/edges/{edge}/cameras", json={"name": "Aggregate CCTV (demo)", "kind": "upload",
                                                    "video_id": vid["id"], "fps_sample": 5}))["camera"]
    ok(c.put(f"{o}/cameras/{cam['id']}/model", json={"model_version_id": vn, "placement": "edge"}))
    print("camera", cam["id"], "-> pinned default model")

    # simulated PLC-side tags the decision is written to (replace with the real PLC tags later)
    sim = [("code", "number", None), ("margin_pct", "number", "%"), ("uncertain", "bool", None), ("trigger", "bool", None)]
    ok(c.post(f"{o}/sites/{a.site}/plant-sim-tags", json={"tags": [
        {"path": f"auto/aggregate_dump/{n}", "type": t, "writable": True, "unit": u, "behavior": "state",
         "initial": False if t == "bool" else 0, **({"min": 0, "max": 65535} if t == "number" else {})}
        for n, t, u in sim]}))
    mat = {"enabled": True, "dry_run": a.live is False, "outputs": {n: f"auto/aggregate_dump/{n}" for n, _, _ in sim}}
    ok(c.patch(f"{o}/edges/{edge}/cameras/{cam['id']}", json={"material": mat}))
    print("material decision on (dry_run=%s)" % mat["dry_run"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
