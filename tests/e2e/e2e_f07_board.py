"""F07 E2E: the 2D plant board built from side captures of the 3D parts.

Run:  python -I tests/e2e/e2e_f07_board.py      (exit 0 = pass)

Starts `MOCK_API=1 vite` on a free port unless WEB_URL is set. The mock keeps
board drafts and versions in server memory, so they survive a page reload;
the session token does not, so a reload signs in again (same as smoke.py).
Journeys (admin, 1440x900 then 390x844):
  first board with no manual step; drag with snap and arrow nudge; lock then
  Auto layout; undo; save draft, reload, publish, roll back; live value, alarm
  colour and stale state on parts; click a part opens the control link.
Fails on any command POST: the board must never write to the PLC.
"""

import importlib.util
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("smoke", HERE / "smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
check, nav = smoke.check, smoke.nav

SHOTS = HERE.parents[1] / ".superpowers" / "sdd" / "product-gap-plan" / "f07-shots"
GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]


def open_board(page, web):
    page.goto(web + "/overview", wait_until="load")
    page.wait_for_selector(".dev-demo", timeout=30000)
    page.locator(".dev-demo", has_text="demo-admin").click()
    page.wait_for_selector(".side-nav", state="attached", timeout=30000)
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")
    nav(page, "/", 2500)
    page.get_by_role("button", name="Board", exact=True).click()
    page.wait_for_selector("[data-testid=plant-board] svg g[data-part]", timeout=120000)
    page.wait_for_timeout(1500)


def pos(page, name):
    g = page.locator(f'svg g[data-part="{name}"]').first
    return int(float(g.get_attribute("data-x"))), int(float(g.get_attribute("data-y")))


def part(page, name):
    return page.locator(f'svg g[data-part="{name}"]').first


def handle(page, name):
    return page.locator(f'svg g[role=button]:has(g[data-part="{name}"])').first


def status(page):
    return page.locator("[data-testid=board-status]").inner_text().strip()


def run(web):
    SHOTS.mkdir(parents=True, exist_ok=True)
    commands, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=smoke.CHANNEL, args=GL)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: commands.append(f"{r.method} {r.url}")
                if r.method in ("POST", "PUT", "PATCH", "DELETE") and "command" in r.url else None)

        # 1. first board, no manual step
        open_board(page, web)
        n = page.locator("svg g[data-part]").count()
        check("board: parts laid out on first open", n >= 20, f"{n} parts")
        check("board: names the plant", "batching plant" in page.locator("[data-testid=board-plant]").inner_text().lower())
        check("board: built-for-you notice", page.get_by_text("so one was built for you").count() == 1)
        xs = {pos(page, "Cement silo 1"), pos(page, "Cement silo 2"), pos(page, "Mixer")}
        check("board: parts do not share a spot", len(xs) == 3)
        page.screenshot(path=str(SHOTS / "board-1440-view.png"), full_page=True)

        # 2. live value / alarm / stale
        # the mock only pushes changed tags, so make silo 1 fresh through the real store path
        page.evaluate("""async () => {
            const { live } = await import('/src/lib/live.ts');
            const p = live.tags[0].name.split('.')[0];
            live.pushTag(p + '.batch.cem.silo1.level_pct', 62.5, 'good', new Date().toISOString());
            for (const n of [2, 3, 4]) live.latest.set(p + `.batch.cem.silo${n}.level_pct`, { v: 40, q: 'good', ts: new Date(Date.now() - 120000).toISOString() });
        }""")
        page.wait_for_selector('svg g[data-part="Cement silo 1"][data-stale="0"]', state='attached', timeout=10000)
        silo1 = part(page, "Cement silo 1")
        check("live: silo 1 shows a number", re.search(r"\d+\s*%", silo1.text_content()) is not None and "———" not in silo1.text_content(), silo1.text_content())
        check("stale: a tag last seen 2 min ago is marked stale", page.locator('svg g[data-part^="Cement silo"][data-stale="1"]').count() >= 1)
        check("live: running part has data", part(page, "Cement silo 1").get_attribute("data-stale") == "0")
        page.evaluate("""async () => {
            const { live } = await import('/src/lib/live.ts');
            const tag = live.tags[0].name.split('.')[0] + '.batch.cem.silo1.level_pct';
            live.upsertAlarm({ id: 'e2e-f07', tag, rule: 'e2e', severity: 'critical', state: 'active', ts: new Date().toISOString() });
        }""")
        page.wait_for_timeout(1500)
        check("alarm: critical colour on the part", part(page, "Cement silo 1").get_attribute("data-alarm") == "critical")
        stroke = part(page, "Cement silo 1").locator("rect").first.get_attribute("stroke")
        check("alarm: uses the critical token", stroke == "var(--color-crit)", stroke)
        page.screenshot(path=str(SHOTS / "board-1440-alarm.png"), full_page=True)

        # 3. drag with snap, arrow nudge
        page.get_by_role("button", name="Edit", exact=True).click()
        before = pos(page, "Aggregate bin 1")
        box = part(page, "Aggregate bin 1").locator("image").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 40, cy + 25, steps=5); page.mouse.move(cx + 83, cy + 47, steps=5); page.mouse.up()
        after = pos(page, "Aggregate bin 1")
        check("drag: part moved", after != before, f"{before} -> {after}")
        check("drag: snapped to the 10 grid", after[0] % 10 == 0 and after[1] % 10 == 0, str(after))
        handle(page, "Aggregate bin 1").focus()
        page.keyboard.press("ArrowRight")
        nudged = pos(page, "Aggregate bin 1")
        check("nudge: arrow moves one grid step", nudged == (after[0] + 10, after[1]), f"{after} -> {nudged}")
        page.keyboard.press("Shift+ArrowDown")
        fine = pos(page, "Aggregate bin 1")
        check("nudge: shift+arrow moves 1 px", fine == (nudged[0], nudged[1] + 1), f"{nudged} -> {fine}")

        # 4. undo
        page.get_by_role("button", name="Undo", exact=True).click()
        check("undo: reverts the last step", pos(page, "Aggregate bin 1") == nudged)
        page.get_by_role("button", name="Undo", exact=True).click()
        page.get_by_role("button", name="Undo", exact=True).click()
        check("undo: back to the auto place", pos(page, "Aggregate bin 1") == before, f"{pos(page, 'Aggregate bin 1')} vs {before}")

        # 5. lock, Auto layout keeps it, unlocked parts return
        handle(page, "Cement silo 1").focus()
        page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowDown")
        mine = pos(page, "Cement silo 1")
        page.get_by_role("button", name="Lock", exact=True).click()
        check("lock: part is flagged locked", part(page, "Cement silo 1").get_attribute("data-locked") == "1")
        handle(page, "Cement silo 1").focus()
        page.keyboard.press("ArrowRight")
        check("lock: arrow keys no longer move it", pos(page, "Cement silo 1") == mine)
        handle(page, "Cement silo 2").focus()
        for _ in range(4):
            page.keyboard.press("ArrowDown")
        moved = pos(page, "Cement silo 2")
        page.get_by_role("button", name="Auto layout", exact=True).click()
        check("auto layout: locked part stays where I put it", pos(page, "Cement silo 1") == mine, f"{mine} vs {pos(page, 'Cement silo 1')}")
        check("auto layout: unlocked part goes back to its auto place", pos(page, "Cement silo 2") != moved)
        page.screenshot(path=str(SHOTS / "board-1440-edit.png"), full_page=True)

        # 6. save draft -> reload -> still there -> publish -> change -> publish -> roll back
        page.get_by_role("button", name="Save draft", exact=True).click()
        page.wait_for_function("document.querySelector('[data-testid=board-status]').innerText.includes('Draft saved')", timeout=10000)
        check("draft: saved", "Draft saved" in status(page), status(page))
        open_board(page, web)           # reload = new session
        page.get_by_role("button", name="Edit", exact=True).click()
        check("draft: survives a reload", part(page, "Cement silo 1").get_attribute("data-locked") == "1" and pos(page, "Cement silo 1") == mine,
              f"{pos(page, 'Cement silo 1')} vs {mine}")
        check("draft: no 'built for you' notice any more", page.get_by_text("so one was built for you").count() == 0)
        page.get_by_role("button", name="Publish", exact=True).click()
        page.wait_for_function("document.querySelector('[data-testid=board-status]').innerText.includes('v1')", timeout=10000)
        check("publish: v1", "v1" in status(page), status(page))
        v1_blower = pos(page, "Blower")
        handle(page, "Blower").focus()
        page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight")
        v2_blower = pos(page, "Blower")
        page.get_by_role("button", name="Publish", exact=True).click()
        page.wait_for_function("document.querySelector('[data-testid=board-status]').innerText.includes('v2')", timeout=10000)
        check("publish: v2 carries the change", "v2" in status(page) and v2_blower != v1_blower, status(page))
        page.locator("#board-ver").select_option(index=2)       # versions are newest first: [blank, v2, v1]
        page.get_by_role("button", name="Roll back to this version").click()
        page.wait_for_function("document.querySelector('[data-testid=board-status]').innerText.includes('v3')", timeout=10000)
        check("rollback: v1 layout is back as v3", pos(page, "Blower") == v1_blower and "v3" in status(page),
              f"{pos(page, 'Blower')} vs {v1_blower}; {status(page)}")

        # 7. click a part -> control link; the board sends no command
        page.get_by_role("button", name="View", exact=True).click()
        page.locator('svg a[aria-label^="Open controls for Mixer"]').first.click()
        page.wait_for_timeout(1500)
        check("click: opens the control page for that part", "/live" in page.url and "part=Mixer" in page.url, page.url)

        # 8. phone width: schematic scrolls inside its card, page does not
        page.set_viewport_size({"width": 390, "height": 844})
        nav(page, "/", 2500)
        page.get_by_role("button", name="Board", exact=True).click()
        page.wait_for_selector("[data-testid=plant-board] svg g[data-part]", timeout=120000)
        page.wait_for_timeout(1000)
        sw = page.evaluate("document.documentElement.scrollWidth")
        check("390: page has no horizontal scroll", sw <= 392, str(sw))
        check("390: board names the plant", page.locator("[data-testid=board-plant]").is_visible())
        page.screenshot(path=str(SHOTS / "board-390.png"), full_page=True)

        check("no command sent by the board", not commands, "; ".join(commands))
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
    print(f"\n{len(smoke.failures)} failure(s)" if smoke.failures else "\nall passed")
    sys.exit(1 if smoke.failures else 0)
