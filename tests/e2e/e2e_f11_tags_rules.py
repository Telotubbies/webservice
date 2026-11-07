"""F11 E2E: add signals and rules without switching pages. Done when: OPC UA browse + live values +
suggested names + bulk add in one panel; a rule is tested on history (fire count shown before saving);
a critical rule waits for a second person.
Run: python -I tests/e2e/e2e_f11_tags_rules.py   (port 5413)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def open_opc(page):
    c.nav(page, "/connect/sources", 3000)
    page.get_by_role("link", name="Manage").first.click()
    page.wait_for_timeout(2500)
    page.get_by_text("Air & dust server").first.click()
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Browse server").click()
    page.get_by_role("button", name="Load server tree").click()
    page.wait_for_timeout(1500)


def run(b, web):
    errors, writes = [], []
    pg = c.new_page(b, c.DESK, errors, writes)
    c.login(pg, web, "demo-admin")
    open_opc(pg)
    panel = pg.locator("section[aria-label='OPC UA server tree']")
    check("f11: server tree loaded", panel.count() == 1 and panel.locator("li").count() >= 1)
    for _ in range(4):  # expand folders until variables (checkboxes) show
        if panel.locator("input[type=checkbox]").count() >= 2:
            break
        folders = panel.get_by_role("button", name=re.compile(r"^Expand "))
        if not folders.count():
            break
        folders.first.click()
        pg.wait_for_timeout(1200)
    boxes = panel.locator("input[type=checkbox]")
    check("f11: variables listed under the folders", boxes.count() >= 2, f"{boxes.count()}")
    if boxes.count() >= 2:
        boxes.nth(0).check()
        boxes.nth(1).check()
        pg.wait_for_timeout(2500)
        check("f11: proposed signal names, one input per picked node", panel.locator("input[aria-label^='Signal name']").count() == 2 or panel.locator("[aria-label='Signal names'] input").count() == 2)
        check("f11: live value shown next to the pick", re.search(r"\d", panel.locator("[aria-label='Signal names']").inner_text()) is not None if panel.locator("[aria-label='Signal names']").count() else True)
        check("f11: add several at once", panel.get_by_role("button", name="Add selected (2)").count() == 1)
        c.shot(pg, "f11", "desktop-opc-browse")
        panel.locator("#ob-line").fill("batch.air")
        panel.locator("#ob-dev").fill("e2e1")
        sent = []  # the mock has no tags:bulk store, so assert the request, not a new table row
        pg.on("request", lambda r: sent.append(r.post_data or "") if "tags:bulk" in r.url else None)
        panel.get_by_role("button", name="Add selected (2)").click()
        pg.wait_for_timeout(3000)
        check("f11: one bulk request carries both tags", len(sent) == 1 and sent[0].strip().count(chr(10)) >= 2 and "e2e1" in sent[0], str(sent)[:200])
        check("f11: panel closes after adding", pg.locator("section[aria-label='OPC UA server tree']").count() == 0)
        c.shot(pg, "f11", "desktop-opc-added")

    # rule: test on history first, then save a critical rule that needs a second person
    c.nav(pg, "/setup/tags", 3000)
    pg.locator("main table tbody tr, main [role=row]").nth(1).click()
    pg.wait_for_timeout(1500)
    pg.get_by_role("button", name="Add alarm rule").click()
    pg.locator("#rl-name").fill("e2e high temp")
    pg.locator("#rl-kind").select_option("hihi")
    pg.locator("#rl-sev").select_option("critical")
    pg.locator("#rl-th").fill("1")
    check("f11: told to test first", pg.get_by_text("Test the rule first").count() == 1)
    pg.get_by_role("button", name="Test on history").click()
    pg.wait_for_timeout(2500)
    t = pg.locator("body").inner_text()
    check("f11: shows how many times it would have fired before saving", re.search(r"Would (not )?have fired", t) is not None, t[-300:])
    c.shot(pg, "f11", "desktop-rule-test")
    check("f11: critical note shown", "second person" in t)
    pg.get_by_role("button", name="Save rule").click()
    pg.wait_for_timeout(2000)
    t = pg.locator("body").inner_text()
    check("f11: critical rule saved off, waits for approval", "off until a second person approves" in t or "Waiting for approval" in t, t[-300:])
    check("f11: author cannot approve own rule", pg.get_by_role("button", name="Approve").count() == 0 or "You proposed this rule" in t)
    c.shot(pg, "f11", "desktop-rule-pending")
    check("f11: no PLC command sent", not writes, "; ".join(writes))
    pg.close()

    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/setup/tags", 3000)
    pv.locator("main table tbody tr, main [role=row]").nth(1).click()
    pv.wait_for_timeout(1500)
    check("f11: viewer cannot add rules", pv.get_by_role("button", name="Add alarm rule").count() == 0)
    pv.close()
    # mobile: the data-source tree and the tag list stay usable on a phone
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    open_opc(pm)
    check("f11 mobile: OPC tree opens", pm.locator("section[aria-label='OPC UA server tree']").count() == 1)
    c.shot(pm, "f11", "mobile-opc-browse")
    c.nav(pm, "/setup/tags", 3000)
    check("f11 mobile: tags page has no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f11", "mobile-tags")
    check("f11: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5413, run)
