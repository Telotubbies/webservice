"""F14 E2E: platform health. Done when: the screens show measured values (ingest lag, samples, throttled)
and a tenant table; non-staff do not get tenant data.
Run: python -I tests/e2e/e2e_f14_platform.py   (port 5416)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/platform", 3000)
    t = c.text(pg).upper()
    for k in ("PLATFORM HEALTH", "SAMPLES INGESTED", "SAMPLES THROTTLED", "INGEST LAG (AVG)", "DB CONNECTIONS BUSY", "MQTT"):
        check(f"f14: shows {k.lower()}", k in t)
    check("f14: tenants table lists organisations with an ingest column", "INGEST" in t and "DEMO PLANT" in t)
    c.shot(pg, "f14", "desktop-platform")
    pg.get_by_role("link", name="Open").first.click()
    pg.wait_for_timeout(2500)
    check("f14: tenant page opens", "/platform/orgs/" in pg.url, pg.url)
    c.shot(pg, "f14", "desktop-platform-org")
    c.nav(pg, "/connect/health", 3000)
    t = c.text(pg)
    check("f14: service health shows broker, database, websocket", all(k in t for k in ("Message broker", "Database", "WebSocket")))
    c.shot(pg, "f14", "desktop-health")
    pg.close()
    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/platform", 3000)
    check("f14: non-staff do not see tenant data", "Demo Plant" not in c.text(pv), c.text(pv)[:200])
    pv.close()
    check("f14: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5416, run)
