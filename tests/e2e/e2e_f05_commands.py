"""F05 auditable commands, end to end against the mock API.

Run: python -I tests/e2e/e2e_f05_commands.py   (exit 0 = pass)

Journeys (1440x900 and 390x844):
  1. dry run: "Test without sending" runs the checklist and sends NO command
  2. checklist + expected result are shown before anything is sent
  3. reason is required: Send is refused without one; the sent payload carries it
  4. read-back mismatch, unconfirmed (unknown) and timeout are NOT shown as success
  5. the reason and the honest result are visible in the command history
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke  # noqa: E402  (helpers only; smoke.run() is not called)
from playwright.sync_api import sync_playwright  # noqa: E402

check, nav, failures = smoke.check, smoke.nav, smoke.failures
SHOTS = Path(__file__).resolve().parents[2] / ".superpowers" / "sdd" / "product-gap-plan" / "f05-shots"
SHOTS.mkdir(parents=True, exist_ok=True)


def set_fault(page, web, mode):
    r = page.request.post(web + "/api/__mock/fault", data=json.dumps({"mode": mode}),
                          headers={"Content-Type": "application/json"})
    assert r.ok, r.status


def open_sheet(page, value):
    page.get_by_label("New setpoint").fill(str(value))
    page.get_by_role("button", name="Apply setpoint").click()
    page.wait_for_selector("[data-testid=command-sheet]", timeout=5000)


def pick_reason(page, label="Production plan"):
    page.get_by_label("Reason, kept in the audit log").select_option(label=label)


def finish(page):
    page.locator("[data-testid=outcome]").get_by_role("button", name="Close").click()
    page.wait_for_selector("[data-testid=command-sheet]", state="detached", timeout=5000)


def journey(page, web, tag, posts):
    nav(page, "/line", 2500)
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Apply setpoint").first.wait_for(timeout=15000)
    check(f"{tag}: controls reachable", page.get_by_role("button", name="Apply setpoint").count() >= 1)

    # --- 1+2: expected result and empty checklist before anything is sent
    open_sheet(page, 32)
    sheet = page.locator("[data-testid=command-sheet]")
    check(f"{tag}: expected result is shown", "32 Hz" in sheet.locator("[data-testid=expected]").inner_text())
    check(f"{tag}: checklist is not yet run", page.locator("[data-testid=checklist-empty]").count() == 1)
    n0 = len(posts)

    # --- 1: dry run with NO reason: every gate reported, nothing sent
    page.get_by_role("button", name="Test without sending").click()
    page.wait_for_selector("[data-testid=checklist]", timeout=5000)
    items = page.locator("[data-testid=checklist] li")
    check(f"{tag}: checklist lists the gates", items.count() >= 7, f"{items.count()} items")
    check(f"{tag}: missing reason fails the test",
          page.locator("[data-check=reason]").get_attribute("data-ok") == "false"
          and "Test failed" in page.locator("[data-testid=dry-result]").inner_text())
    check(f"{tag}: dry run sent exactly one request, marked dry_run",
          len(posts) == n0 + 1 and posts[-1].get("dry_run") is True and "reason" in posts[-1], str(posts[n0:]))

    # --- 3: Send without a reason is refused client side, nothing posted
    n1 = len(posts)
    page.get_by_role("button", name="Send command").click()
    page.wait_for_timeout(300)
    check(f"{tag}: send without reason is refused",
          page.get_by_text("Choose or write a reason before sending.").count() == 1 and len(posts) == n1)

    # --- 1: dry run with a reason passes and still sends nothing
    pick_reason(page)
    page.get_by_role("button", name="Test without sending").click()
    page.wait_for_function("document.querySelector('[data-testid=dry-result]')?.textContent.includes('passed')", timeout=5000)
    check(f"{tag}: dry run passes, says nothing was sent",
          "Nothing was sent" in page.locator("[data-testid=dry-result]").inner_text()
          and all(p.get("dry_run") for p in posts[n1:]))
    page.screenshot(path=str(SHOTS / f"{tag}-sheet-checked.png"), full_page=True)
    check(f"{tag}: no horizontal overflow",
          page.evaluate("document.documentElement.scrollWidth") <= page.viewport_size["width"],
          str(page.evaluate("document.documentElement.scrollWidth")))
    if tag == "mobile":
        h = page.get_by_role("button", name="Send command").bounding_box()["height"]
        check("mobile: Send is a 44px+ target", h >= 44, str(h))

    # --- 3: real send carries the reason; success only after read-back
    page.get_by_role("button", name="Send command").click()
    page.wait_for_selector("[data-testid=outcome][data-tone=ok]", timeout=8000)
    sent = [p for p in posts if not p.get("dry_run")][-1]
    check(f"{tag}: sent payload carries the reason", sent.get("reason") == "Production plan" and sent["value"] == 32, str(sent))
    check(f"{tag}: success names the read-back value", "Read back 32" in page.locator("[data-testid=outcome]").inner_text())
    finish(page)

    # --- 4: mismatch / unknown / timeout are never success
    for mode, value, tone, expect, absent in [
        ("mismatch", 45, "bad", ["Not successful", "reads 32", "expected 45"], "Done."),
        ("unknown", 46, "warn", ["Not confirmed"], "Done."),
        ("timeout", 47, "bad", ["Not successful", "No reply", "not done"], "Done."),
    ]:
        set_fault(page, web, mode)
        open_sheet(page, value)
        pick_reason(page, "Maintenance")
        page.get_by_role("button", name="Send command").click()
        page.wait_for_selector(f"[data-testid=outcome][data-tone={tone}]", timeout=10000)
        text = page.locator("[data-testid=outcome]").inner_text()
        check(f"{tag}: {mode} is shown as not successful", all(e in text for e in expect) and absent not in text, text)
        if tag == "desktop":
            page.screenshot(path=str(SHOTS / f"{tag}-{mode}.png"), full_page=True)
        finish(page)
        set_fault(page, web, None)


def history(page):
    nav(page, "/commands", 2500)
    body = page.locator("main").inner_text()
    check("history: reason column shows the operator's reason", "Production plan" in body and "Maintenance" in body)
    check("history: mismatch row says not successful with both values",
          "The PLC reads 32, expected 45" in body)
    check("history: unknown row says not confirmed", "Not confirmed" in body)
    check("history: timeout row says no reply", "No reply arrived in time" in body)
    page.screenshot(path=str(SHOTS / "desktop-history.png"), full_page=True)


def main():
    proc, web = smoke.start_vite()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=smoke.CHANNEL)
            errors = []
            for tag, vp in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                ctx = browser.new_context(viewport=vp, has_touch=tag == "mobile")
                page = ctx.new_page()
                page.on("pageerror", lambda e: errors.append(str(e)))
                posts = []

                def on_req(r, posts=posts):
                    if r.method == "POST" and r.url.endswith("/api/commands"):
                        posts.append(json.loads(r.post_data or "{}"))
                page.on("request", on_req)
                page.goto(web + "/overview", wait_until="load")
                page.wait_for_selector(".dev-demo", timeout=30000)
                page.locator(".dev-demo", has_text="demo-operator").click()
                page.wait_for_selector(".side-nav, nav", state="attached", timeout=30000)
                page.wait_for_timeout(1500)
                page.keyboard.press("Escape")
                journey(page, web, tag, posts)
                if tag == "desktop":
                    history(page)
                ctx.close()
            check("no page errors", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        smoke.stop(proc)
    if failures:
        print(f"\n{len(failures)} FAILED: {failures}")
        sys.exit(1)
    print("\nall ok")


if __name__ == "__main__":
    main()
