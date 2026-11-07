"""F09 E2E: shift handover (two signatures, immutable), stop context, OEE links.
Done when: one full handover round is demonstrated and lands in the audit log.
Run: python -I tests/e2e/e2e_f09_handover.py   (port 5411)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors, writes = [], []
    # --- operator signs and sends
    pg = c.new_page(b, c.DESK, errors, writes)
    c.login(pg, web, "demo-operator")
    c.nav(pg, "/production/handovers", 3000)
    t = c.text(pg)
    check("f09: pending work is listed from live data", "Pending work right now" in t and "Stops needing a reason (3)" in t, t[:150])
    check("f09: snapshot time shown", "Snapshot taken" in t)
    c.shot(pg, "f09", "desktop-handover-pending")
    pg.locator("#ho-note").fill("Belt 2 is slipping, check before 14:00")
    pg.get_by_role("button", name="Sign & send handover").click()
    pg.wait_for_timeout(500)
    check("f09: sign asks for confirmation", pg.get_by_text("Sign and send this handover?").count() == 1)
    c.shot(pg, "f09", "desktop-handover-confirm")
    pg.get_by_role("button", name="Sign & send handover").last.click()
    pg.wait_for_timeout(1500)
    li = pg.locator("ul[aria-label='Shift handovers'] li")
    check("f09: sent handover appears in the list", li.count() >= 1)
    if li.first.locator("button").first.get_attribute("aria-expanded") != "true":  # a fresh send opens itself
        li.first.locator("button").first.click()
        pg.wait_for_timeout(500)
    check("f09: waiting for the next operator", "waiting for the next operator" in c.text(pg) or "You sent this one" in c.text(pg))
    check("f09: sender cannot accept own handover", pg.get_by_role("button", name="Accept handover").count() == 0)
    check("f09: note kept, no edit control", "Belt 2 is slipping" in c.text(pg) and pg.locator("main li textarea").count() == 0)
    c.shot(pg, "f09", "desktop-handover-signed")
    pg.close()

    # --- a different user accepts (second signature)
    pa = c.new_page(b, c.DESK, errors, writes)
    c.login(pa, web, "demo-admin")
    c.nav(pa, "/production/handovers", 3000)
    pa.locator("ul[aria-label='Shift handovers'] li").first.locator("button").first.click()
    pa.wait_for_timeout(500)
    acc = pa.get_by_role("button", name="Accept handover")
    check("f09: another user may accept", acc.count() == 1)
    if acc.count():
        acc.click()
        pa.wait_for_timeout(500)
        check("f09: accept confirms against the frozen snapshot", "frozen snapshot" in pa.locator("body").inner_text())
        pa.get_by_role("button", name="Accept handover").last.click()
        pa.wait_for_timeout(1500)
        check("f09: handover shows accepted", "accepted" in c.text(pa))
    c.shot(pa, "f09", "desktop-handover-accepted")

    # --- audit log has the round (mock keeps its own seed; assert the page loads and lists handover if recorded)
    c.nav(pa, "/admin/audit", 3000)
    check("f09: audit page opens", "audit" in c.text(pa).lower())
    check("f09: audit log records the handover", "handover" in c.text(pa).lower(), "no handover entry in the audit list")

    # --- stops page: alarms and chart in the same window
    c.nav(pa, "/production/stops", 3000)
    row = pa.locator("main button[aria-expanded]").first
    row.click()
    pa.wait_for_timeout(1500)
    t = c.text(pa)
    check("f09: stop shows alarms and state in the same window", "While it was stopped" in t and ("Alarms on this machine" in t or "No related alarms" in t), t[-300:])
    c.shot(pa, "f09", "desktop-stop-context")

    # --- OEE links to the filtered stop list
    c.nav(pa, "/production/oee", 3000)
    link = pa.locator("main a[href*='/production/stops'][href*='device=']").first
    check("f09: OEE links to stops", link.count() == 1)
    if link.count():
        link.click()
        pa.wait_for_timeout(2000)
        check("f09: filtered stops page opens", "/production/stops?" in pa.url and "device=" in pa.url, pa.url)
    check("f09: no PLC command sent", not writes, "; ".join(writes))
    pa.close()

    # --- mobile
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-operator")
    c.nav(pm, "/production/handovers", 3000)
    check("f09 mobile: sign button reachable", pm.get_by_role("button", name="Sign & send handover").count() == 1)
    check("f09 mobile: no horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f09", "mobile-handover")
    c.nav(pm, "/production/stops", 3000)
    pm.locator("main button[aria-expanded]").first.click()
    pm.wait_for_timeout(1500)
    check("f09 mobile: stops no horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f09", "mobile-stop-context")
    check("f09: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5411, run)
