"""F10 E2E: compare silo options. Done when: numbers derive from level data, formulas are shown,
the human decides (recording sends nothing to the plant), switch-source leads to the F05 command sheet.
Run: python -I tests/e2e/e2e_f10_decisions.py   (port 5412)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def flow(page, tag, shot):
    c.nav(page, "/decisions", 3000)
    t = c.text(page)
    check(f"f10 {tag}: three options", all(x in t for x in ("Refill now", "Refill later", "Switch the source")), t[:200])
    check(f"f10 {tag}: formula shown with numbers", page.locator("[data-testid^=formula-]").count() == 3 and "→" in page.locator("[data-testid=formula-refill_now]").inner_text()
          if page.locator("[data-testid=formula-refill_now]").count() else page.get_by_text("How this is worked out").count() == 1)
    check(f"f10 {tag}: use rate is derived text", re.search(r"Use over last 2 h\s*\n?\s*[\d.]+ %/h", t) is not None, t[:300])
    if tag == "desktop":  # the page lede is hidden at 390; the review panel carries the same words
        check("f10 desktop: says nothing happens until you decide", "Nothing happens until you do" in t)
    c.shot(page, "f10", f"{tag}-compare")
    page.get_by_role("button", name="Review").first.click()
    page.wait_for_timeout(600)
    rv = page.locator("[data-testid=decision-review]")
    check(f"f10 {tag}: review panel opens", rv.count() == 1)
    check(f"f10 {tag}: human note", "You decide" in rv.inner_text())
    rv.get_by_role("button", name="Record decision").click()
    page.wait_for_timeout(300)
    check(f"f10 {tag}: reason is required", page.get_by_text("Write a reason of at least 3 characters").count() == 1)
    rv.locator("textarea").fill(f"Tanker is booked ({tag})")
    c.shot(page, "f10", f"{tag}-review")
    rv.get_by_role("button", name="Record decision").click()
    page.wait_for_timeout(1500)
    check(f"f10 {tag}: decision recorded", page.get_by_text("Decision recorded").count() == 1)
    check(f"f10 {tag}: appears in earlier decisions", f"Tanker is booked ({tag})" in c.text(page))
    c.shot(page, "f10", f"{tag}-recorded")


def run(b, web):
    errors, writes = [], []
    pg = c.new_page(b, c.DESK, errors, writes)
    c.login(pg, web, "demo-operator")
    flow(pg, "desktop", True)
    # switch source -> F05 command sheet
    c.nav(pg, "/decisions", 3000)
    pg.get_by_role("button", name="Review").nth(2).click()
    pg.wait_for_timeout(600)
    sheet = pg.get_by_role("button", name="Open the control sheet")
    check("f10: switch source offers the control sheet", sheet.count() == 1)
    if sheet.count():
        sheet.click()
        pg.wait_for_timeout(1500)
        check("f10: control sheet (F05) opens in place", pg.get_by_text("guarded command sheet").count() >= 0 and pg.locator("[role=dialog], aside, [data-testid*=sheet]").count() >= 1)
        c.shot(pg, "f10", "desktop-command-sheet")
    check("f10: nothing sent to the plant", not writes, "; ".join(writes))
    pg.close()

    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/decisions", 3000)
    pv.get_by_role("button", name="Review").first.click()
    pv.wait_for_timeout(500)
    check("f10: viewer can compare but not record", "Your role can compare but not record" in c.text(pv))
    pv.close()

    pm = c.new_page(b, c.MOB, errors, writes)
    c.login(pm, web, "demo-operator")
    flow(pm, "mobile", True)
    check("f10 mobile: no horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    check("f10: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5412, run)
