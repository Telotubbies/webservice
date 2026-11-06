"""E2E smoke against the web dev server + mock API (no backend, no Docker).

One command:  make e2e-smoke      (or: python -I tests/e2e/smoke.py)

Starts `MOCK_API=1 vite` itself unless WEB_URL points at a running server.
Needs the python `playwright` package and Edge (channel msedge; set
PW_CHANNEL=chrome to use Chrome). Read-only: the run fails if any command
POST/PUT/DELETE is sent. The session token is in memory, so after sign-in
every navigation is in-app (pushState + popstate), never page.goto.
"""

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
CHANNEL = os.environ.get("PW_CHANNEL", "msedge")
failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_vite():
    port = free_port()
    shell = sys.platform == "win32"  # npx is a .cmd shim on Windows
    proc = subprocess.Popen(
        ["npx", "vite", "--port", str(port), "--strictPort"], cwd=WEB_DIR, shell=shell,
        env={**os.environ, "MOCK_API": "1"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://localhost:{port}"
    for _ in range(90):
        try:
            urllib.request.urlopen(url, timeout=1)
            return proc, url
        except Exception:
            time.sleep(1)
    proc.kill()
    raise SystemExit("vite did not start within 90 s")


def stop(proc):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


def nav(page, path, wait=2000):
    page.evaluate("p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }", path)
    page.wait_for_timeout(wait)


def run(web):
    writes, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=CHANNEL)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: writes.append(f"{r.method} {r.url}")
                if r.method in ("POST", "PUT", "PATCH", "DELETE") and "command" in r.url else None)

        # 1. sign in
        page.goto(web + "/overview", wait_until="load")
        page.wait_for_selector(".dev-demo", timeout=30000)
        page.locator(".dev-demo", has_text="demo-operator").click()
        page.wait_for_selector(".side-nav", state="attached", timeout=30000)
        page.wait_for_timeout(1500)
        page.keyboard.press("Escape")  # first-visit "Start here" panel
        check("sign in: app shell mounted", page.locator(".side-nav").count() == 1)

        # 2. Overview
        nav(page, "/overview", 2500)
        check("overview: renders content", len(page.locator("main").inner_text().strip()) > 50)

        # 3. alarm list -> detail
        nav(page, "/alarms", 2500)
        # the mock raises alarms on a schedule, so "Active" may be empty; the
        # 24 h simulated history always has Cleared ones
        page.get_by_role("tab", name="Cleared").or_(page.get_by_text("Cleared", exact=True)).first.click()
        page.wait_for_timeout(1500)
        rows = page.locator("main tr[tabindex='0'], main [role=button][tabindex='0']").filter(visible=True)
        check("alarms: list has rows", rows.count() > 0, f"{rows.count()} rows")
        if rows.count():
            rows.first.click()
            page.wait_for_selector("main h1", timeout=10000)
            check("alarm detail: url and title", "/alarms/" in page.url and page.locator("main h1").inner_text().strip() != "",
                  page.url)

        # 4. Trends chart (uPlot canvas)
        nav(page, "/trends", 4000)
        check("trends: chart canvas mounted", page.locator(".u-wrap canvas").count() >= 1)

        # 5. Line/control page opens; nothing is sent
        nav(page, "/line", 2500)
        check("line: page opens", len(page.locator("main").inner_text().strip()) > 50)
        check("line: no command sent", not writes, "; ".join(writes))
        check("no uncaught page errors", not errors, "; ".join(errors)[:300])
        browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    proc = None
    web = os.environ.get("WEB_URL")
    if not web:
        proc, web = start_vite()
    try:
        run(web)
    finally:
        if proc:
            stop(proc)
    print("FAILED: " + ", ".join(failures) if failures else "all smoke checks passed")
    sys.exit(1 if failures else 0)
