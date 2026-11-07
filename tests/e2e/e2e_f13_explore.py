"""F13 E2E: explore signals and datasets. Done when: stats come from stored data, the lag chart needs two ticked
tags, a dataset is split by time, and export is requested for that dataset (the server drops simulated
tags and other tenants: see tests/integration/test_t_f13_export.py).
Run: python -I tests/e2e/e2e_f13_explore.py   (port 5415)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/explore", 3500)
    t = c.text(pg)
    check("f13: stats table with min/avg/max/samples", all(k in t for k in ("Min", "Average", "Max", "Samples")))
    rows = pg.locator("section[aria-label='Tag statistics'] tbody tr")
    check("f13: rows come from tag data", rows.count() >= 10, str(rows.count()))
    check("f13: lag section asks for two tags", "Tick two tags above" in t)
    boxes = pg.locator("section[aria-label='Tag statistics'] input[type=checkbox]")
    boxes.nth(0).check()
    boxes.nth(1).check()
    pg.wait_for_timeout(2000)
    t = c.text(pg)
    check("f13: strongest lag is reported", re.search(r"Strongest at lag -?\d+ buckets \(r = -?[\d.]+\)", t) is not None, t[-400:])
    check("f13: lag chart drawn", pg.locator("[role=img][aria-label='Lagged correlation']").count() == 1)
    c.shot(pg, "f13", "desktop-lag")
    check("f13: save disabled without a name", pg.get_by_role("button", name="Save with 2 tags").is_disabled())
    pg.get_by_label("Dataset name").fill("e2e set")
    created = []
    pg.on("request", lambda r: created.append(r.post_data) if r.method == "POST" and r.url.endswith("/datasets") else None)
    pg.get_by_role("button", name="Save with 2 tags").click()
    pg.wait_for_timeout(1500)
    check("f13: dataset POST carries two tags and the name", len(created) == 1 and "tag_ids" in created[0] and "e2e set" in created[0], str(created)[:200])
    t = c.text(pg)
    check("f13: split note: by time, simulated left out", "split by time, not shuffled" in t and "Simulated tags are left out" in t)
    exported = []
    pg.on("request", lambda r: exported.append(r.url) if "export" in r.url else None)
    pg.get_by_role("button", name="Export CSV").first.click()
    pg.wait_for_timeout(1500)
    check("f13: export request goes to the dataset", any("/datasets/" in u and "export" in u for u in exported), str(exported))
    c.shot(pg, "f13", "desktop-datasets")
    pg.close()
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    c.nav(pm, "/explore", 3500)
    check("f13 mobile: no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f13", "mobile-explore")
    check("f13: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5415, run)
