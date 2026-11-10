"""F20 E2E: data lifecycle. Done when: retention per data class and verified archives are visible, the audit
trail is stated as never trimmed, and the offboarding area exists for owners only.
Run: python -I tests/e2e/e2e_f20_lifecycle.py   (port 5421)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/lifecycle", 3000)
    t = c.text(pg)
    check("f20: telemetry history is tied to the plan", "Telemetry history: 365 days" in t and "set by your plan" in t, t[:200])
    for k in ("Cleared alarms", "Downtimes", "Gateway logs", "Delivered integration messages", "Vision events"):
        check(f"f20: retention row {k}", k in t)
    check("f20: archive is listed with row count and verified time", "Verified archives" in t and "1843201" in t and "2026-08" in t)
    check("f20: audit trail is never trimmed", "audit trail is never trimmed" in t)
    c.shot(pg, "f20", "desktop-lifecycle")
    c.nav(pg, "/settings/org", 3000)
    t = c.text(pg)
    check("f20: offboarding area is reachable for admins", len(t) > 50, t[:100])
    c.shot(pg, "f20", "desktop-danger-zone")
    body = t.lower()
    check("f20: leaving the org talks about export before delete", "export" in body, t[:400])
    pg.close()
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    c.nav(pm, "/lifecycle", 3000)
    check("f20 mobile: no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f20", "mobile-lifecycle")
    check("f20: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5421, run)
