"""F06 alarm response journeys against the web dev server + mock API.

Run:  python -I tests/e2e/e2e_f06_alarms.py      (exit 0 = pass)

Reuses tests/e2e/smoke.py (vite start/stop, check, nav). The mock raises an
alarm on demand (POST /api/mock/alarms/raise), brings it back to normal
(/<id>/return) and makes a shelf run out (/<id>/expire-shelf), so every
journey runs against a live Active alarm.
"""

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import smoke  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS = Path(__file__).resolve().parents[2] / ".superpowers" / "sdd" / "product-gap-plan" / "f06-shots"
SHOTS.mkdir(parents=True, exist_ok=True)
check = smoke.check
nav = smoke.nav


WEB = ""


def hook(page, path, body=None):
    """Mock-only hook; not an app request, so it is kept out of the POST audit."""
    return page.request.post(WEB + path, data=body or {}).json()


def raise_alarm(page, rule_id):
    a = hook(page, "/api/mock/alarms/raise", {"rule_id": rule_id})
    return str(a["id"])


def sign_in(page, web):
    page.goto(web + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text="demo-operator").click()
    page.wait_for_selector(".side-nav", state="attached", timeout=30000)
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")


def open_list(page, aid, mobile=False):
    """Open /alarms with the new alarm in the list. The token is in memory, so if the live
    socket missed the raise (it reconnects now and then) sign in again to take a fresh seed."""
    sel = f"li[data-alarm-id='{aid}']" if mobile else f"tr[data-alarm-id='{aid}']"
    nav(page, "/alarms", 2500)
    if page.locator(sel).count() == 0:
        size = page.viewport_size
        page.goto(WEB + "/overview", wait_until="load")
        sign_in_page(page)
        page.set_viewport_size(size)
        nav(page, "/alarms", 2500)


def sign_in_page(page):
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text="demo-operator").click()
    page.wait_for_selector(".side-nav", state="attached", timeout=30000)
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")


def row(page, aid):
    return page.locator(f"tr[data-alarm-id='{aid}']")


def run(web):
    global WEB
    WEB = web
    posts, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=smoke.CHANNEL)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: posts.append(f"{r.method} {r.url}")
                if r.method in ("POST", "PUT", "PATCH", "DELETE") and "/api/mock/" not in r.url else None)
        a1 = raise_alarm(page, "r-1")  # Belt temperature HiHi, critical; raised before sign-in so the seed has it
        sign_in(page, web)

        # 1. list -> detail, in the order the board gives
        nav(page, "/alarms", 2500)
        check("list: raised alarm is on the Active tab", row(page, a1).count() == 1)
        check("list: density strip shows the flood readout", "per 10 min" in page.locator("section[aria-label]").first.inner_text()
              or page.locator("[data-flood]").count() == 1)
        page.screenshot(path=str(SHOTS / "01-list-1440.png"))
        row(page, a1).click()
        page.wait_for_selector("main h1", timeout=10000)
        page.wait_for_timeout(1500)
        check("detail: url and title", f"/alarms/{a1}" in page.url and "Belt temperature HiHi" in page.locator("main h1").inner_text())
        main = page.locator("main").inner_text()
        check("detail: says nobody has acknowledged", "No one has acknowledged" in main)
        check("detail: response guidance (cause, consequence, steps)",
              "Likely cause" in main and "If ignored" in main and "Return the speed setpoint" in main)
        check("detail: respond-within clock", page.get_by_test_id("respond-due").count() == 1
              and "Respond within" in page.get_by_test_id("respond-due").inner_text())
        page.wait_for_selector(".u-wrap canvas", timeout=15000)
        check("detail: standard chart mounted", page.locator(".u-wrap canvas").count() >= 1)
        page.screenshot(path=str(SHOTS / "02-detail-1440.png"), full_page=True)

        # 2. Trends and Live links
        href = page.get_by_test_id("pivot-trends").get_attribute("href")
        check("trends link carries signal and window", "tags=" in href and "from=" in href and "to=" in href, href)
        page.get_by_test_id("pivot-trends").click()
        page.wait_for_timeout(3000)
        check("trends link opens Trends on this signal", page.url.split("?")[0].endswith("/trends")
              and "conv1.temp_c" in page.url, page.url)
        page.go_back()
        page.wait_for_selector("main h1", timeout=10000)
        page.get_by_test_id("pivot-live").click()
        page.wait_for_timeout(2500)
        check("live link opens Live", page.url.rstrip("/").endswith("/live"), page.url)
        check("live page has content", len(page.locator("main").inner_text().strip()) > 50)
        nav(page, f"/alarms/{a1}", 2500)

        # 3. shelve needs a reason, then runs out
        page.get_by_role("button", name="Shelve…").click()
        dlg = page.get_by_role("dialog")
        check("shelve: dialog opens", dlg.count() == 1)
        before = len([x for x in posts if "/shelve" in x])
        dlg.get_by_role("button", name="Shelve alarm").click()
        page.wait_for_timeout(400)
        check("shelve: no reason is refused in the dialog", "Choose a reason" in dlg.inner_text())
        check("shelve: nothing was sent without a reason", len([x for x in posts if "/shelve" in x]) == before)
        dlg.get_by_label("Maintenance in progress").check()
        dlg.get_by_label("Shelve for").select_option("60")
        page.screenshot(path=str(SHOTS / "03-shelve-dialog-1440.png"))
        dlg.get_by_role("button", name="Shelve alarm").click()
        page.wait_for_selector("[data-testid=shelf-banner]", timeout=8000)
        banner = page.get_by_test_id("shelf-banner").inner_text()
        check("shelve: banner names who and why", "Maintenance in progress" in banner and "Shelved until" in banner, banner)
        check("shelve: no second Shelve button while shelved", page.get_by_role("button", name="Shelve…").count() == 0)
        nav(page, "/alarms", 2000)
        page.get_by_role("tab", name="Shelved").click()
        page.wait_for_timeout(1500)
        shelf = page.locator(f"tr[data-shelved-id='{a1}']")
        check("shelved list: who, why and time left", shelf.count() == 1 and "Maintenance in progress" in shelf.inner_text()
              and "min" in shelf.inner_text(), shelf.inner_text() if shelf.count() else "")
        page.screenshot(path=str(SHOTS / "04-shelved-list-1440.png"))
        hook(page, f"/api/mock/alarms/{a1}/expire-shelf")
        page.wait_for_timeout(3500)
        nav(page, "/overview", 800)
        nav(page, "/alarms", 1500)
        page.get_by_role("tab", name="Shelved").click()
        page.wait_for_timeout(1500)
        check("shelved list: the shelf drops off when it runs out", page.locator(f"tr[data-shelved-id='{a1}']").count() == 0, page.locator('main').inner_text()[-300:])
        # a cleared alarm cannot be shelved
        page.get_by_role("tab", name="Cleared").click()
        page.wait_for_timeout(1000)
        cleared = page.locator("main tr[data-alarm-id]").first
        if cleared.count():
            cleared.click()
            page.wait_for_selector("main h1", timeout=10000)
            check("shelve: not offered on a cleared alarm", page.get_by_role("button", name="Shelve…").count() == 0)

        # 4. ack from the list
        a2 = raise_alarm(page, "r-5")  # Mixer current HiHi
        open_list(page, a2)
        check("ack from list: row has an Acknowledge button", row(page, a2).locator("button.btn-ack").count() == 1)
        row(page, a2).locator("button.btn-ack").click()
        page.wait_for_timeout(1500)
        check("ack from list: the row no longer waits for an ack", row(page, a2).count() == 0 or "Acknowledged" in row(page, a2).inner_text())

        # 5. returned to normal, not acknowledged
        a3 = raise_alarm(page, "r-2")  # Sorter bin level Hi
        hook(page, f"/api/mock/alarms/{a3}/return")
        open_list(page, a3)
        check("rtn_unack: still on the Active tab", row(page, a3).count() == 1)
        chip = row(page, a3).locator("[data-state='rtn_unack']")
        check("rtn_unack: its own chip, not Active or Cleared", chip.count() == 1 and "Returned, needs ack" in chip.inner_text())
        check("rtn_unack: the Active chip is not used", row(page, a3).locator("[data-state='active']").count() == 0)
        page.screenshot(path=str(SHOTS / "05-rtn-unack-1440.png"))
        row(page, a3).locator("button.btn-ack").click()
        page.wait_for_timeout(1500)
        check("rtn_unack: acknowledging closes it", row(page, a3).count() == 0)

        # 6. ack link shows what it is about before the button
        a4 = raise_alarm(page, "r-3")  # Belt speed Lo, warning
        nav(page, f"/ack/mock-{a4}", 2500)
        ctx = page.get_by_test_id("ack-context")
        check("ack link: shows alarm name, priority and signal first",
              ctx.count() == 1 and "Belt speed Lo" in ctx.inner_text() and "Warning" in ctx.inner_text()
              and "conv1.speed_mps" in ctx.inner_text(), ctx.inner_text() if ctx.count() else "")
        check("ack link: opening it acknowledged nothing", not [x for x in posts if "/api/v1/ack/" in x])
        page.screenshot(path=str(SHOTS / "06-ack-link-1440.png"))
        page.get_by_role("button", name="Acknowledge").click()
        page.wait_for_timeout(1500)
        check("ack link: tap acknowledges", "Alarm acknowledged" in page.locator("main").inner_text())

        # 7. phone
        a5 = raise_alarm(page, "r-11")  # Dust filter, warning
        page.set_viewport_size({"width": 390, "height": 844})
        open_list(page, a5, mobile=True)
        card = page.locator(f"li[data-alarm-id='{a5}']")
        check("phone: alarm card with Acknowledge", card.count() == 1 and card.locator("button.btn-ack").count() == 1)
        h = card.locator("button.btn-ack").bounding_box()["height"]
        check("phone: Acknowledge target is at least 44px", h >= 44, str(h))
        page.screenshot(path=str(SHOTS / "07-list-390.png"))
        card.click()
        page.wait_for_selector("main h1", timeout=10000)
        page.wait_for_timeout(1500)
        shelve_h = page.get_by_role("button", name="Shelve…").bounding_box()["height"]
        check("phone: Shelve target is at least 44px", shelve_h >= 44, str(shelve_h))
        check("phone: no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        page.screenshot(path=str(SHOTS / "08-detail-390.png"), full_page=True)

        bad = [x for x in posts if "command" in x]
        check("no command was sent", not bad, "; ".join(bad))
        check("no uncaught page errors", not errors, "; ".join(errors)[:300])
        browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    proc = None
    web = os.environ.get("WEB_URL")
    if not web:
        proc, web = smoke.start_vite()
    try:
        run(web)
    finally:
        if proc:
            smoke.stop(proc)
    print("FAILED: " + ", ".join(smoke.failures) if smoke.failures else "all F06 checks passed")
    sys.exit(1 if smoke.failures else 0)
