"""WP-B UI verification — Metrics suite + Trends extensions against the mock
API on :5211 (MOCK_API=1 npx vite --port 5211). Edge channel, EN + TH,
1440px + 390px. Screenshots land in shots/dd-b/.

Run: python -I -X utf8 scripts/ui-verify-ddb.py
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5211'
OUT = Path(__file__).parent.parent / 'shots' / 'dd-b'
OUT.mkdir(parents=True, exist_ok=True)

console_errors = []
page_errors = []
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS' if ok else 'FAIL'), name, detail)


def go(page, path):
    page.evaluate(
        "(p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }",
        path,
    )
    page.wait_for_timeout(900)


def shot(page, name):
    page.screenshot(path=str(OUT / f'{name}.png'))
    print('  shot', name)


def new_ctx(pw, lang, width, height, role_btn=0):
    browser = pw.chromium.launch(channel='msedge')
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    page = ctx.new_page()
    page.on('console', lambda m: console_errors.append(f'{lang}:{width} {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: page_errors.append(f'{lang}:{width} {e}'))
    page.goto(BASE + '/signin', wait_until='domcontentloaded')
    page.evaluate(f"(l) => localStorage.setItem('wds.lang', l)", lang)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('button.dev-demo', timeout=15000)
    page.locator('button.dev-demo').nth(role_btn).click()
    # nav rail is hidden under md — wait for the main landmark to attach instead
    page.wait_for_selector('main', state='attached', timeout=15000)
    page.wait_for_timeout(800)
    return browser, page


def verify_metrics(page, lang, tag):
    for path, name, sel in [
        ('/metrics', 'summary', 'table'),
        ('/metrics/overview', 'overview', 'text'),
        ('/metrics/volume', 'volume', 'table'),
        ('/metrics/settings', 'settings', 'table'),
    ]:
        go(page, path)
        shot(page, f'{tag}-metrics-{name}')
    # content assertions
    go(page, '/metrics')
    rows = page.locator('tbody tr').count()
    check(f'metrics summary rows ({tag})', rows >= 6, f'rows={rows}')
    go(page, '/metrics/overview')
    body = page.inner_text('body')
    check(f'overview silent listed ({tag})', 'vibration_mms' in body)
    check(f'overview counts ({tag})', ('Never reported' if lang == 'en' else 'ไม่เคยรายงาน') in body)
    go(page, '/metrics/volume')
    body = page.inner_text('body')
    check(f'volume silent flag ({tag})', ('silent' if lang == 'en' else 'เงียบ') in body)
    check(f'volume window toggle ({tag})', page.locator('.seg button').count() >= 3)
    go(page, '/metrics/settings')
    body = page.inner_text('body')
    check(f'settings read-only note ({tag})', ('Read only' if lang == 'en' else 'อ่านอย่างเดียว') in body)
    check(f'settings lists silent tag ({tag})', 'vibration_mms' in body)


def verify_trends(page, lang, tag, width):
    go(page, '/trends?tags=plant1.sort.line1.conv1.speed_mps,plant1.sort.line1.conv1.temp_c&w=1h')
    page.wait_for_timeout(1200)
    check(f'trends chart canvas ({tag})', page.locator('.uplot canvas, canvas').count() > 0)
    body = page.inner_text('body').upper()
    check(f'trends sum column ({tag})', ('SUM' if lang == 'en' else 'ผลรวม') in body)

    # add a formula via the composer input (its placeholder shows the grammar)
    finput = page.locator('input[placeholder*="a+b"]')
    if finput.count() == 0:
        finput = page.locator('input[placeholder]').last
    finput.fill('avg(a,b)')
    page.get_by_role('button', name=('Add formula' if lang == 'en' else 'เพิ่มสูตร')).click()
    page.wait_for_timeout(900)
    body = page.inner_text('body')
    check(f'formula row added ({tag})', 'avg(a,b)' in body)
    check(f'formula calc badge ({tag})', ('calculated in your browser' if lang == 'en' else 'คำนวณในเบราว์เซอร์') in body)
    check(f'formula in URL ({tag})', 'f=avg' in page.url or 'f=avg' in page.evaluate('location.href'))

    # bars toggle
    page.get_by_role('button', name=('Bars' if lang == 'en' else 'แท่ง')).click()
    page.wait_for_timeout(600)
    check(f'bars pressed ({tag})', page.get_by_role('button', name=('Bars' if lang == 'en' else 'แท่ง')).get_attribute('aria-pressed') == 'true')
    shot(page, f'{tag}-trends-bars')
    page.get_by_role('button', name=('Lines' if lang == 'en' else 'เส้น')).click()
    page.wait_for_timeout(400)

    # palette picker — open first swatch in stats table (fixed-position popover)
    sw = page.locator('tbody button[title]').first
    sw.click()
    page.wait_for_timeout(400)
    opts = page.locator('[role="listbox"] [role="option"]')
    check(f'palette options ({tag})', opts.count() == 6, f'n={opts.count()} title={sw.get_attribute("title")}')
    if opts.count() == 6:
        opts.nth(3).click()
        page.wait_for_timeout(300)
    shot(page, f'{tag}-trends-palette')

    # CSV export
    with page.expect_download(timeout=5000) as dl:
        page.get_by_role('button', name=('Export CSV' if lang == 'en' else 'ส่งออก CSV')).click()
    d = dl.value
    path = OUT / f'{tag}-trend.csv'
    d.save_as(str(path))
    head = path.read_bytes()[:400].decode('utf-8-sig', 'replace')
    check(f'csv header ({tag})', 'tag' in head and 'value' in head)
    check(f'csv has formula rows ({tag})', 'avg(a,b)' in path.read_text(encoding='utf-8-sig'))

    # add to dashboard
    page.locator('button', has_text=('Add to dashboard' if lang == 'en' else 'เพิ่มลงแดชบอร์ด')).first.click()
    page.wait_for_timeout(400)
    boards = page.locator('[role="group"] ul button').count()
    check(f'dashboard targets listed ({tag})', boards > 0, f'n={boards}')
    page.locator('[role="group"] ul button').first.click()
    page.wait_for_timeout(700)
    body = page.inner_text('body')
    check(f'dashboard notice ({tag})', ('Added to' if lang == 'en' else 'เพิ่มลง') in body)
    shot(page, f'{tag}-trends-full')


def verify_viewer(pw):
    browser, page = new_ctx(pw, 'en', 1440, 900, role_btn=1)
    go(page, '/metrics/overview')
    check('viewer sees overview', 'vibration_mms' in page.inner_text('body'))
    go(page, '/trends?tags=plant1.sort.line1.conv1.temp_c')
    page.wait_for_timeout(900)
    # viewer must not issue dashboard mutations — open the picker then cancel
    btn = page.locator('button', has_text='Add to dashboard')
    check('viewer add-to-dash visible (local boards)', btn.count() == 1)
    req_log = []
    page.on('request', lambda r: req_log.append(r.method + ' ' + r.url))
    if btn.count():
        btn.click()
        page.wait_for_timeout(300)
        first = page.locator('ul button').first
        if first.count():
            first.click()
            page.wait_for_timeout(700)
    mutating = [r for r in req_log if ('/dashboards' in r and r.split(' ')[0] in ('POST', 'PUT', 'DELETE'))]
    check('viewer issued no dashboard mutations', len(mutating) == 0, str(mutating))
    browser.close()


def main():
    with sync_playwright() as pw:
        browser, page = new_ctx(pw, 'en', 1440, 900)
        verify_metrics(page, 'en', 'en-desktop')
        verify_trends(page, 'en', 'en-desktop', 1440)
        browser.close()

        browser, page = new_ctx(pw, 'en', 390, 844)
        go(page, '/metrics')
        shot(page, 'en-mobile-metrics-summary')
        go(page, '/metrics/overview')
        shot(page, 'en-mobile-metrics-overview')
        go(page, '/metrics/volume')
        shot(page, 'en-mobile-metrics-volume')
        go(page, '/metrics/settings')
        shot(page, 'en-mobile-metrics-settings')
        go(page, '/trends?tags=plant1.sort.line1.conv1.temp_c,plant1.sort.line1.bin1.level_pct&w=1h')
        page.wait_for_timeout(1200)
        shot(page, 'en-mobile-trends')
        browser.close()

        browser, page = new_ctx(pw, 'th', 1440, 900)
        verify_metrics(page, 'th', 'th-desktop')
        go(page, '/trends?tags=plant1.sort.line1.conv1.temp_c,plant1.sort.line1.conv1.speed_mps&w=1h')
        page.wait_for_timeout(1200)
        shot(page, 'th-desktop-trends')
        check('th trends labels', 'ผลรวม' in page.inner_text('body'))
        browser.close()

        verify_viewer(pw)

    print('\n=== console errors ===')
    for e in console_errors:
        print(' ', e)
    for e in page_errors:
        print('PAGEERR', e)
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results)} checks, {len(fails)} failed, {len(console_errors)} console errors, {len(page_errors)} page errors')
    sys.exit(1 if fails or page_errors else 0)


if __name__ == '__main__':
    main()
