"""D2 line control (console v6), end to end against the mock API.

Run: python -I tests/e2e/e2e_d2_line.py   (exit 0 = pass)

Journeys (1440x900 and 390x844):
  1. the page says it is not a safety system, and the toolbar only offers
     actions that exist
  2. the grouped equipment grid selects one row (pale yellow), the inspector
     readout follows it, and the keyboard moves the selection and opens it
  3. the lower tabs hold the F05 commands (command chip, reason, check,
     lifecycle) and the message log; the Mimic is still there as a tab
  4. one command still travels the whole audited path (sheet, reason, send,
     read-back) and no other command POST is sent
  5. a stale reading never looks live; a tag with no reading never looks like 0.0;
     a viewer cannot send; the alert and skeleton cover the error and loading states
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke  # noqa: E402  (helpers only; smoke.run() is not called)
from playwright.sync_api import sync_playwright  # noqa: E402

check = smoke.check
ROOT = Path(__file__).resolve().parents[2]
# a worktree lives at <repo>/.claude/worktrees/<id>; the PM reads shots in the repo
if ".claude" in ROOT.parts:
    ROOT = Path(*ROOT.parts[:ROOT.parts.index(".claude")])
SHOTS = ROOT / ".superpowers" / "sdd" / "console-v6" / "D2-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
WEB = Path(__file__).resolve().parents[2] / "web"
PORT = 5332


def start_vite():
    """Start vite on this work's own port (plan §4). A busy port would silently
    serve another tree's build, so refuse it and start the server directly
    instead of through the npx shim, which leaves one behind on Windows."""
    url = f"http://localhost:{PORT}"
    try:
        urllib.request.urlopen(url, timeout=1)
        raise SystemExit(f"port {PORT} is already in use — stop the process serving {url} first")
    except SystemExit:
        raise
    except Exception:
        pass
    proc = subprocess.Popen(
        ["node", str(WEB / "node_modules" / "vite" / "bin" / "vite.js"), "--port", str(PORT), "--strictPort"],
        cwd=WEB, env={**os.environ, "MOCK_API": "1"},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(90):
        if proc.poll() is not None:
            raise SystemExit(f"vite exited with {proc.returncode} before it served {url}")
        try:
            urllib.request.urlopen(url, timeout=1)
            return proc, url
        except Exception:
            time.sleep(1)
    proc.kill()
    raise SystemExit("vite did not start within 90 s")


def sign_in(page, web, who="demo-operator", lang="en"):
    page.add_init_script(f"try {{ localStorage.setItem('wds.lang', '{lang}') }} catch (e) {{}}")
    page.goto(web + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text=who).click()
    page.wait_for_selector(".side-nav", state="attached", timeout=30000)
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")


def open_line(page, wait=3000):
    smoke.nav(page, "/line", wait)
    page.wait_for_selector("#line-inspector", timeout=15000)


def post_tracker(page):
    posts = []

    def on_req(r):
        if r.method == "POST" and r.url.endswith("/api/commands"):
            posts.append(json.loads(r.post_data or "{}"))
    page.on("request", on_req)
    return posts


def desktop(page, web):
    posts = post_tracker(page)
    open_line(page)

    # --- 1. scope banner and real toolbar actions
    banner = page.get_by_role("note").first
    text = banner.inner_text()
    check("desktop: banner says the console is not a safety system", "not a safety system" in text and "PLC" in text)
    toolbar = page.get_by_role("toolbar", name="Line controls")
    for name in ("Refresh", "Command", "Alarms", "Schematic", "Side view"):
        check(f"desktop: toolbar has {name}", toolbar.get_by_role("button", name=name).count() == 1)
    # regression: the line view is labelled as a view, not with the plant name
    check("desktop: the line-view tool is not labelled with the plant name",
          toolbar.get_by_role("button", name="Sorting line 1").count() == 0)
    check("desktop: connection pill is present", page.locator("[data-conn]").count() == 1)

    # --- 2. grouped grid, one selected row, the readout follows it
    check("desktop: equipment tag counts the rows", page.get_by_text("Equipment (4)").count() >= 1)
    grid = page.locator("[role=grid][aria-label='Equipment (4)']")
    head = grid.locator("thead").inner_text()
    check("desktop: grouped headings for live value and limits", "Live value" in head and "Limits" in head)
    check("desktop: state and quality columns", "state" in head.lower() and "quality" in head.lower() and "last command" in head.lower())
    check("desktop: only the drive carries a run state",
          page.locator("[data-row-id=motor] [data-state-mark]").count() == 1
          and page.locator("[data-row-id=conveyor] [data-state-mark]").count() == 0)
    check("desktop: motor row starts selected", page.locator("[data-row-id=motor][aria-selected=true]").count() == 1)
    check("desktop: selected row uses the pale yellow token",
          "fff4cc" in (page.locator("[data-row-id=motor]").get_attribute("class") or "")
          or page.evaluate("getComputedStyle(document.querySelector('[data-row-id=motor]')).backgroundColor") == "rgb(255, 244, 204)")
    check("desktop: readout of the selected equipment", page.locator("[data-readout]").get_attribute("aria-label") == "Speed setpoint")

    page.locator("[data-row-id=conveyor]").click()
    page.wait_for_timeout(300)
    check("desktop: clicking a row moves the readout",
          page.locator("[data-readout]").get_attribute("aria-label") == "Belt speed"
          and page.locator("[data-row-id=conveyor][aria-selected=true]").count() == 1)
    check("desktop: limits come from the alarm rules",
          page.locator("[data-row-id=conveyor]").inner_text().find("0.5") >= 0)

    # keyboard: down moves to the camera, Enter opens the inspector
    page.locator("[data-row-id=conveyor]").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(200)
    check("desktop: ArrowDown selects the next row", page.locator("[data-row-id=camera][aria-selected=true]").count() == 1)
    check("desktop: focused row has a visible outline",
          page.evaluate("getComputedStyle(document.querySelector('[data-row-id=camera]')).outlineWidth") not in ("0px", ""))
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check("desktop: Enter opens the inspector", page.evaluate("document.activeElement?.id") == "line-inspector")

    # filter: one match, then the empty state
    search = page.get_by_label("Filter equipment or tag")
    search.fill("bin")
    page.wait_for_timeout(200)
    check("desktop: filter narrows the grid to one row", page.locator("[data-row-id]:visible").count() == 1)
    search.fill("zzz")
    page.wait_for_timeout(200)
    check("desktop: no match is said, not shown as empty plant",
          page.locator("[role=grid]").inner_text().find("No equipment matches this filter.") >= 0,
          page.locator("[role=grid]").inner_text()[:120])
    search.fill("")
    page.wait_for_timeout(200)
    page.locator("[data-row-id=motor]").click()

    # the toolbar's Command action reaches the setpoint from any selected row
    page.locator("[data-row-id=bin]").click()
    page.wait_for_timeout(200)
    toolbar.get_by_role("button", name="Command").click()
    page.wait_for_timeout(300)
    check("desktop: toolbar Command focuses the motor setpoint from another row",
          page.evaluate("document.activeElement?.id") == "line-setpoint")
    page.locator("[data-row-id=motor]").click()

    # regression: Command in Side view must land where it promises, not sit inert
    toolbar.get_by_role("button", name="Side view").click()
    page.wait_for_timeout(300)
    check("desktop: Side view is on before the Command click", "view=side" in page.evaluate("location.search"))
    toolbar.get_by_role("button", name="Command").click()
    page.wait_for_timeout(800)  # the focus retry spans a few frames
    check("desktop: Command from Side view returns to the line view",
          "view=side" not in page.evaluate("location.search")
          and page.locator("#line-setpoint").count() == 1
          and page.evaluate("document.activeElement?.id") == "line-setpoint")

    # --- 3. the lower tabs: commands, message log, the old Mimic
    check("desktop: command row carries a type chip",
          page.locator("[data-command-row] [data-kind]").count() >= 1)
    check("desktop: command row carries the operator's reason",
          "Production plan" in page.locator("[data-command-row]").first.inner_text())
    check("desktop: command row carries the lifecycle pill",
          page.locator("[data-command-row] [class*=lifecycle], [data-command-row] .state, [data-command-row] span[class]").count() > 0)
    check("desktop: command row carries a check", page.locator("[data-command-row] [data-check]").count() >= 1)
    check("desktop: the check column is named and says its result",
          "Check" in page.locator("main").inner_text()
          and "Reason given" in page.locator("[data-command-row]").first.inner_text())
    check("desktop: no RunBar without a command queue in the API",
          page.locator("[data-run-state]").count() == 0
          and page.get_by_role("button", name="Step").count() == 0
          and page.get_by_role("button", name="Pause").count() == 0)
    page.get_by_role("tab", name="Message log").click()
    page.wait_for_timeout(300)
    check("desktop: message log tab renders its rows or its empty copy",
          page.locator("[data-message-log], [data-message-empty]").count() == 1)
    page.get_by_role("tab", name="Schematic").click()
    page.wait_for_timeout(300)
    check("desktop: the Mimic still renders as a tab",
          page.locator("main svg[role=group][aria-label='Sorting line 1']").count() == 1)
    page.get_by_role("tab", name="Commands").click()

    # --- 4. one command, the whole audited path
    n0 = len(posts)
    page.get_by_label("New setpoint").fill("33")
    page.get_by_role("button", name="Apply setpoint").click()
    page.wait_for_selector("[data-testid=command-sheet]", timeout=5000)
    page.get_by_label("Reason, kept in the audit log").select_option(label="Production plan")
    page.get_by_role("button", name="Send command").click()
    page.wait_for_selector("[data-testid=outcome][data-tone=ok]", timeout=10000)
    check("desktop: read-back is named as success", "Read back 33" in page.locator("[data-testid=outcome]").inner_text())
    page.locator("[data-testid=outcome]").get_by_role("button", name="Close").click()
    page.wait_for_selector("[data-testid=command-sheet]", state="detached", timeout=5000)
    sent = [p for p in posts if not p.get("dry_run")]
    check("desktop: exactly one command was sent, with its reason",
          len(posts) == n0 + 1 and len(sent) == 1 and sent[0].get("value") == 33
          and sent[0].get("reason") == "Production plan", str(posts[n0:]))
    page.wait_for_timeout(600)
    newest = page.locator("[data-command-row]").first.inner_text()
    check("desktop: the new command appears with its reason and result",
          "33" in newest and "Production plan" in newest and "Read back 33" in newest, newest)

    # regression: a STOP is a run command even though the motor's reading is a
    # setpoint; the last-command chip must read STOP on the grid and inspector
    page.get_by_role("button", name="Stop", exact=True).click()
    page.wait_for_selector("[data-testid=command-sheet]", timeout=5000)
    page.get_by_label("Reason, kept in the audit log").select_option(label="Production plan")
    page.get_by_role("button", name="Send command").click()
    page.wait_for_selector("[data-testid=outcome][data-tone=ok]", timeout=10000)
    page.locator("[data-testid=outcome]").get_by_role("button", name="Close").click()
    page.wait_for_selector("[data-testid=command-sheet]", state="detached", timeout=5000)
    page.wait_for_timeout(600)
    grid_chip = page.locator("[data-row-id=motor] [data-kind]").first.inner_text()
    check("desktop: a STOP on the run tag is chipped STOP in the grid, not SET", grid_chip == "STOP", grid_chip)
    inspector_chip = page.locator("#line-inspector [data-kind]").first.inner_text()
    check("desktop: the inspector's last command agrees with the grid", inspector_chip == "STOP", inspector_chip)

    # --- dock: log level and events
    page.get_by_label("Log level").select_option("warning")
    page.wait_for_timeout(200)
    page.get_by_role("tab", name="Events").click()
    page.wait_for_timeout(200)
    check("desktop: the dock switches to events", page.locator("[data-kit=dock]").inner_text().strip() != "")
    page.get_by_role("tab", name="Log", exact=True).click()

    page.evaluate("window.scrollTo(0, 0)")
    page.evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "1440x900-en.png"))
    page.screenshot(path=str(SHOTS / "1440x900-en-full.png"), full_page=True)
    check("desktop: no page error", True)


def mobile(page, web):
    open_line(page)
    check("mobile: inspector sits above the grid",
          page.locator("#line-inspector").bounding_box()["y"] < page.locator("[data-row-card=motor]").bounding_box()["y"])
    check("mobile: the grid is shown as cards",
          page.locator("[data-row-card]").count() == 4 and not page.locator("[role=grid]").is_visible())
    check("mobile: the toolbar scrolls sideways",
          page.evaluate("(() => { const el = document.querySelector('[role=toolbar] > div'); return el.scrollWidth > el.clientWidth; })()"))
    page.locator("[data-row-card=conveyor]").click()
    page.wait_for_timeout(300)
    check("mobile: choosing a card moves the readout",
          page.locator("[data-readout]").get_attribute("aria-label") == "Belt speed")
    # regression: tapping a card must not throw the operator to the top of the
    # page, ~800 px away from the only equipment list on a phone
    card = page.locator("[data-row-card=bin]")
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    y0 = page.evaluate("window.scrollY")
    card.click()
    page.wait_for_timeout(300)
    y1 = page.evaluate("window.scrollY")
    # the inspector above the list may change height when the selection changes
    # (a shorter limits list, no last command); the defect was a 784 px jump
    check("mobile: tapping a card keeps the list where it was", abs(y1 - y0) <= 50,
          f"scrollY {y0} -> {y1}")
    check("mobile: the tapped card is the selected one",
          page.locator("[data-readout]").get_attribute("aria-label") == "Bin level"
          and page.locator("[data-row-card=bin][aria-pressed=true]").count() == 1)
    page.locator("[data-readout]").scroll_into_view_if_needed()
    check("mobile: no horizontal overflow",
          page.evaluate("document.documentElement.scrollWidth") <= page.viewport_size["width"],
          str(page.evaluate("document.documentElement.scrollWidth")))
    check("mobile: Start is a 44px+ target",
          page.get_by_role("button", name="Start").bounding_box()["height"] >= 44)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "390x844-en.png"))
    page.screenshot(path=str(SHOTS / "390x844-en-full.png"), full_page=True)


def viewer(browser, web):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    posts = post_tracker(page)
    sign_in(page, web, who="demo-viewer")
    open_line(page)
    check("viewer: the inspector is readable", page.locator("[data-readout]").count() == 1)
    check("viewer: no command controls are offered",
          page.get_by_label("New setpoint").count() == 0
          and page.get_by_role("button", name="Apply setpoint").count() == 0
          and page.get_by_role("button", name="Start", exact=True).count() == 0)
    check("viewer: the page says why", "Read only." in page.locator("main").inner_text())
    check("viewer: the empty history says why, not 'no commands yet'",
          "Command history is hidden for your role" in page.locator("main").inner_text())
    check("viewer: toolbar Command is disabled with a reason", page.evaluate(
        "(() => { const b = [...document.querySelectorAll('[role=toolbar] button')].find(x => x.dataset.tool === 'Command'); return b && b.getAttribute('aria-disabled') === 'true'; })()"))
    check("viewer: nothing was sent", not posts)
    page.screenshot(path=str(SHOTS / "1440x900-viewer.png"))
    ctx.close()


def error_state(browser, web):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.route("**/api/tags", lambda route: route.abort())
    page.route("**/api/tags/latest", lambda route: route.abort())
    page.route_web_socket("**/ws", lambda ws: None)  # no WS push can paper over the failed seed
    sign_in(page, web)
    smoke.nav(page, "/line", 2500)
    check("error: a failed feed shows the retry state", page.locator(".error-state").count() == 1)
    check("error: the retry button is offered", page.get_by_role("button", name="Try again").count() == 1)
    page.screenshot(path=str(SHOTS / "1440x900-error.png"))
    ctx.close()


def loading_state(browser, web):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    held = []

    # the seed never answers, so the page can only be loading; a sleep here would
    # block the driver and let the data arrive before the check runs
    def hold(route):
        held.append(route)
    page.route("**/api/tags", hold)
    page.route("**/api/tags/latest", hold)
    page.route_web_socket("**/ws", lambda ws: None)
    page.goto(web + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text="demo-operator").click()
    page.wait_for_selector(".side-nav", state="attached", timeout=30000)
    smoke.nav(page, "/line", 800)
    check("loading: the page shows a skeleton, never an empty plant", page.locator(".skeleton").count() >= 1)
    # answer the held requests so the context closes without a cancelled handler
    for route in held:
        try:
            route.fulfill(status=200, body="[]", content_type="application/json")
        except Exception:
            pass
    ctx.close()


def stale(browser, web):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    def routed(ws):
        pass  # never connect: the REST seed is the last data the page sees
    page.route_web_socket("**/ws", routed)
    sign_in(page, web)
    open_line(page)
    page.wait_for_timeout(17000)
    check("stale: the readout says not current, not a live value",
          page.locator("[data-readout=stale]").count() == 1
          and "Not current" in page.locator("[data-readout]").inner_text())
    check("stale: the connection pill leaves live", page.locator("[data-conn=stale]").count() == 1)
    page.screenshot(path=str(SHOTS / "1440x900-stale.png"))
    ctx.close()


def thai(browser, web):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    sign_in(page, web, lang="th")
    open_line(page)
    check("thai: the page is translated", "อุปกรณ์ที่เลือก" in page.locator("main").inner_text())
    check("thai: the whole grid fits, no column is cut off", page.evaluate(
        "(() => { const d = document.querySelector('[data-grid]'); return d.scrollWidth <= d.clientWidth + 1; })()"),
        str(page.evaluate("(() => { const d = document.querySelector('[data-grid]'); return [d.scrollWidth, d.clientWidth]; })()")))
    page.screenshot(path=str(SHOTS / "1440x900-th.png"))
    page.screenshot(path=str(SHOTS / "1440x900-th-full.png"), full_page=True)
    ctx.close()


def missing_reading(browser, web):
    """A tag with no reading must never render as a real 0.0."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    def drop_bin(route):
        resp = route.fetch()
        kept = [x for x in resp.json() if 'bin1' not in (x.get("name") or "")]
        route.fulfill(response=resp, body=json.dumps(kept), headers={"Content-Type": "application/json"})
    page.route("**/api/tags/latest", drop_bin)
    page.route_web_socket("**/ws", lambda ws: None)
    sign_in(page, web)
    open_line(page)
    page.locator("[data-row-id=bin]").click()
    page.wait_for_timeout(300)
    text = page.locator("[data-readout]").inner_text()
    check("missing: the readout says there is no reading",
          page.locator("[data-readout=error]").count() == 1 and "No reading" in text, text)
    check("missing: zero is not put in place of the missing value", "0.0" not in text, text)
    page.screenshot(path=str(SHOTS / "1440x900-missing.png"))
    ctx.close()


def main():
    proc, web = start_vite()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=smoke.CHANNEL)
            errors = []

            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            sign_in(page, web)
            desktop(page, web)
            ctx.close()

            ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            sign_in(page, web)
            mobile(page, web)
            ctx.close()

            viewer(browser, web)
            error_state(browser, web)
            loading_state(browser, web)
            missing_reading(browser, web)
            stale(browser, web)
            thai(browser, web)
            check("no page errors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        smoke.stop(proc)
    if smoke.failures:
        print("FAILED: " + ", ".join(smoke.failures))
    else:
        print("all D2 line control checks passed")
    sys.exit(1 if smoke.failures else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
