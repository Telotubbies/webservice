"""F19 E2E: ERP import. Done when: CSV and Odoo go through one path, preview (dry run) comes first and writes
nothing, applying is a separate click, work centers without a machine wait in staging until mapped.
Run: python -I tests/e2e/e2e_f19_erp.py   (port 5420)"""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/integration/erp", 3000)
    t = c.text(pg)
    check("f19: page offers CSV and Odoo import", "Preview CSV" in t and "Preview Odoo (sandbox)" in t)
    check("f19: says the ERP is never written to", "Nothing is ever written b" in t)
    check("f19: Preview and Apply wait for a file", pg.get_by_role("button", name="Preview CSV").is_disabled() and pg.get_by_role("button", name="Apply CSV").is_disabled())
    reqs = []
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.post_data)) if "integration/" in r.url and r.method != "GET" else None)
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "products.csv"
        f.write_text("code,name\nP1,Gravel 10mm\nP2,Sand\n", encoding="utf-8")
        pg.get_by_label("CSV file").set_input_files(str(f))
        pg.get_by_role("button", name="Preview CSV").click()
        pg.wait_for_timeout(1500)
        check("f19: preview is a dry run", any("csv-import" in u and "dry_run=true" in u for _, u, _ in reqs), str(reqs))
        t = c.text(pg)
        check("f19: preview says what it would do", "Would do" in t and "new" in t and "unchanged" in t, t[-300:])
        c.shot(pg, "f19", "desktop-preview")
        check("f19: nothing applied by a preview", not any("dry_run=false" in u for _, u, _ in reqs))
        pg.get_by_role("button", name="Apply CSV").click()
        pg.wait_for_timeout(1500)
        check("f19: apply is a separate request with dry_run=false", any("dry_run=false" in u for _, u, _ in reqs), str(reqs))
        check("f19: CSV body is sent as text/csv content", any("P1,Gravel" in (body or "") for _, _, body in reqs))
    # Odoo preview/sync through the same endpoint family
    pg.get_by_role("button", name="Preview Odoo (sandbox)").click()
    pg.wait_for_timeout(1200)
    check("f19: Odoo preview is a dry run via sync", any("/sync" in u and "dry_run=true" in u for _, u, _ in reqs), str(reqs))
    check("f19: no write method other than POST/PUT to our own API", all(m in ("POST", "PUT") for m, _, _ in reqs))
    # staging: map a work center to a machine
    t = c.text(pg)
    check("f19: unmapped work center waits for a machine", "Work centers waiting for a machine" in t and "Sorting belt" in t)
    pg.get_by_label("Choose a machine").select_option(index=1)
    pg.get_by_role("button", name="Map", exact=True).click()
    pg.wait_for_timeout(1200)
    check("f19: mapping is a PUT to that staged row", any(m == "PUT" and "/staging/7/map" in u for m, u, _ in reqs), str(reqs)[-300:])
    check("f19: recent runs listed", "Recent runs" in c.text(pg) and "unchanged" in c.text(pg))
    c.shot(pg, "f19", "desktop-erp")
    pg.close()
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    c.nav(pm, "/integration/erp", 3000)
    check("f19 mobile: no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f19", "mobile-erp")
    check("f19: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5420, run)
