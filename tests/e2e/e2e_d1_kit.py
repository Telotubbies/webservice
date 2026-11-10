"""D1 E2E: the console v6 tokens and component kit.

Done when: every kit component is on /dev/ui in every state, in EN and TH; the
grid moves with the keyboard, Enter opens the inspector, Esc cancels an inline
edit and the focus ring is visible; nothing overflows the page at 1440x900 or
390x844. Screenshots go to .superpowers/sdd/console-v6/D1-shots/.
Run: python -I tests/e2e/e2e_d1_kit.py   (port 5331, --strictPort)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check
ROOT = Path(__file__).resolve().parents[2]
# a worktree lives at <repo>/.claude/worktrees/<id>; the PM reads shots in the repo
if ".claude" in ROOT.parts:
    ROOT = Path(*ROOT.parts[:ROOT.parts.index(".claude")])
SHOTS = ROOT / ".superpowers" / "sdd" / "console-v6" / "D1-shots"
SECTIONS = ["tokens", "toolbar", "tag", "readout", "grid", "chip", "run", "io", "banner", "dock", "conn", "inspector"]


def shot(page, name, full=False):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)


def shots(page, size, lang):
    """The two required viewports, plus the whole gallery for review."""
    page.evaluate("scrollTo(0, 0)")
    page.wait_for_timeout(400)
    shot(page, f"{size}-{lang}", full=False)
    shot(page, f"{size}-{lang}-full", full=True)


def open_kit(page):
    c.nav(page, "/dev/ui", 2500)
    page.wait_for_selector('[data-kit="tokens"]', timeout=20000)


def html_lang(page):
    return page.evaluate("document.documentElement.lang")


def tabs_without_panel(page):
    """Every kit tab must point at a tabpanel that is labelled back by the selected tab."""
    return page.evaluate("""() => {
      const bad = [];
      for (const tab of document.querySelectorAll('[data-kit] [role=tab]')) {
        const name = tab.textContent.trim().slice(0, 20);
        const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
        if (!tab.id) bad.push('tab without id: ' + name);
        if (!panel || panel.getAttribute('role') !== 'tabpanel') { bad.push('tab without tabpanel: ' + name); continue; }
        if (tab.getAttribute('aria-selected') === 'true' && panel.getAttribute('aria-labelledby') !== tab.id) bad.push('panel not labelled by its tab: ' + name);
      }
      return bad;
    }""")


def under_14px(page):
    """The plan §1.5 Thai floor, measured as the review measured it."""
    return page.evaluate("""() => {
      const sels = [
        '[data-kit="io"] h3', '[data-kit="io"] li', '[data-kit="io"] li span:last-child', '[data-kit="io"] [role=tab]',
        '[data-kit="readout"] h3', '[data-kit="readout"] header span', '[data-kit="readout"] dt',
        '[data-kit="readout"] dd', '[data-kit="readout"] .mt-1 span',
        '[data-kit="dock"] [role=tab]', '[data-kit="dock"] [role=tabpanel] p',
        '[data-kit="grid"] > p', '[data-kit="inspector"] p', '[data-kit="toolbar"] p',
        '[data-grid] td', '[data-kit="run"] [role=status]', '[data-kit="conn"] span',
        // grid <th> is 11px overline chrome (§1.2), not Thai running copy; see the report note
      ];
      const bad = [];
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 14) bad.push(`${sel} ${size}px`);
        }
      }
      return bad;
    }""")


def no_clipped_text(page):
    return page.evaluate("""() => {
      const bad = [];
      for (const el of document.querySelectorAll('[data-kit] h1, [data-kit] h2, [data-kit] h3, [data-kit] button span, [data-kit] code, [data-grid] td')) {
        if (el.classList.contains('sr-only')) continue;
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(el.textContent.trim().slice(0, 40));
      }
      return bad;
    }""")


def overflow_offenders(page):
    """Elements whose box sticks out past the viewport (the diagnostic for a page-level scroll)."""
    return page.evaluate("""() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed') {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} right=${Math.round(r.right)}`);
        }
      }
      return out.slice(0, 6);
    }""")


def run(b, web):
    errors = []
    pg = c.new_page(b, c.DESK, errors)
    c.login(pg, web, "demo-admin")
    open_kit(pg)
    check("d1: gallery route renders", pg.locator('[data-kit="tokens"]').count() == 1)
    missing = [s for s in SECTIONS if pg.locator(f'[data-kit="{s}"]').count() == 0]
    check("d1: every component section is present", not missing, ", ".join(missing))
    body = pg.locator("body").inner_text()
    check("d1: English copy on first load", "Console v6 — component kit" in body and "Equipment (8)" in body)
    check("d1: stale and error readouts are labelled", "Not current · 2 min" in body and "Bad quality" in body)
    states = pg.eval_on_selector_all("tr[data-row-state]", "els => els.map(e => e.dataset.rowState)")
    check("d1: the grid renders normal, stale and error rows", {"normal", "stale", "error"} <= set(states), str(states))
    check("d1: the error row names the bad quality", pg.locator('tr[data-row-state="error"]').count() == 1
          and "Bad quality" in pg.locator('tr[data-row-state="error"]').inner_text())

    # tokens actually reach the components
    bg = pg.eval_on_selector('[data-readout="live"]', "el => getComputedStyle(el).backgroundColor")
    check("d1: readout uses the dark panel token", bg == "rgb(18, 24, 33)", bg)
    sel_bg = pg.eval_on_selector('tr[aria-selected="true"]', "el => getComputedStyle(el).backgroundColor")
    check("d1: the selected row uses the row-selected token", sel_bg == "rgb(255, 244, 204)", sel_bg)

    # disabled tool: grey, focusable and with its reason
    tool = pg.locator('[data-tool="I/O map"]')
    check("d1: a disallowed tool is aria-disabled", tool.get_attribute("aria-disabled") == "true")
    check("d1: a disallowed tool explains why", (tool.get_attribute("title") or "") != "")
    check("d1: its reason is in the accessible name", "operator" in tool.inner_text())

    # chips: seven types, each with a word
    kinds = pg.eval_on_selector_all("[data-kind]", "els => els.map(e => e.dataset.kind)")
    check("d1: one chip per command type", set(kinds) >= {"home", "move", "set", "wait", "loop", "end", "other"}, str(kinds))
    check("d1: chips carry text, never colour alone", pg.locator("[data-kind]").first.inner_text().strip() != "")

    # run bar: Step/Pause only when the caller supports them
    bars = pg.locator("[data-run-state]")
    check("d1: four run bars (idle, running, paused, disabled)", bars.count() == 4, str(bars.count()))
    check("d1: running bar offers step and pause", bars.nth(1).get_by_role("button", name="Step").count() == 1)
    check("d1: paused bar hides step and pause", bars.nth(2).get_by_role("button", name="Step").count() == 0 and bars.nth(2).get_by_role("button", name="Pause").count() == 0)

    # I/O panel: tabs are keyboard tabs with a real tabpanel, and they switch
    io = pg.locator('[data-kit="io"] section').first
    io.get_by_role("tab", name="DI inputs").focus()
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(150)
    check("d1: ArrowRight moves to the next I/O tab", io.get_by_role("tab", name="DO outputs").get_attribute("aria-selected") == "true")
    check("d1: I/O tab switches the point list", io.get_by_text("Cement gate open").count() == 1)
    bad_tabs = tabs_without_panel(pg)
    check("d1: every kit tab controls a labelled tabpanel", not bad_tabs, str(bad_tabs))
    check("d1: kit tabs use a roving tabindex", pg.evaluate(
        "() => [...document.querySelectorAll('[data-kit] [role=tab]')].every(t => (t.getAttribute('aria-selected') === 'true') === (t.tabIndex === 0))"))

    io2 = pg.locator('[data-kit="io"] section').nth(1)
    check("d1: an empty I/O tab says so", io2.get_by_text("No points configured for this tab").count() == 1)

    # dock collapses and comes back
    dock = pg.locator('[data-kit="dock"] section').first
    toggle = dock.locator("button[aria-expanded]")
    check("d1: dock starts expanded", toggle.get_attribute("aria-expanded") == "true")
    toggle.click()
    check("d1: dock collapses", toggle.get_attribute("aria-expanded") == "false"
          and not dock.locator('[role="tabpanel"]').is_visible())
    toggle.click()

    # keyboard: arrow moves the row
    pg.locator('tr[data-row-id="skip"] td').nth(1).click()
    check("d1: click selects the row", pg.locator('tr[data-row-id="skip"]').get_attribute("aria-selected") == "true")
    pg.keyboard.press("ArrowDown")
    pg.wait_for_timeout(200)
    check("d1: ArrowDown moves the selection", pg.locator('tr[data-row-id="silo1"]').get_attribute("aria-selected") == "true")
    ring = pg.eval_on_selector('tr[data-row-id="silo1"]', "el => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor]; }")
    check("d1: the focused row keeps a visible focus ring", ring[0] != "none" and float(ring[1].replace("px", "")) >= 2, str(ring))

    # Enter opens the inspector
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(200)
    insp = pg.locator('[data-kit="inspector"]')
    check("d1: Enter opens the selected row in the inspector", "Cement silo 1" in insp.inner_text(), insp.inner_text()[:80])

    # a real mouse click enters the inline editor and keeps the caret there
    pg.locator('tr[data-row-id="silo1"] input[data-col="setpoint"]').click()
    pg.keyboard.type("9")
    entered = pg.evaluate("""() => {
      const el = document.activeElement;
      return [el && el.tagName, el && el.dataset ? el.dataset.col : null, el && el.value];
    }""")
    check("d1: a mouse click enters the inline editor", entered[0] == "INPUT" and entered[1] == "setpoint" and "9" in (entered[2] or ""), str(entered))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)

    # Esc cancels the inline edit
    field = pg.locator('tr[data-row-id="silo1"] input[data-col="setpoint"]')
    field.click()
    field.fill("999")
    before = field.input_value()
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)
    after = field.input_value()
    check("d1: Esc reverts the inline setpoint", before == "999" and after == "40", f"{before} -> {after}")
    check("d1: Esc leaves the keyboard on the row", pg.evaluate(
        "document.activeElement && document.activeElement.getAttribute('data-row-id')") == "silo1", pg.evaluate("document.activeElement.tagName"))

    # Enter commits once and hands the row back the keys, so the next arrow works
    field.click()
    field.fill("700")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(200)
    check("d1: Enter commits the setpoint and leaves the keyboard on the row", pg.evaluate(
        "document.activeElement && document.activeElement.getAttribute('data-row-id')") == "silo1", pg.evaluate("document.activeElement.tagName"))
    # one Enter is one commit; the Esc above must not have committed anything
    check("d1: the edit commits exactly once", pg.locator('[data-commit-count]').get_attribute('data-commit-count') == "1",
          pg.locator('[data-commit-count]').get_attribute('data-commit-count'))
    pg.keyboard.press("ArrowDown")
    pg.wait_for_timeout(200)
    check("d1: arrows still reach the row after an edit", pg.locator('tr[data-row-id="tank"]').get_attribute("aria-selected") == "true")
    pg.locator('tr[data-row-id="skip"] td').nth(1).click()


    check("d1: no clipped label at 1440", not no_clipped_text(pg), str(no_clipped_text(pg)))
    check("d1: no page-level horizontal scroll at 1440", pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), str(overflow_offenders(pg)))
    check("d1: no uncaught page errors", not errors, "; ".join(errors)[:300])
    shots(pg, "1440x900", "en")
    pg.close()

    # Thai, desktop
    pt = c.new_page(b, c.DESK, errors)
    pt.add_init_script("localStorage.setItem('wds.lang', 'th')")
    c.login(pt, web, "demo-admin")
    open_kit(pt)
    tbody = pt.locator("body").inner_text()
    check("d1: Thai copy after the language switch", "คอนโซล v6" in tbody and "อุปกรณ์ (8)" in tbody, html_lang(pt))
    check("d1: Thai stale readout and empty I/O tab", "ไม่เป็นปัจจุบัน" in tbody and "แท็บนี้ยังไม่ได้ตั้งจุด I/O" in tbody)
    check("d1: Thai grid row and chip", "สกิปฮอยส์" in tbody and "เลือกอยู่" in tbody)
    check("d1: Thai error row", "คุณภาพไม่ดี" in pt.locator('tr[data-row-state="error"]').inner_text())
    small = under_14px(pt)
    check("d1: Thai 14px floor in the I/O panel, readout, grid and dock", not small, str(small[:6]))

    check("d1: no clipped Thai label at 1440", not no_clipped_text(pt), str(no_clipped_text(pt)))
    check("d1: no page-level horizontal scroll in Thai", pt.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), str(overflow_offenders(pt)))
    check("d1: no uncaught page errors in Thai", not errors, "; ".join(errors)[:300])
    shots(pt, "1440x900", "th")
    pt.close()

    # mobile, both languages
    for lang in ("en", "th"):
        pm = c.new_page(b, c.MOB, errors)
        pm.add_init_script(f"localStorage.setItem('wds.lang', '{lang}')")
        c.login(pm, web, "demo-admin")
        open_kit(pm)
        check(f"d1 mobile ({lang}): gallery renders", pm.locator('[data-kit="grid"]').count() == 1)
        check(f"d1 mobile ({lang}): toolbar scrolls instead of clipping", pm.eval_on_selector(
            '[data-kit="toolbar"] [role="toolbar"] > div', "el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)"))
        check(f"d1 mobile ({lang}): no clipped text", not no_clipped_text(pm), str(no_clipped_text(pm)))
        check(f"d1 mobile ({lang}): no page-level horizontal scroll", pm.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), str(overflow_offenders(pm)))
        shots(pm, "390x844", lang)
        pm.close()


if __name__ == "__main__":
    c.main(5331, run)
