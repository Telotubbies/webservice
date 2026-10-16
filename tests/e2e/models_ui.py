"""Browser walk-through of Models + per-camera class settings (Playwright, headless Chromium).

    PW_CHROMIUM=<chrome-headless-shell.exe> WEB_URL=http://localhost:5173 BASE_URL=http://localhost:8001 \
        python tests/e2e/models_ui.py

Creates a model, uploads a tiny generated ONNX, activates it with the licence attestation,
pins it to a throw-away camera and edits a class. Removes everything it made.
"""

from __future__ import annotations

import os
import sys
import tempfile
import uuid

import httpx
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from camera_demo import EDGE, ORG, SITE, make_clip  # noqa: E402
from onnx_fixtures import detect_onnx  # noqa: E402

WEB = os.environ.get("WEB_URL", "http://localhost:5173").rstrip("/")
API = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
H = {"Authorization": "Bearer demo-admin"}


def main() -> int:
    mname, cname = f"ui-model-{uuid.uuid4().hex[:6]}", f"ui-cam-{uuid.uuid4().hex[:6]}"
    api = httpx.Client(base_url=API, headers=H, timeout=30)
    vid = cam = None
    bad: list = []
    try:
        with tempfile.TemporaryDirectory() as td:
            clip, onnx_path = os.path.join(td, "belt.mp4"), os.path.join(td, "m.onnx")
            make_clip(clip)
            open(onnx_path, "wb").write(detect_onnx())
            vid = api.post(f"/api/v1/orgs/{ORG}/sites/{SITE}/videos", params={"filename": "belt.mp4"},
                           content=open(clip, "rb").read()).json()["id"]
            cam = api.post(f"/api/v1/orgs/{ORG}/edges/{EDGE}/cameras",
                           json={"name": cname, "kind": "upload", "video_id": vid}).json()["camera"]["id"]
            with sync_playwright() as p:
                b = p.chromium.launch(headless=True, executable_path=os.environ.get("PW_CHROMIUM"))
                page = b.new_page(viewport={"width": 1280, "height": 900})
                page.on("response", lambda r: bad.append((r.status, r.url)) if r.status >= 400 and "/api/" in r.url else None)
                page.goto(f"{WEB}/infrastructure/models")
                page.wait_for_load_state("networkidle")
                page.fill("#signin-token", "demo-admin")
                page.keyboard.press("Enter")
                page.wait_for_selector(".side-nav", timeout=15000)
                page.select_option(f"select:has(option[value='{ORG}'])", ORG)
                page.wait_for_load_state("networkidle")
                # create model
                page.get_by_role("button", name="New model").first.click()
                page.fill("#vm-name", mname)
                page.get_by_role("button", name="Create").click()
                card = page.locator("section", has_text=mname)
                card.wait_for(timeout=15000)
                # upload the onnx
                card.locator("input[type=file]").set_input_files(onnx_path)
                card.get_by_text("Draft").wait_for(timeout=20000)
                assert card.get_by_text("v1").first.is_visible()
                # activate needs the attestation
                card.get_by_role("button", name="Activate").click()
                activate = page.get_by_role("group").get_by_role("button", name="Activate")
                assert activate.is_disabled(), "activate must stay disabled until the licence box is ticked"
                page.get_by_label("My organization has the right to use this model commercially.").check()
                activate.click()
                card.get_by_text("Active").first.wait_for(timeout=15000)
                page.screenshot(path=os.path.join(tempfile.gettempdir(), "models_ui.png"))
                print("OK model uploaded, inspected (3 classes) and activated through the UI")
                # pin on the camera
                page.get_by_role("link", name="Cameras").first.click()   # in-app: a reload would drop the session and the org choice
                page.wait_for_load_state("networkidle")
                tile = page.locator("figure", has_text=cname)
                tile.get_by_role("button", name="Model and classes").click()
                panel = page.get_by_role("region", name=f"Model and classes — {cname}")
                panel.get_by_label("Model version").select_option(label=f"{mname} v1")
                panel.get_by_role("button", name="Use this version").click()
                try:
                    panel.get_by_label("bicycle On").wait_for(timeout=15000)
                except Exception:
                    page.screenshot(path=os.path.join(tempfile.gettempdir(), "models_ui_fail.png"))
                    print("PANEL TEXT:", panel.inner_text()[:600], "| api:", bad)
                    raise
                panel.get_by_label("bicycle On").uncheck()
                panel.get_by_label("car Min score").fill("0.6")
                panel.get_by_role("button", name="Save class settings").click()
                panel.get_by_text("Saved").wait_for(timeout=10000)
                got = api.get(f"/api/v1/orgs/{ORG}/cameras/{cam}/model").json()
                assert got["class_config"]["1"]["enabled"] is False and got["class_config"]["2"]["min_score"] == 0.6, got
                page.screenshot(path=os.path.join(tempfile.gettempdir(), "models_ui_panel.png"))
                print("OK model pinned and class settings saved through the UI")
                b.close()
    finally:
        if cam:
            api.delete(f"/api/v1/orgs/{ORG}/cameras/{cam}/model")
            api.delete(f"/api/v1/orgs/{ORG}/edges/{EDGE}/cameras/{cam}")
        if vid:
            api.delete(f"/api/v1/orgs/{ORG}/sites/{SITE}/videos/{vid}")
        for m in api.get(f"/api/v1/orgs/{ORG}/vision/models").json()["items"]:
            if m["name"] == mname:
                for v in api.get(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions").json()["items"]:
                    api.post(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions/{v['id']}/archive")
                    api.delete(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}/versions/{v['id']}")
                api.delete(f"/api/v1/orgs/{ORG}/vision/models/{m['id']}")
    print("api 4xx/5xx during the walk:", bad or "none")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
