"""F17 E2E: landing page. Done when: it renders at 1440 and 390 without horizontal scroll, honours reduced motion,
sign-in links work, English/Thai switch works, and the copy makes no claim the product cannot back.
Run: python -I tests/e2e/e2e_f17_landing.py   (port 5418)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check
# claims the product does not make today (see docs/product-gap-plan.md F17)
OVERCLAIM = [r"\b99\.9", r"\bSOC ?2\b", r"\bISO ?27001\b", r"\bguarantee", r"\bautonomous", r"\bself-driving\b",
             r"\bno human\b", r"\bcertified\b", r"\b\d+\+? (customers|plants)\b", r"\bcloud GPU\b.*\bfree\b"]


def run(b, web):
    errors = []
    for tag, vp in (("desktop", c.DESK), ("mobile", c.MOB)):
        pg = c.new_page(b, vp, errors)
        pg.goto(web + "/", wait_until="load")
        pg.wait_for_timeout(3500)
        check(f"f17 {tag}: h1 present", pg.locator("h1").count() == 1 and len(pg.locator("h1").inner_text()) > 10)
        check(f"f17 {tag}: no horizontal scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        check(f"f17 {tag}: sign-in links go to /signin", pg.locator("a[href='/signin']").count() >= 1)
        c.shot(pg, "f17", f"{tag}-top")
        pg.mouse.wheel(0, 1800)
        pg.wait_for_timeout(1000)
        c.shot(pg, "f17", f"{tag}-mid")
        body = pg.locator("body").inner_text()
        bad = [p for p in OVERCLAIM if re.search(p, body, re.I)]
        check(f"f17 {tag}: no over-claiming copy", not bad, str(bad))
        check(f"f17 {tag}: AI is described as gated, not autonomous", "gated" in body.lower() or "approves" in body.lower())
        imgs = pg.evaluate("[...document.images].filter(i => i.getAttribute('alt') === null && !i.closest('[aria-hidden=true]')).length")
        check(f"f17 {tag}: images have alt text", imgs == 0, str(imgs))
        pg.close()

    # reduced motion: nothing keeps animating
    ctx = b.new_context(viewport=c.DESK, reduced_motion="reduce")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(web + "/", wait_until="load")
    pg.wait_for_timeout(3500)
    running = pg.evaluate("document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length")
    check("f17: reduced motion stops infinite CSS animations", running == 0, f"{running} still running")
    check("f17: reduced motion still renders the page", pg.locator("h1").count() == 1)
    c.shot(pg, "f17", "desktop-reduced-motion")
    # language switch
    pg.get_by_role("button", name="TH").first.click()
    pg.wait_for_timeout(800)
    check("f17: Thai switch changes the heading", re.search(r"[฀-๿]", pg.locator("h1").inner_text()) is not None)
    ctx.close()
    check("f17: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5418, run)
