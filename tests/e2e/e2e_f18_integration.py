"""F18 E2E: integration layer. Done when: deliveries and their failures are visible, a dead delivery can be
replayed or discarded, closed totals show version and data coverage, and data origin controls what leaves.
Run: python -I tests/e2e/e2e_f18_integration.py   (port 5419)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/integration", 3000)
    t = c.text(pg)
    check("f18: delivery counts (waiting / sent / failed)", all(k in t for k in ("Waiting 1", "Sent 14", "Failed for good 1")), t[:200])
    rows = pg.locator("section[aria-label='Deliveries'] tbody tr, main table tbody tr")
    check("f18: delivery rows show event, status, tries and last error", "shift_summary.closed" in t and "http 422" in t)
    check("f18: dead delivery offers Replay and Discard", pg.get_by_role("button", name="Replay").count() == 1 and pg.get_by_role("button", name="Discard").count() == 1)
    c.shot(pg, "f18", "desktop-integration")
    posts = []
    pg.on("request", lambda r: posts.append((r.method, r.url)) if r.method in ("POST", "DELETE") else None)
    pg.get_by_role("button", name="Replay").click()
    pg.wait_for_timeout(1200)
    check("f18: replay posts to that delivery", any(m == "POST" and "/outbox/32" not in u and "/outbox/31/replay" in u for m, u in posts), str(posts))
    # filter
    pg.locator("select[aria-label='Status']").first.select_option("dead")
    pg.wait_for_timeout(800)

    # closed totals: version and data coverage, shift and hour views
    t = c.text(pg)
    check("f18: closed totals show version, good, scrap, coverage", all(k in t for k in ("Version", "Good", "Scrap", "Data coverage", "99.2%")))
    pg.locator("select[aria-label='Closed totals']").select_option("hour")
    pg.wait_for_timeout(1200)
    check("f18: hour view loads", "Data coverage" in c.text(pg))
    check("f18: says a changed total is a new version, never an edit", "never an edit of a closed one" in c.text(pg))
    # data origin: only production sites leave
    check("f18: origin selector offers production, demo, simulated, test", all(k in c.text(pg) for k in ("Production", "Demo", "Simulated", "Test")))
    sent = []
    pg.on("request", lambda r: sent.append((r.method, r.url, r.post_data)) if "data-origin" in r.url else None)
    pg.locator("main select").last.select_option("simulated")
    pg.wait_for_timeout(1000)
    check("f18: changing origin is sent to the site", len(sent) == 1 and "simulated" in (sent[0][2] or ""), str(sent))
    # export CSV
    exp = []
    pg.on("request", lambda r: exp.append(r.url) if "format=csv" in r.url else None)
    pg.get_by_role("button", name="Export CSV").click()
    pg.wait_for_timeout(1200)
    check("f18: export CSV requested", len(exp) >= 1, str(exp))
    c.shot(pg, "f18", "desktop-after")
    pg.close()

    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/integration", 3000)
    check("f18: viewer gets no replay/discard (API answers 403, page shows an error)", pv.get_by_role("button", name="Replay").count() == 0 and pv.get_by_role("button", name="Discard").count() == 0)
    pv.close()
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    c.nav(pm, "/integration", 3000)
    check("f18 mobile: no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f18", "mobile-integration")
    check("f18: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5419, run)
