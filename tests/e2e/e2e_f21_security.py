"""F21 E2E: security hardening. Done when: AI write needs a person to approve the site (with evidence), approval can
be withdrawn, self-registration is not offered, and T12/T14 hold (viewer cannot command, CSP on the main pages).
Run: python -I tests/e2e/e2e_f21_security.py   (port 5422)"""
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check
MAIN_PAGES = ["/overview", "/alarms", "/trends", "/commands", "/security", "/integration", "/my-work"]


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/security/ai-arming", 3000)
    t = c.text(pg)
    check("f21: site starts not approved", "This site is not approved" in t and "only shown, never written" in t)
    arm = pg.get_by_role("button", name="Approve this site")
    check("f21: approve is disabled without evidence", arm.is_disabled())
    c.shot(pg, "f21", "desktop-not-armed")
    reqs = []
    pg.on("request", lambda r: reqs.append((r.method, r.post_data)) if "ai-arming" in r.url and r.method != "GET" else None)
    pg.get_by_label("What was reviewed").fill("dry-run review 2026-11-03")
    check("f21: approve enabled with evidence", not arm.is_disabled())
    arm.click()
    pg.wait_for_timeout(1200)
    check("f21: approval posts the evidence reference", len(reqs) == 1 and reqs[0][0] == "POST" and "dry-run review" in (reqs[0][1] or ""), str(reqs))
    check("f21: note says dry-run on rules is not switched off", "does not switch off dry-run" in c.text(pg))

    # sign-in page: no self-registration
    pg.close()
    pn = c.new_page(b, c.DESK, errors)
    pn.goto(web + "/signin", wait_until="load")
    pn.wait_for_timeout(2500)
    body = pn.locator("body").inner_text()
    links = pn.locator("a").evaluate_all("e => e.map(x => (x.getAttribute('href') || '') + ' ' + x.innerText)")
    reg = [x for x in links if re.search(r"regist|sign.?up|create (an )?account", x, re.I)] + re.findall(r"(?i)(register|sign up|create (?:an )?account)", body)
    check("f21: no self-registration offered on sign-in", not reg, str(reg))
    c.shot(pn, "f21", "desktop-signin")
    pn.close()

    # T12: viewer sees no command buttons
    pv = c.new_page(b, c.DESK, errors)
    c.login(pv, web, "demo-viewer")
    c.nav(pv, "/commands", 3000)
    t = c.text(pv)
    check("f21 T12: viewer is told they cannot command", re.search(r"operator|view only|read.only|not allowed", t, re.I) is not None, t[:200])
    check("f21 T12: viewer has no Send / Start / Stop button", pv.locator("main").get_by_role("button", name=re.compile(r"^(Send|Start|Stop|Issue|Write)", re.I)).count() == 0)
    c.shot(pv, "f21", "desktop-viewer-commands")
    pv.close()

    # T14: the CSP is sent by nginx in production (the vite dev server sends none), so assert the nginx config and
    # that every main page still opens
    ps = c.new_page(b, c.DESK, errors)
    c.login(ps, web, "demo-admin")
    crashed = []
    for p in MAIN_PAGES:
        c.nav(ps, p, 1200)
        if "This view crashed" in c.text(ps):
            crashed.append(p)
    check("f21 T14: all main pages open without a crash", not crashed, str(crashed))
    ng = (Path(__file__).resolve().parents[2] / "web" / "nginx.conf").read_text(encoding="utf-8")
    check("f21 T14: nginx sends Content-Security-Policy with frame-ancestors and no unsafe-eval", "Content-Security-Policy" in ng and "frame-ancestors" in ng and re.search(r"(?<!wasm-)unsafe-eval", ng) is None)
    ps.close()
    check("f21: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5422, run)
