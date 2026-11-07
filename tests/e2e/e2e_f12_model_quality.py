"""F12 E2E: model quality. Done when: confusion matrix and drift come from human-labelled data,
a model that fails its gate cannot be activated (UI shows the refusal and the version stays Draft).
Run: python -I tests/e2e/e2e_f12_model_quality.py   (port 5414)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check


def run(b, web):
    errors, writes = [], []
    pg = c.new_page(b, c.DESK, errors, writes)
    c.login(pg, web, "demo-admin")
    c.nav(pg, "/vision/quality", 3000)
    t = c.text(pg)
    check("f12: confusion matrix with accuracy and n", "Confusion matrix" in t and "accuracy 90%" in t and "n=40" in t, t[:200])
    check("f12: true x predicted grid for the three materials", all(k in t for k in ("Gravel", "Sand", "No material")))
    check("f12: drift states per camera", "Stable" in t and "Drifting" in t)
    check("f12: drift is shown in points", "-21 pp" in t)
    c.shot(pg, "f12", "desktop-quality")
    puts = []
    pg.on("request", lambda r: puts.append((r.method, r.url, r.post_data)) if r.method == "PUT" and "true-material" in r.url else None)
    pg.get_by_role("button", name="Sand").first.click()
    pg.wait_for_timeout(1200)
    check("f12: labelling sends the true material to the event", len(puts) == 1 and "sand" in (puts[0][2] or ""), str(puts)[:200])

    # activation gate: the API refuses (409) -> the UI says so and the version stays Draft
    pg.route("**/activate", lambda route: route.fulfill(status=409, content_type="application/json", body='{"detail":"gate_not_set"}'))
    c.nav(pg, "/vision/models", 3000)
    pg.get_by_role("button", name="Activate").click()
    pg.wait_for_timeout(500)
    pg.get_by_role("checkbox").check()
    pg.get_by_role("button", name="Activate").last.click()
    pg.wait_for_timeout(1500)
    t = c.text(pg)
    check("f12: PPE detector v1 is still Draft after refusal", "Draft" in t)
    body = pg.locator("body").inner_text().lower()
    check("f12: refusal is visible to the user", pg.get_by_role("alert").count() >= 1 or "gate" in body or "could not" in body or "threshold" in body)
    c.shot(pg, "f12", "desktop-activate-refused")
    check("f12: no PLC command sent", not writes, "; ".join(writes))
    pg.close()

    pm = c.new_page(b, c.MOB, errors)
    c.login(pm, web, "demo-admin")
    c.nav(pm, "/vision/quality", 3000)
    check("f12 mobile: matrix visible, no page-level horizontal scroll", "Confusion matrix" in c.text(pm) and pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.shot(pm, "f12", "mobile-quality")
    check("f12: no uncaught page errors", not errors, "; ".join(errors)[:300])


if __name__ == "__main__":
    c.main(5414, run)
