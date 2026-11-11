"""FX E2E: the defects the as-built capture found.

Done when: every listed route fits a 390x844 phone (no page-level horizontal
scroll), an unknown path shows a 404 that keeps the address on screen and offers
a way back plus the Ctrl+K search (EN and TH), and no page leaves an empty table
without a sentence saying what will appear there.

Run: python -I tests/e2e/e2e_fx_asbuilt.py   (port 5344)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check
SHOTS = Path(__file__).resolve().parents[2] / ".superpowers" / "sdd" / "console-v6" / "FX-shots"

# Routes the capture measured wider than the phone viewport, plus the board id
# the capture followed from /dashboards.
WIDE = [
    ("events", "/events"),
    ("dashboard-view", "/dashboards/11111111-2222-4333-8444-555555555552"),
    ("setup-rules", "/setup/rules"),
    ("channels", "/notifications/channels"),
    ("errors", "/errors"),
    ("admin-keys", "/admin/keys"),
    ("admin-users", "/admin/users"),
    ("assistant", "/assistant"),
]
# Pages whose tables are empty in the mock: each must say so in words.
EMPTY_OK = ["/platform/support", "/platform/announcements", "/production/shifts",
            "/admin/audit", "/alarms/settings", "/incidents/settings"]

# An empty <table> with no text of its own is the bug: nobody can tell whether
# the query returned nothing or the page is still loading.
NO_SILENT_TABLE = """() => [...document.querySelectorAll('main table')]
  .filter((t) => t.querySelectorAll('tbody tr').length === 0)
  .map((t) => (t.closest('section, .card, [class*=rounded]') || t).textContent.trim().slice(0, 80))"""

WIDTH = "() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})"

# The page-level number is not enough: `relative` on a scroll wrapper makes the
# wrapper the containing block of the sr-only cell, so the cell joins the wrapper's
# own scroll range and the table can be scrolled right out of its card.
WRAPPER = """() => [...document.querySelectorAll('main .admin-table')]
  .map((e) => ({sw: e.scrollWidth, cw: e.clientWidth}))"""


def shot(pg, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    pg.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)


def set_lang(pg, want):
    """The shell's user menu flips EN<->TH; returns the language now on <html>."""
    if pg.evaluate("document.documentElement.lang") == want:
        return want
    pg.locator(".user-btn").first.click()
    pg.locator("div.absolute.z-50 button").filter(has_text=re.compile(r"(EN|TH)")).first.click()
    pg.wait_for_timeout(500)
    return pg.evaluate("document.documentElement.lang")


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")

    # 1. phone width, per route: rotate the phone rather than reload the page,
    #    so a layout that only fits on first paint still fails here.
    for name, route in WIDE:
        c.nav(pg, route, 2500)
        pg.set_viewport_size(c.MOB)
        pg.wait_for_timeout(900)
        w = pg.evaluate(WIDTH)
        check(f"fx: {route} fits 390 ({w['sw']}px)", w["sw"] <= 390 and w["cw"] == 390, str(w))
        shot(pg, f"{name}-390")
        pg.set_viewport_size(c.DESK)
        pg.wait_for_timeout(600)
        w = pg.evaluate(WIDTH)
        check(f"fx: {route} fits 1440", w["sw"] <= 1440, str(w))
        shot(pg, f"{name}-1440")

    # 1b. and the wrapper is not a second scroller of its own (the page can fit and
    #     the card still be scrollable away): measured on the tables that carry sr-only.
    for route in ("/setup/rules", "/admin/keys", "/admin/users"):
        c.nav(pg, route, 2500)
        pg.set_viewport_size(c.MOB)
        pg.wait_for_timeout(700)
        boxes = pg.evaluate(WRAPPER)
        check(f"fx: {route} table wrapper has no scroll range of its own",
              len(boxes) > 0 and all(b["sw"] == b["cw"] for b in boxes), str(boxes))
        pg.set_viewport_size(c.DESK)

    # 2. no empty table without a sentence, and /platform/support in particular
    for route in EMPTY_OK:
        c.nav(pg, route, 2200)
        silent = pg.evaluate(NO_SILENT_TABLE)
        check(f"fx: {route} empty table says so", silent == [], str(silent)[:200])
    c.nav(pg, "/platform/support", 2500)
    body = c.text(pg)
    check("fx: support empty state is a sentence", len(body.split()) > 6, body[:200])
    shot(pg, "support-1440")
    pg.set_viewport_size(c.MOB)
    pg.wait_for_timeout(600)
    shot(pg, "support-390")
    pg.set_viewport_size(c.DESK)

    # 3. an unknown path: say which path, offer the way out, keep Ctrl+K alive
    missing = "/this-route-does-not-exist"
    c.nav(pg, missing, 1200)
    body = c.text(pg)
    check("fx: 404 stays on the unknown path", pg.url.endswith(missing), pg.url)
    check("fx: 404 names the path that was opened", missing in body, body[:200])
    check("fx: 404 says the page does not exist", "not found" in body.lower() or "404" in body, body[:200])
    home = pg.get_by_role("link", name=re.compile(r"first page|overview|home", re.I))
    check("fx: 404 has a way back to the first page", home.count() > 0 and home.first.is_visible())
    pg.keyboard.press("Control+k")
    pg.wait_for_timeout(400)
    check("fx: Ctrl+K still opens the search from the 404", pg.locator("[role=dialog] [role=combobox]").count() == 1)
    pg.keyboard.press("Escape")
    shot(pg, "not-found-1440")
    pg.set_viewport_size(c.MOB)
    pg.wait_for_timeout(600)
    w = pg.evaluate(WIDTH)
    check(f"fx: 404 fits 390 ({w['sw']}px)", w["sw"] <= 390, str(w))
    shot(pg, "not-found-390")
    # the copy interpolates the path, so an unbroken 200-char segment must wrap,
    # not widen the page (this is the one URL-controlled string in the console)
    long_path = "/" + "x" * 200
    c.nav(pg, long_path, 1200)
    w = pg.evaluate(WIDTH)
    check(f"fx: 404 with a 200-char path fits 390 ({w['sw']}px)", w["sw"] <= 390, str(w))
    check("fx: 404 still names the long path", long_path in c.text(pg))
    shot(pg, "not-found-390-long")
    c.nav(pg, missing, 900)
    pg.set_viewport_size(c.DESK)
    # both languages carry the same promise
    check("fx: 404 has Thai copy", set_lang(pg, "th") == "th")
    c.nav(pg, missing, 1200)
    th = c.text(pg)
    check("fx: Thai 404 names the path too", missing in th, th[:200])
    check("fx: Thai 404 is Thai", bool(re.search(r"[\u0e00-\u0e7f]", th)), th[:200])
    pg.keyboard.press("Control+k")
    pg.wait_for_timeout(400)
    check("fx: Thai 404 keeps Ctrl+K", pg.locator("[role=dialog] [role=combobox]").count() == 1)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    shot(pg, "not-found-1440-th")
    pv = c.text(pg).lower()
    check("fx: 404 copy did not fall back to English", "search pages" not in pv, pv[:120])

    check("fx: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5344, run)
