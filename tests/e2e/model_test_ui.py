"""Browser regression for the Models -> version -> Test panel (plan M1-05 T5).

Standalone script — every /api/* call is intercepted and mocked, so no backend
is needed, only a running web server (Vite dev or preview):

    WEB_URL=http://localhost:5173 python tests/e2e/model_test_ui.py
    (set PW_CHROMIUM if the bundled Playwright chromium is absent)

This is a UI contract check with mocked API responses — NOT proof that a real
model infers. Race scenarios gate mock routes on asyncio.Events so the browser
acts while the response is genuinely in flight. Screenshots land in
tests/e2e/_shots/.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
import uuid

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

WEB = os.environ.get("WEB_URL", "http://localhost:5173").rstrip("/")
SHOTS = os.path.join(HERE, "_shots")

ORG = str(uuid.uuid4())
SITE = str(uuid.uuid4())
EDGE1, EDGE2 = str(uuid.uuid4()), str(uuid.uuid4())
MODEL = str(uuid.uuid4())
VID = str(uuid.uuid4())
CAM1, CAM2 = str(uuid.uuid4()), str(uuid.uuid4())


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _jpeg(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = rgb[::-1]                                   # cv2 is BGR
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


IMG_A = _jpeg(320, 240, (40, 180, 70))                   # submitted file A
IMG_B = _jpeg(480, 360, (200, 60, 60))                   # replacement file B

# box + polygon detections in one result
RESULT = {"ms": 7.5, "engine": "CPUExecutionProvider", "detections": [
    {"class_id": 0, "class": "person", "score": 0.9, "bbox": [0.1, 0.1, 0.3, 0.3]},
    {"class_id": 1, "class": "bus", "score": 0.7, "bbox": [0.4, 0.4, 0.3, 0.3],
     "polygon": [[0.4, 0.4], [0.7, 0.4], [0.55, 0.7]]}]}

TEST_CALLS: list = []


def _device(eid, name, status="active") -> dict:
    return {"id": eid, "org_id": ORG, "site_id": SITE, "name": name,
            "status": status, "mqtt_username": "u", "credential_version": 1,
            "last_hb_at": _now() if status == "active" else "2020-01-01T00:00:00Z",
            "clock_ok": True, "adapter": None, "needs_rotation": False}


def _cam(cid, name) -> dict:
    return {"id": cid, "edge_id": EDGE1, "name": name, "kind": "upload",
            "has_rtsp_url": False, "video_id": str(uuid.uuid4()),
            "fps_sample": 10.0, "enabled": True, "status": "ok",
            "status_detail": None, "status_at": _now()}


async def _install(page, *, edges=None, gate_test=False, gate_snapshot=False):
    """Intercept every API call. Gated routes signal when the request has
    entered and hold the response until released."""
    edges = edges if edges is not None else [_device(EDGE1, "gw-1"), _device(EDGE2, "gw-2")]
    test_entered, test_release = asyncio.Event(), asyncio.Event()
    snap_entered, snap_release = asyncio.Event(), asyncio.Event()

    async def handle(route):
        url = route.request.url.split("?")[0]
        method = route.request.method
        if url.endswith("/api/auth/config"):
            return await route.fulfill(json={"idps": [], "dev_tokens": True})
        if url.endswith("/api/me"):
            return await route.fulfill(json={
                "user": {"sub": "admin", "display_name": "Admin"},
                "role": "owner", "kind": "dev",
                "orgs": [{"org_id": ORG, "role": "owner"}],
                "memberships": [{"org_id": ORG, "org_name": "Org A", "role": "owner",
                                 "permissions": []}]})
        if url.endswith(f"/orgs/{ORG}/sites") and method == "GET":
            return await route.fulfill(json={"items": [{"id": SITE, "name": "Site", "code": "plant1"}]})
        if url.endswith("/edges") and method == "GET":
            return await route.fulfill(json={"items": edges})
        if url.endswith("/vision/models") and method == "GET":
            return await route.fulfill(json={"items": [
                {"id": MODEL, "name": "belt-model", "task": "detect",
                 "version_count": 1, "active_version": 1}]})
        if url.endswith("/versions") and method == "GET":
            return await route.fulfill(json={"items": [
                {"id": VID, "model_id": MODEL, "version": 1, "status": "active",
                 "task": "detect", "source_format": "onnx", "sha256": "ab" * 32,
                 "size_bytes": 2048, "imgsz": 640, "classes": ["person", "bus"],
                 "class_count": 2, "ultralytics_version": "1", "notes": None,
                 "failure_reason": None, "license_attested_at": _now(),
                 "created_at": _now()}]})
        if url.endswith("/test") and method == "POST":
            TEST_CALLS.append(url)
            if gate_test:
                test_entered.set()
                await asyncio.wait_for(test_release.wait(), timeout=20)
            return await route.fulfill(json=RESULT)
        if url.endswith("/cameras") and method == "GET":
            return await route.fulfill(json={"items": [_cam(CAM1, "cam-1"), _cam(CAM2, "cam-2")]})
        if url.endswith("/snapshot") and method == "GET":
            if gate_snapshot:
                snap_entered.set()
                await asyncio.wait_for(snap_release.wait(), timeout=20)
            body = IMG_A if f"/cameras/{CAM1}/" in url else IMG_B
            return await route.fulfill(body=body, content_type="image/jpeg")
        # list-shaped shell endpoints
        if url.endswith(("/api/tags", "/api/tags/latest", "/api/alarms")):
            return await route.fulfill(json=[])
        if "/api/insights" in url:
            return await route.fulfill(json={"items": [], "counts": {"open": 0}})
        if url.endswith("/api/system/health"):
            return await route.fulfill(json={"status": "ok"})
        # anything else under /api — empty but successful, so the shell renders
        return await route.fulfill(json={"items": []})

    async def handler(route):
        await handle(route)

    await page.route("**/api/**", handler)
    return {"test_entered": test_entered, "test_release": test_release,
            "snap_entered": snap_entered, "snap_release": snap_release}


async def _signin(page):
    await page.goto(f"{WEB}/infrastructure/models")
    await page.wait_for_load_state("networkidle")
    if await page.locator("#signin-token").count():
        await page.fill("#signin-token", "demo-admin")
        await page.keyboard.press("Enter")
        await page.wait_for_selector(".side-nav", state="attached", timeout=15000)
    # single mocked membership: scope auto-activates ORG via initScope
    await page.wait_for_load_state("networkidle")


async def _open_panel(page):
    card = page.locator("section", has_text="belt-model")
    await card.locator("button[aria-expanded]").click()   # per-version Test toggle
    return card


FILE_INPUT = "input[accept='image/jpeg,image/png']"


async def _colored_pixels(card, sel="canvas") -> int:
    return await card.locator(sel).evaluate("""(c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4)
            if (d[i+2] > 120 && d[i] < 120) n++;          // blue overlay strokes
        return n;
    }""")


async def _inside_viewport(page, card) -> list[str]:
    """Panel controls must sit inside the viewport horizontally at any width."""
    bad = []
    vw = page.viewport_size["width"]
    for sel in [".field-label", "select", "label.btn", "input[type=range]",
                "button", "canvas"]:
        for el in await card.locator(sel).all():
            if not await el.is_visible():
                continue
            r = await el.bounding_box()
            if r and (r["x"] < -0.5 or r["x"] + r["width"] > vw + 0.5):
                bad.append(f"{sel} clipped: {r}")
    inner = await card.evaluate(
        "(s) => s.scrollWidth > s.clientWidth + 1")
    if inner:
        bad.append("card scrollWidth > clientWidth")
    return bad


async def main() -> int:
    os.makedirs(SHOTS, exist_ok=True)
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        a_path, b_path = os.path.join(td, "a.jpg"), os.path.join(td, "b.jpg")
        with open(a_path, "wb") as f:
            f.write(IMG_A)
        with open(b_path, "wb") as f:
            f.write(IMG_B)
        async with async_playwright() as p:
            exe = os.environ.get("PW_CHROMIUM")
            b = await p.chromium.launch(headless=True,
                                        **({"executable_path": exe} if exe else {}))
            try:
                # ---- happy path: file -> Run -> canvas + results, exactly 1 POST
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                TEST_CALLS.clear()
                await _install(page)
                await _signin(page)
                card = await _open_panel(page)
                await card.locator(FILE_INPUT).set_input_files(a_path)
                run_btn = card.get_by_role("button", name="Run test")
                await run_btn.click()
                await card.get_by_text("person", exact=False).first.wait_for(timeout=10000)
                await card.get_by_text("bus", exact=False).first.wait_for(timeout=5000)
                cv = card.locator("canvas")
                if (await cv.get_attribute("width")) != "320":
                    failures.append(f"canvas width != submitted image (got {await cv.get_attribute('width')})")
                if await _colored_pixels(card) < 20:
                    failures.append("no overlay pixels drawn on canvas")
                if len(TEST_CALLS) != 1:
                    failures.append(f"expected 1 test POST, got {len(TEST_CALLS)}")
                await page.screenshot(path=os.path.join(SHOTS, "model_test_1280.png"), full_page=True)
                # slider filters the existing result — no new request
                await card.locator("input[type=range]").fill("0.95")
                if len(TEST_CALLS) != 1:
                    failures.append("slider triggered a second POST")
                try:
                    await card.get_by_text("No detections").wait_for(timeout=5000)
                except Exception:
                    failures.append("slider to 0.95 did not empty the list")
                if await card.get_by_text("person").count():
                    failures.append("0.9 detection still listed above 0.95 threshold")
                failures += await _inside_viewport(page, card)
                await page.close()

                # ---- stale response: file replaced while request in flight
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                TEST_CALLS.clear()
                g = await _install(page, gate_test=True)
                await _signin(page)
                card = await _open_panel(page)
                await card.locator(FILE_INPUT).set_input_files(a_path)
                await card.get_by_role("button", name="Run test").click()
                await asyncio.wait_for(g["test_entered"].wait(), timeout=10)   # request genuinely in flight
                await card.locator(FILE_INPUT).set_input_files(b_path)          # replace mid-flight
                g["test_release"].set()
                await page.wait_for_timeout(800)                               # let the stale response land
                if await card.get_by_text("person").count():
                    failures.append("stale result attached after image replace")
                if (await card.locator("canvas").get_attribute("width")) != "480":
                    failures.append("preview is not the replacement image")
                await page.close()

                # ---- gateway switch mid-flight cancels the in-flight run
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                TEST_CALLS.clear()
                g = await _install(page, gate_test=True)
                await _signin(page)
                card = await _open_panel(page)
                await card.locator(FILE_INPUT).set_input_files(a_path)
                await card.get_by_role("button", name="Run test").click()
                await asyncio.wait_for(g["test_entered"].wait(), timeout=10)
                await card.locator("select").first.select_option(EDGE2)         # switch gateway mid-flight
                g["test_release"].set()
                await page.wait_for_timeout(800)
                if await card.get_by_text("person").count():
                    failures.append("stale result attached after gateway switch")
                await page.close()

                # ---- snapshot: delayed response must not survive a camera switch
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                g = await _install(page, gate_snapshot=True)
                await _signin(page)
                card = await _open_panel(page)
                cam_sel = card.locator("select").nth(1)
                await cam_sel.select_option(CAM1)
                await card.get_by_role("button", name="Use latest frame").click()
                await asyncio.wait_for(g["snap_entered"].wait(), timeout=10)   # fetch in flight
                await cam_sel.select_option(CAM2)                               # switch camera mid-flight
                g["snap_release"].set()
                await page.wait_for_timeout(800)
                if await card.locator("canvas").count():
                    failures.append("stale snapshot attached after camera switch")
                # a fresh snapshot from cam-2 lands normally
                await card.get_by_role("button", name="Use latest frame").click()
                try:
                    await card.locator("canvas").wait_for(timeout=10000)
                except Exception:
                    failures.append("fresh snapshot did not produce a preview")
                else:
                    if (await card.locator("canvas").get_attribute("width")) != "480":
                        failures.append("snapshot preview is not the cam-2 image")
                await page.close()

                # ---- offline gateway: explanation + disabled/absent run
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                await _install(page, edges=[_device(EDGE1, "gw-1", status="disabled")])
                await _signin(page)
                card = await _open_panel(page)
                try:
                    await card.get_by_text("No online gateway").wait_for(timeout=10000)
                except Exception:
                    failures.append("offline explanation missing")
                if await card.get_by_role("button", name="Run test").count():
                    failures.append("run button rendered with no online gateway")
                await page.screenshot(path=os.path.join(SHOTS, "model_test_offline.png"))
                await page.close()

                # ---- responsive: 375px — panel fits, all controls inside
                page = await b.new_page(viewport={"width": 375, "height": 700})
                await _install(page)
                await _signin(page)
                card = await _open_panel(page)
                await card.locator(FILE_INPUT).set_input_files(a_path)
                await card.get_by_role("button", name="Run test").click()
                await card.get_by_text("person", exact=False).first.wait_for(timeout=10000)
                failures += await _inside_viewport(page, card)
                await page.screenshot(path=os.path.join(SHOTS, "model_test_375.png"), full_page=True)
                await page.close()

                # ---- tablet width
                page = await b.new_page(viewport={"width": 768, "height": 900})
                await _install(page)
                await _signin(page)
                card = await _open_panel(page)
                await card.locator(FILE_INPUT).set_input_files(a_path)
                await card.get_by_role("button", name="Run test").click()
                await card.get_by_text("person", exact=False).first.wait_for(timeout=10000)
                failures += await _inside_viewport(page, card)
                await page.screenshot(path=os.path.join(SHOTS, "model_test_768.png"), full_page=True)
                await page.close()

                # ---- Thai labels resolve (no missing i18n keys)
                page = await b.new_page(viewport={"width": 1280, "height": 900})
                await _install(page)
                await page.add_init_script("localStorage.setItem('wds.lang', 'th')")
                await _signin(page)
                card = await _open_panel(page)
                try:
                    await card.get_by_text("เรียกใช้การทดสอบ").wait_for(timeout=10000)
                except Exception:
                    failures.append("Thai run-test label missing")
                await page.close()
            finally:
                await b.close()
    for f in failures:
        print("FAIL:", f)
    print("model_test_ui:", "FAIL" if failures else "PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
