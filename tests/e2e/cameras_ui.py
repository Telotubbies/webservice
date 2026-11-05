"""Browser walk-through of the Cameras page (Playwright, headless Chromium).

    WEB_URL=http://localhost:5173 BASE_URL=http://localhost:8001 python tests/e2e/cameras_ui.py

Signs in with the dev token, uploads a generated clip as a demo camera, waits for
the live <img> to decode a frame, then removes the camera and the clip.
Set PW_CHROMIUM to a chromium executable if the bundled one is not installed.
"""

from __future__ import annotations

import glob
import os
import sys
import tempfile
import uuid

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from camera_demo import ORG, SITE, make_clip  # noqa: E402

WEB = os.environ.get("WEB_URL", "http://localhost:5173").rstrip("/")


def _chromium() -> str | None:
    if os.environ.get("PW_CHROMIUM"):
        return os.environ["PW_CHROMIUM"]
    return None


def main() -> int:
    name = f"ui-{uuid.uuid4().hex[:6]}"
    shots = os.path.join(tempfile.gettempdir(), "cameras_ui")
    os.makedirs(shots, exist_ok=True)
    with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
        clip = os.path.join(td, "belt.mp4")
        make_clip(clip)
        b = p.chromium.launch(headless=True, executable_path=_chromium())
        page = b.new_page(viewport={"width": 1280, "height": 800})
        bad = []
        page.on("response", lambda r: bad.append((r.status, r.url)) if r.status >= 400 and "/api/" in r.url else None)
        page.goto(f"{WEB}/infrastructure/cameras")   # "/" is the public landing page; the wall guards app routes
        page.wait_for_load_state("networkidle")
        page.fill("#signin-token", "demo-admin")
        page.keyboard.press("Enter")
        page.wait_for_selector(".side-nav", timeout=15000)
        # demo-admin belongs to every org the other suites created: pick the seeded org, which has the running dev gateway
        page.select_option(f"select:has(option[value='{ORG}'])", ORG)
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Add camera").first.click()
        page.fill("#cam-name", name)
        page.set_input_files("#cam-file", clip)
        page.get_by_role("button", name="Add camera").last.click()
        tile = page.locator("figure", has_text=name)
        tile.wait_for(timeout=20000)
        # a decoded frame: naturalWidth > 0 on the MJPEG <img>
        page.wait_for_function(
            "n => { const i = [...document.querySelectorAll('figure')].find(f => f.textContent.includes(n))?.querySelector('img');"
            " return !!i && i.naturalWidth > 0; }", arg=name, timeout=40000)
        page.screenshot(path=os.path.join(shots, "live.png"))
        print("OK live frame rendered in the browser;", "screenshot:", os.path.join(shots, "live.png"))
        # remove through the UI
        tile.get_by_role("button", name=f"Remove — {name}").click()
        page.get_by_role("button", name="Remove").last.click()
        tile.wait_for(state="detached", timeout=15000)
        print("OK camera removed via UI")
        errs = [x for x in bad if x[0] != 404]
        print("api 4xx/5xx during the walk:", bad or "none")
        b.close()
    # the uploaded clip is left in the library by design; delete it so the dev DB stays clean
    import httpx
    h = {"Authorization": "Bearer demo-admin"}
    api = os.environ.get("BASE_URL", "http://localhost:8000")
    for v in httpx.get(f"{api}/api/v1/orgs/{ORG}/sites/{SITE}/videos", headers=h).json()["items"]:
        if v["filename"] == "belt.mp4":
            httpx.delete(f"{api}/api/v1/orgs/{ORG}/sites/{SITE}/videos/{v['id']}", headers=h)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
