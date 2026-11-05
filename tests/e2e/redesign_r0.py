"""R0 stabilize smoke (console redesign plan, Task 6).

Run against the dev server with the mock API:
    cd web && MOCK_API=1 npx vite --port 5199 --strictPort
    WEB_URL=http://localhost:5199 PW_CHANNEL=msedge python tests/e2e/redesign_r0.py

The session token lives in memory only, so after sign-in every navigation is
in-app (history.pushState + popstate); a page.goto would sign the user out.
"""

import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB_URL", "http://localhost:5199")
CHANNEL = os.environ.get("PW_CHANNEL", "chrome")
SHOTS = os.path.join(tempfile.gettempdir(), "redesign_r0")
os.makedirs(SHOTS, exist_ok=True)
failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def nav(page, path, wait=2500):
    page.evaluate("p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }", path)
    page.wait_for_timeout(wait)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel=CHANNEL)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(WEB + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=20000)
    page.locator(".dev-demo", has_text="demo-admin").click()
    page.wait_for_selector(".side-nav", state="attached", timeout=20000)
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")  # first-visit "Start here" panel

    # (a) Trends draws its chart (uPlot canvas), also after in-app navigation
    nav(page, "/trends", 4000)
    canvases = page.locator(".u-wrap canvas").count()
    page.screenshot(path=os.path.join(SHOTS, "trends.png"))
    check("trends: chart canvas mounted", canvases >= 1, f"{canvases} canvases")

    # (b) the sorting line view never shows the batching plant drawing
    nav(page, "/line")
    page.screenshot(path=os.path.join(SHOTS, "line.png"))
    check("line: no batching-plant parts", "Cement silo" not in page.locator("main").inner_text())

    # (c) disabled / never-connected gateways are parked, not meshed
    nav(page, "/infrastructure/map", 3500)
    page.screenshot(path=os.path.join(SHOTS, "map.png"))
    check("map: parked node present", page.locator("main svg", has_text="Parked").count() >= 1)

    # (d) a stopped line is a normal state: the status bar never takes the danger tone
    nav(page, "/line")
    bars = page.evaluate("[...document.querySelectorAll('main [role=status]')].map(e => e.className)")
    check("status bar: no danger tone", all("danger" not in c for c in bars), str(bars)[:200])

    browser.close()

sys.exit(1 if failures else 0)
