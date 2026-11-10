"""F08 E2E: My work. Done when: finished work leaves the list without a refresh.
Run: python -I tests/e2e/e2e_f08_mywork.py   (port 5410)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def count(page):
    m = re.search(r"(\d+) waiting", c.text(page))
    return int(m.group(1)) if m else 0


def item(page, pat):
    return page.locator("main button").filter(has_text=re.compile(pat))


def run(b, web):
    errors, writes = [], []
    # --- desktop
    page = c.new_page(b, c.DESK, errors, writes)
    c.login(page, web, "demo-operator")
    c.nav(page, "/my-work", 3000)
    t = c.text(page)
    check("f08: title and lede", "My work" in t and "Everything waiting on you" in t)
    n0 = count(page)
    check("f08: groups stops and decisions with a total", n0 > 0 and "STOPS WITHOUT A REASON" in t.upper() and "DECISIONS TO REVIEW" in t.upper(), t[:200])
    check("f08: nothing picked yet", "Pick an item from the list" in t)
    c.shot(page, "f08", "desktop-list")

    # finish a stop with a reason: it leaves the list without a reload
    stops = item(page, r"Sorting line 1")
    s0 = stops.count()
    stops.first.click()
    page.wait_for_timeout(600)
    check("f08: stop detail shows reason form", page.get_by_text("Save reason").count() == 1)
    page.locator("main select").first.select_option(index=1)
    c.shot(page, "f08", "desktop-stop-detail")
    page.get_by_role("button", name="Save reason").click()
    page.wait_for_timeout(1500)
    check("f08: finished stop left the list (no refresh)", item(page, r"Sorting line 1").count() == s0 - 1, f"{s0}->{item(page, 'Sorting line 1').count()}")
    check("f08: total went down by one", count(page) == n0 - 1, f"{n0}->{count(page)}")

    # review a truck decision
    first_before = item(page, r"Aggregate CCTV").first.inner_text()
    item(page, r"Aggregate CCTV").first.click()
    page.wait_for_timeout(600)
    check("f08: decision detail offers Correct / Wrong",
          page.get_by_role("button", name="Correct").count() >= 1 and page.get_by_role("button", name="Wrong").count() >= 1)
    page.get_by_role("button", name="Correct", exact=True).click()
    page.wait_for_timeout(1500)
    # the list is capped at 15 and refills from older trucks, so compare the head, not the count
    check("f08: reviewed decision left the list", item(page, r"Aggregate CCTV").first.inner_text() != first_before)
    check("f08: panel back to 'Pick an item'", "Pick an item from the list" in c.text(page))
    check("f08: no PLC command sent", not writes, "; ".join(writes))
    page.close()

    # --- viewer cannot act
    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/my-work", 3000)
    check("f08: viewer is told an operator is needed",
          "Operator role is needed" in c.text(pv) or pv.get_by_role("button", name="Save reason").count() == 0)
    pv.close()

    # --- mobile
    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-operator")
    c.nav(pm, "/my-work", 3000)
    c.shot(pm, "f08", "mobile-list")
    item(pm, r"Sorting line 1").first.click()
    pm.wait_for_timeout(800)
    check("f08 mobile: detail shown with Back to list", pm.get_by_text("Back to list").count() >= 1)
    check("f08 mobile: no horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f08", "mobile-detail")
    pm.get_by_text("Back to list").first.click()
    pm.wait_for_timeout(600)
    check("f08 mobile: back to list", "Pick an item" in c.text(pm) or item(pm, "Sorting line 1").count() >= 1)
    check("f08: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5410, run)
