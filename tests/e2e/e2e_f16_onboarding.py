"""F16 E2E: onboarding and plans. Done when: a new user connects the simulator and sees it connected without help,
and the plan pages show real limits next to real usage.
Run: python -I tests/e2e/e2e_f16_onboarding.py   (port 5417)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def wizard(page, tag):
    c.nav(page, "/connect/add", 3000)
    t = c.text(page)
    if tag == "desktop":  # step names are hidden on a phone, the numbers stay
        check("f16 desktop: four steps shown", all(k in t for k in ("Connection", "Details", "Install", "Verify")))
    check(f"f16 {tag}: simulator offered, no hardware needed", "No hardware needed" in t)
    page.get_by_text("Simulator", exact=True).click()
    page.get_by_role("button", name="Continue").click()
    page.wait_for_timeout(800)
    page.locator("#dv-name").fill(f"e2e-sim-{tag}")
    c.shot(page, "f16", f"{tag}-details")
    page.get_by_role("button", name="Create device").click()
    page.wait_for_timeout(2000)
    t = c.text(page)
    check(f"f16 {tag}: one-time code and start command", "ABCD-2345" in t and "docker run" in t and "valid 30 minutes" in t, t[:200])
    check(f"f16 {tag}: no secret in the command", "SECRET" not in t.upper().replace("NOTHING SECRET", ""))
    c.shot(page, "f16", f"{tag}-install")
    page.get_by_role("button", name="I have started it").click()
    page.wait_for_timeout(500)
    check(f"f16 {tag}: waits for the first heartbeat", "connected" not in c.text(page).lower() or page.get_by_role("status").count() >= 1)
    page.wait_for_selector("text=/is connected|connected/i", timeout=20000)
    page.wait_for_timeout(8000)  # the mock heartbeats 5 s after creation; the page polls every 3 s
    t = c.text(page)
    check(f"f16 {tag}: shows connected without any manual refresh", f"e2e-sim-{tag}" in t and "connected" in t.lower(), t[-300:])
    c.shot(page, "f16", f"{tag}-verify")
    check(f"f16 {tag}: no horizontal scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    wizard(pg, "desktop")
    c.nav(pg, "/connect/health", 3000)
    check("f16: connection status page", "Edge gateway" in c.text(pg) and "Connected" in c.text(pg))
    c.nav(pg, "/settings/plans", 3000)
    t = c.text(pg)
    check("f16: plan comparison lists real limits and my usage", "Your usage" in t and "Tags" in t and "87 / 5000" in t, t[:300])
    check("f16: says plans are changed by the platform team, no card", "changed by the platform team" in t)
    c.shot(pg, "f16", "desktop-plans")
    c.nav(pg, "/settings/plan", 3000)
    t = c.text(pg)
    check("f16: usage page shows 'N of M' for each limit", "Tags" in t and " of " in t and "No card is needed" in t)
    c.shot(pg, "f16", "desktop-plan-usage")
    pg.close()
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    wizard(pm, "mobile")
    c.nav(pm, "/settings/plans", 3000)
    c.shot(pm, "f16", "mobile-plans")
    check("f16 mobile: plans page opens", "Compare plans" in c.text(pm))
    check("f16: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5417, run)
