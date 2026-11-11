"""Shared helpers for the T-all E2E files (smoke.py is not edited; its helpers are re-used)."""
import importlib.util
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("smoke", HERE / "smoke.py")
smoke = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smoke)
check, nav, stop = smoke.check, smoke.nav, smoke.stop
WEB_DIR = smoke.WEB_DIR
failures = smoke.failures
DESK, MOB = {"width": 1440, "height": 900}, {"width": 390, "height": 844}


def listening(port):
    """True when anything already answers on the port (a leftover Vite from another tree)."""
    try:
        with socket.create_connection(("localhost", port), timeout=0.5):
            return True
    except OSError:
        return False


def stop_tree(proc):
    """Kill the whole tree: on Windows npx is a cmd shim, elsewhere it is a node wrapper."""
    if sys.platform == "win32":
        stop(proc)  # smoke.stop already runs taskkill /T
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            proc.terminate()


def start_vite(port):
    url = f"http://localhost:{port}"
    # never test a server this run did not start: a busy port silently turns the
    # suite into a test of whatever other worktree is listening
    if listening(port):
        raise SystemExit(f"port {port} already answers on {url} - refusing to test a server this run did not start")
    shell = sys.platform == "win32"
    proc = subprocess.Popen(["npx", "vite", "--port", str(port), "--strictPort"], cwd=WEB_DIR, shell=shell,
                            env={**os.environ, "MOCK_API": "1"}, start_new_session=not shell,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(90):
        if proc.poll() is not None:
            raise SystemExit(f"vite exited before {url} answered - is port {port} taken?")
        try:
            urllib.request.urlopen(url, timeout=1)
            return proc, url
        except Exception:
            time.sleep(1)
    stop_tree(proc)
    raise SystemExit("vite did not start within 90 s")


def shot(page, fxx, name):
    d = HERE / "shots" / fxx
    d.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(d / f"{name}.png"))


def login(page, web, who="demo-admin"):
    page.goto(web + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text=who).click()
    page.wait_for_selector(".side-nav, main", state="attached", timeout=30000)
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")


def main(port_default, runner):
    """runner(browser, web, ctx) ; ctx.writes collects unexpected command writes, ctx.errors page errors."""
    sys.stdout.reconfigure(encoding="utf-8")
    proc, web = None, os.environ.get("WEB_URL")
    if not web:
        proc, web = start_vite(int(os.environ.get("E2E_PORT", port_default)))
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, channel=smoke.CHANNEL)
            runner(b, web)
            b.close()
    finally:
        if proc:
            stop_tree(proc)
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)


def new_page(b, viewport, errors, writes=None):
    page = b.new_page(viewport=viewport)
    page.on("pageerror", lambda e: errors.append(str(e)))
    if writes is not None:
        page.on("request", lambda r: writes.append(f"{r.method} {r.url}")
                if r.method in ("POST", "PUT", "PATCH", "DELETE") and "command" in r.url else None)
    return page


def text(page):
    return page.locator("main").inner_text()
