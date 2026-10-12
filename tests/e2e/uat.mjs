import { execSync } from 'child_process';

// Playwright is a dev dependency of whatever project installs it — resolve
// via PLAYWRIGHT_PATH (absolute path to index.mjs) or the package name.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright')
  .catch(() => {
    throw new Error(
      'playwright not resolvable — run `npm i playwright` somewhere on the ' +
      'module path, or set PLAYWRIGHT_PATH=/abs/path/to/playwright/index.mjs'
    );
  });

const REPO = new URL('../../', import.meta.url).pathname;
const BASE = 'http://localhost:5173';
const API = 'http://localhost:8000';
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// doc 17 topic identity of the dev-seeded edge (UUIDs only)
const ORG = '0199d000-0000-7000-8000-00000000a001';
const SITE_ID = '0199d000-0000-7000-8000-00000000b001';
const EDGE = '0199d000-0000-7000-8000-00000000c001';
const V2 = `v2/${ORG}/${SITE_ID}/${EDGE}`;

// --- MQTT helper: publish telemetry via paho as the `tester` dynsec
// identity (TLS :8883, test profile only — secret lives in infra/secrets) ---
function pub(tag, v, q = 'good') {
  const ts = new Date().toISOString();
  const py = `import paho.mqtt.client as m,json,time,pathlib
pw=pathlib.Path('${REPO}/infra/secrets/tester_pw').read_text().strip()
c=m.Client(m.CallbackAPIVersion.VERSION2)
c.username_pw_set('tester',pw)
c.tls_set(ca_certs='${REPO}/infra/certs/ca.crt')
c.connect('localhost',8883,10)
c.loop_start()
c.publish('${V2}/tele/sort/line1/conv1/${tag}',json.dumps({'v':${JSON.stringify(v)},'q':'${q}','ts':'${ts}'}),qos=1)
time.sleep(0.6)
c.loop_stop();c.disconnect()`;
  execSync(`python3 -c "${py.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { cwd: '/tmp' });
}

async function getAlarms(state) {
  const r = await fetch(`${API}/api/alarms?state=${state}`, { headers: { Authorization: 'Bearer demo-operator' } });
  return r.json();
}

// --- Phase 1: stop edge so sim doesn't race injected values ---
console.log('stopping edge-bridge...');
execSync('docker compose -f /home/supawich/Desktop/webservice/docker-compose.yml stop edge-bridge');

// PW_EXECUTABLE pins a browser path when the default revision isn't
// installed; otherwise playwright resolves the matching browser itself.
const browser = await chromium.launch(process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrs = [];
const badResponses = [];
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

try {
  // ============ ANONYMOUS -> SIGN-IN WALL (v4 T5) ============
  // No anonymous reads: the unauthenticated load must produce a formal
  // sign-in wall — no shell, no tiles, no API traffic beyond public probes.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // the silent-renew probe runs before the wall — give it room to settle
  await page.waitForSelector('.signin-card', { timeout: 20000 }).catch(() => {});
  ok('wall: sign-in card renders', await page.locator('.signin-card').count() === 1);
  ok('wall: SSO button renders', await page.locator('.oidc-signin').count() === 1);
  ok('wall: no shell while signed out', await page.locator('.side-nav').count() === 0);
  ok('wall: no tiles while signed out', await page.locator('.tile').count() === 0);
  {
    const r = await fetch(`${API}/api/tags`);
    ok('api: anonymous read is 401', r.status === 401, `${r.status}`);
    const h = await fetch(`${API}/api/health`);
    ok('api: health probe stays public', h.status === 200, `${h.status}`);
  }
  // dev-mode wall offers the demo-token row (UAT runs APP_ENV=dev)
  ok('wall: dev-token input (dev only)', await page.locator('.token-input').count() === 1);

  // ============ OPERATOR (dev-token sign-in via the wall) ============
  await page.fill('.token-input', 'demo-operator');
  await page.keyboard.press('Enter');
  await sleep(2000);
  ok('operator: shell renders after sign-in', await page.locator('.side-nav').count() === 1);
  ok('operator: signed in (role shown)', await page.locator('.user-btn').count() === 1);

  // NEW: sidebar shell
  ok('sidebar nav renders', await page.locator('.side-nav').count() === 1);
  ok('sidebar nav items', (await page.locator('a.tab, button.tab').allTextContents()).join(',').includes('Overview'));
  ok('topbar breadcrumb', (await page.locator('.topbar').innerText()).includes('plant1'));
  ok('topbar clock ticking', /\d{2}:\d{2}/.test(await page.locator('.top-clock').innerText()));
  ok('live pill in topbar', await page.locator('.topbar .live-pill').count() === 1);

  // Tiles + sparkline (NEW)
  const tileCount = await page.locator('.tile').count();
  ok('tiles render', tileCount >= 5, `${tileCount} tiles`);
  const tempVal = await page.locator('.tile-val').first().innerText();
  ok('tile values render', tempVal.trim().length > 0);
  ok('sparkline in tile', await page.locator('.tile svg').count() > 0);
  ok('cam1 STUB badge', await page.locator('.tile-stub-badge').count() > 0);

  // Insight rail (v3): ALWAYS rendered on Overview — severity-sorted chips when
  // open insights exist, otherwise a single calm empty line (never absent).
  ok('insight rail renders on overview',
    await page.locator('.insight-rail').count() === 1
    && await page.locator('.insight-rail .insight-chip, .insight-rail .insight-rail-empty').count() > 0);

  // Operator sees the Controls/Commands surface (a viewer would not)
  ok('operator: commands tab visible',
    await page.locator('a.tab[href="/commands"]').count() === 1);

  // ============ ALARM LIFECYCLE via real MQTT injection ============
  // fire alarm
  await pub('temp_c', 95, 'good');
  await page.click('a.tab[href="/alarms"]');
  await sleep(2500);
  const activeRow = page.locator('.alarm-row.alarm-active, .alarm-row').filter({ hasText: 'temp' }).first();
  ok('alarm row appears', await activeRow.count() > 0);
  ok('sev pill on row', await page.locator('.alarm-row [class*=sev], .alarm-row .pill').count() > 0);
  // ISA-101 severity axis: glyph shape keyed on data-severity, never colour alone
  ok('severity glyph data-severity', await page.locator('.sev[data-severity]').count() > 0);
  ok('alarm-count badge in sidebar', await page.locator('.alarm-count').count() > 0);

  // q=bad must NOT clear (P0 fix regression)
  await pub('temp_c', 30, 'bad');
  await sleep(2000);
  const stillActive = (await getAlarms('active')).some(a => a.tag.includes('temp_c'));
  ok('q=bad does not clear alarm', stillActive);

  // ACK via UI
  const ackBtn = page.locator('.alarm-row .btn-ack').first();
  ok('ack button visible (operator)', await ackBtn.count() > 0);
  if (await ackBtn.count() > 0) { await ackBtn.click(); await sleep(1500); }
  ok('acked label renders', (await page.locator('.alarm-acked-label').count()) > 0 || (await getAlarms('acked')).length > 0);

  // back to good below threshold -> cleared
  await pub('temp_c', 30, 'good');
  await sleep(2500);
  ok('cleared label renders', await page.locator('.alarm-cleared-label').count() > 0);

  // ============ FACEPLATE from a non-equipment context (v3) ============
  // The faceplate is tag-keyed and global (?fp=<tag>): an alarm-row tag-link
  // opens it from /alarms, and the close button removes the param again.
  await page.locator('.alarm-row button.tag-link').first().click();
  await sleep(800);
  ok('faceplate opens from tag-link (non-equipment ctx)',
    await page.locator('.faceplate').count() > 0
    && new URL(page.url()).searchParams.has('fp'), page.url());
  await page.locator('.faceplate .icon-btn').first().click();
  await sleep(500);
  ok('faceplate close clears ?fp',
    await page.locator('.faceplate').count() === 0
    && !new URL(page.url()).searchParams.has('fp'), page.url());

  // ============ INSIGHT end-to-end: real MQTT anomaly -> engine -> UI ============
  // Drive temp_c far out of band (sim ambient ~28C) while the edge is stopped —
  // an in-band sim sample would collapse the OPEN_N streak. Publish through the
  // whole poll window: detectors only OPEN on fresh tags (ALARM_FRESH_S=15s)
  // and the engine evaluates every INSIGHT_PERIOD_S=15s, so a fixed sleep is
  // not enough. Poll the API until the open row appears (<=60s).
  let openInsight = null;
  const injDeadline = Date.now() + 60000;
  while (Date.now() < injDeadline && !openInsight) {
    await pub('temp_c', 120, 'good');
    await sleep(1200);
    try {
      const r = await page.request.get(`${API}/api/insights?state=open`,
        { headers: { Authorization: 'Bearer demo-operator' } });
      const rows = r.ok() ? await r.json() : [];
      openInsight = rows.find((i) => (i.tag || '').includes('temp_c')) || null;
    } catch { /* engine pass not due yet — keep injecting */ }
  }
  ok('insight opens via injected MQTT anomaly', !!openInsight,
    openInsight ? `${openInsight.kind} score=${Number(openInsight.score).toFixed(1)}` : 'no open row within 60s');

  // The open insight must surface in the UI — rail chip on Overview (WS-pushed
  // at open, or seeded by the boot fetch). Fall back to the /insights feed row.
  await page.click('a.tab[href="/"]');
  await page.waitForSelector('.insight-chip', { timeout: 10000 }).catch(() => {});
  // ISA-101 quality axis: with the edge stopped, untouched tags go stale >15s —
  // their tiles must flag it (.qmark[data-q], shape + text, not colour alone).
  ok('quality glyph renders data-q', await page.locator('.qmark[data-q]').count() > 0);
  let insightUi = await page.locator('.insight-rail .insight-chip').count();
  if (insightUi === 0) {
    await page.goto(`${BASE}/insights`);
    await page.waitForSelector('.insight-row', { timeout: 8000 }).catch(() => {});
    insightUi = await page.locator('.insight-row').count();
  }
  ok('insight surfaces in UI (chip or row)', insightUi > 0, `${insightUi}`);

  // Cool down: publish in-band samples near the engine's own baseline mean so
  // the episode can close (CLOSE_N in-band streak) and the hi alarm our
  // injection raised can clear — don't leave the plant screaming.
  const coolV = Math.round((openInsight?.detail?.mu ?? 28) * 10) / 10;
  for (let i = 0; i < 7; i++) { await pub('temp_c', coolV + (i % 2 ? 0.2 : -0.2), 'good'); await sleep(700); }

  // ============ TRENDS: history seed + NEW time-window seg ============
  const histReqs = [];
  page.on('response', r => { if (r.url().includes('/api/tags/') && r.url().includes('/history')) histReqs.push(r.status()); });
  await page.click('a.tab[href="/trends"]');
  await sleep(2500);
  ok('history requests all 200', histReqs.length > 0 && histReqs.every(s => s === 200), `${histReqs.length} reqs`);
  ok('uplot renders', await page.locator('.uplot canvas, canvas').count() > 0);
  const segBtns = await page.locator('.seg button').allTextContents();
  ok('time-window seg present', segBtns.some(t => /1H|15M/i.test(t)), segBtns.join(','));
  const swatches = await page.locator('.swatch, [class*=swatch], [class*=chip]').count();
  ok('series swatches', swatches > 0, `${swatches}`);

  // ============ CONTROLS: guarded write + lifecycle stepper ============
  await page.click('a.tab[href="/commands"]');
  await sleep(1500);
  ok('command panel renders', await page.locator('.cmd-panel').count() > 0);
  ok('command rows render', await page.locator('.cmd-row').count() > 0);

  // ============ INSIGHTS feed (v3: Intelligence nav group) ============
  ok('insights nav tab', await page.locator('a.tab[href="/insights"]').count() === 1);
  await page.click('a.tab[href="/insights"]');
  await sleep(1500);
  ok('insights feed panel', await page.locator('.panel.insight-list').count() > 0);

  // ============ /line3d (v4: supplementary three.js twin) ============
  // Scene renders under headless SwiftShader OR falls back to the compact 2D
  // mimic — either is a pass; the zero-console-errors gate below is binding.
  ok('line3d nav tab', await page.locator('a.tab[href="/line3d"]').count() === 1);
  await page.click('a.tab[href="/line3d"]');
  await sleep(1500);
  const sceneCanvas = await page.locator('.line3d .line3d-canvas').count();
  const fallbackSchematic = await page.locator('.line3d .schematic').count();
  ok('/line3d renders scene or 2D fallback', sceneCanvas > 0 || fallbackSchematic > 0,
    sceneCanvas > 0 ? 'webgl scene' : '2d fallback');
  // equipment click → ?eq=<id> → global faceplate (HTML readouts double as
  // deterministic click targets alongside canvas raycasting)
  if (sceneCanvas > 0) await page.locator('.line3d [data-equipment="motor"]').first().click();
  else await page.locator('.line3d g.equip[data-equipment="motor"]').click();
  await sleep(800);
  ok('/line3d equipment click opens faceplate',
    await page.locator('.faceplate').count() > 0
    && new URL(page.url()).searchParams.get('eq') === 'motor', page.url());
  await page.locator('.faceplate .icon-btn').first().click().catch(() => {});
  await sleep(400);
  const [sw3, iw3] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok('/line3d: no horizontal overflow', sw3 <= iw3 + 20, `scrollWidth=${sw3} innerWidth=${iw3}`);

  // edge was stopped for the alarm section; controls are (correctly) gated
  // while the edge is down — restart it and wait for the gate to open
  execSync('docker compose -f /home/supawich/Desktop/webservice/docker-compose.yml start edge-bridge');
  await sleep(8000);
  await page.click('a.tab[href="/line"]');
  await page.locator('g.equip[data-equipment="motor"]').click();
  await sleep(1000);
  ok('controls panel in inspector', await page.locator('.controls').count() > 0);
  // guarded write: setpoint -> Apply -> type SET -> confirm -> lc dots
  await page.fill('.setpoint-input', '47');
  await page.click('button:has-text("Apply setpoint")');
  await sleep(600);
  await page.fill('.confirm-input', 'SET');
  await page.click('button:has-text("Send command")');
  await sleep(1200);
  ok('lc dots stepper exists', await page.locator('.lc-dot').count() > 0);

  // ============ RESPONSIVE GATES ============
  await page.setViewportSize({ width: 700, height: 900 });
  await sleep(800);
  ok('<768px: controls hidden', await page.locator('.btn-control').count() === 0);
  // xs layout: sidebar collapses to the 5-item mobile bottom bar; the overview
  // (tiles + insight rail) must not force horizontal scroll.
  ok('<768px: mobile nav has 5 items', await page.locator('.side-nav a.tab').count() === 5);
  await page.goto(BASE);
  await sleep(1200);
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok('<768px: no horizontal overflow', sw <= iw + 20, `scrollWidth=${sw} innerWidth=${iw}`);
  await page.setViewportSize({ width: 400, height: 800 });
  await sleep(800);
  ok('<480px: tiny placeholder', (await page.locator('body').innerText()).toLowerCase().includes('too small') || (await page.locator('.tile').count()) === 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(500);

  // ============ ADMIN (v4 T10) ============
  // The Admin nav group is visible to operators+ (spec); mutations stay
  // admin|owner server-side. API-level roundtrips + a nav-visibility check.
  // The bearer token lives in memory only (ADR-12): the goto above destroyed
  // the operator session — sign back in before asserting on nav.
  await page.waitForSelector('.token-input', { timeout: 20000 }).catch(() => {});
  if (await page.locator('.token-input').count() === 1) {
    await page.fill('.token-input', 'demo-operator');
    await page.keyboard.press('Enter');
    await sleep(2000);
  }
  let adminNavOp = false;
  try {
    await page.waitForSelector('a.tab[href="/admin"]', { timeout: 10000 });
    adminNavOp = await page.locator('a.tab[href="/admin"]').count() === 1;
  } catch { /* stays false */ }
  ok('admin: nav group visible to operator', adminNavOp);
  {
    const H = (tok) => ({ Authorization: `Bearer ${tok}` });
    const memOp = await fetch(`${API}/api/v1/orgs/${ORG}/members`, { headers: H('demo-operator') });
    ok('admin: members 403 for operator', memOp.status === 403, `${memOp.status}`);
    const memV = await fetch(`${API}/api/v1/orgs/${ORG}/members`, { headers: H('demo-viewer') });
    ok('admin: members 403 for viewer', memV.status === 403, `${memV.status}`);
    const memA = await fetch(`${API}/api/v1/orgs/${ORG}/members`, { headers: H('demo-admin') });
    const memBody = memA.ok ? await memA.json() : { items: [] };
    ok('admin: members 200 for admin', memA.status === 200 && memBody.items.length >= 3,
      `${memA.status}, ${memBody.items.length} rows`);

    // alarm-rule CRUD roundtrip — a created rule must evaluate without a
    // backend restart (alarm_rules_changed NOTIFY -> engine reload)
    const tagsR = await fetch(`${API}/api/v1/orgs/${ORG}/sites/${SITE_ID}/tags`,
      { headers: H('demo-admin') });
    const tempTag = (await tagsR.json()).items.find((x) => x.path.endsWith('temp_c'));
    const cr = await fetch(`${API}/api/v1/orgs/${ORG}/sites/${SITE_ID}/alarm-rules`, {
      method: 'POST', headers: { ...H('demo-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'uat-rule-watch', tag_id: tempTag.id,
        kind: 'hi', threshold: -9999, severity: 'info' }),
    });
    ok('admin: alarm-rule create 201', cr.status === 201, `${cr.status}`);
    const newRule = cr.ok ? (await cr.json()).rule : null;
    let tripped = false;
    for (let i = 0; i < 25 && !tripped && newRule; i++) {
      await pub('temp_c', 30, 'good');
      await sleep(1000);
      tripped = (await getAlarms('active')).some((a) => a.rule === 'uat-rule-watch');
    }
    ok('admin: new rule evaluates without restart', tripped);
    if (newRule) {
      const del = await fetch(
        `${API}/api/v1/orgs/${ORG}/sites/${SITE_ID}/alarm-rules/${newRule.id}`,
        { method: 'DELETE', headers: H('demo-admin') });
      ok('admin: alarm-rule delete 204', del.status === 204, `${del.status}`);
    }

    // invite create -> one-time token -> accept -> single-use
    const inv = await fetch(`${API}/api/v1/orgs/${ORG}/invites`, {
      method: 'POST', headers: { ...H('demo-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo-viewer@dev.local', role: 'viewer' }),
    });
    ok('admin: invite create 201', inv.status === 201, `${inv.status}`);
    const invBody = inv.ok ? await inv.json() : { token: 'x'.repeat(64) };
    const acc = await fetch(`${API}/api/v1/invites/accept`, {
      method: 'POST', headers: { ...H('demo-viewer'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invBody.token }),
    });
    ok('admin: invite accept 200', acc.status === 200, `${acc.status}`);
    const acc2 = await fetch(`${API}/api/v1/invites/accept`, {
      method: 'POST', headers: { ...H('demo-viewer'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invBody.token }),
    });
    ok('admin: invite single-use (404 replay)', acc2.status === 404, `${acc2.status}`);

    // audit export — json rows + csv header
    const aj = await fetch(`${API}/api/v1/orgs/${ORG}/audit?format=json`, { headers: H('demo-admin') });
    const aItems = aj.ok ? (await aj.json()).items : [];
    ok('admin: audit json returns rows', aj.status === 200 && aItems.length > 0,
      `${aItems.length} rows`);
    const ac = await fetch(`${API}/api/v1/orgs/${ORG}/audit?format=csv`, { headers: H('demo-admin') });
    const acsv = ac.ok ? await ac.text() : '';
    ok('admin: audit csv export', ac.status === 200 && acsv.startsWith('seq,'), `${ac.status}`);
  }

  // admin pages render — org/sites/rules are member-read so the operator
  // session exercises them without tripping the zero-4xx gate
  await page.click('a.tab[href="/admin"]');
  await sleep(1500);
  ok('admin: org page renders', await page.locator('.admin-page').count() === 1);
  await page.click('a.tab[href="/admin/rules"]');
  await sleep(1500);
  ok('admin: rules page renders', await page.locator('.admin-page').count() === 1);
  ok('admin: rules table renders', await page.locator('.admin-page .admin-table').count() > 0);

  // viewer session: the admin nav group is hidden entirely (spec: operators+)
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.token-input', { timeout: 20000 }).catch(() => {});
  await page.fill('.token-input', 'demo-viewer');
  await page.keyboard.press('Enter');
  await sleep(2000);
  ok('admin: nav group hidden for viewer',
    await page.locator('a.tab[href="/admin"]').count() === 0);

  // admin session: member + audit pages render their tables
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.token-input', { timeout: 20000 }).catch(() => {});
  await page.fill('.token-input', 'demo-admin');
  await page.keyboard.press('Enter');
  await sleep(2000);
  ok('admin: admin session signs in', await page.locator('.side-nav').count() === 1);
  await page.click('a.tab[href="/admin/users"]');
  await sleep(1500);
  ok('admin: users page renders members',
    await page.locator('.admin-page .admin-table').count() > 0);
  await page.click('a.tab[href="/admin/audit"]');
  await sleep(1500);
  ok('admin: audit page renders export form',
    await page.locator('.admin-export-form').count() === 1);

  // ============ OIDC smoke — real Keycloak round-trip (v4 T5) ============
  // Fresh context: no demo-token session, no KC SSO cookie. Wall -> SSO ->
  // Keycloak login form -> realm test user -> /auth/callback -> shell.
  // Requires `make seed-dev` (sets the demo user password).
  {
    const kcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const kcPage = await kcCtx.newPage();
    try {
      await kcPage.goto(BASE, { waitUntil: 'networkidle' });
      // wall appears after the silent-renew probe settles
      await kcPage.waitForSelector('.oidc-signin', { timeout: 20000 }).catch(() => {});
      const ssoBtn = kcPage.locator('.oidc-signin');
      ok('oidc: SSO button on wall', await ssoBtn.count() === 1);
      await ssoBtn.click();
      await kcPage.waitForSelector('input#username', { timeout: 15000 });
      ok('oidc: redirect lands on keycloak login',
        /\/realms\/wds\//.test(kcPage.url()), kcPage.url());
      await kcPage.fill('input#username', 'operator@demo');
      await kcPage.fill('input#password', process.env.KC_DEMO_PASSWORD || 'kc-demo-pass');
      await kcPage.click('#kc-login');
      await kcPage.waitForSelector('.side-nav', { timeout: 20000 });
      ok('oidc: authenticated shell after callback',
        await kcPage.locator('.user-btn').count() === 1);
      // the access token is memory-only (ADR-12): oidc.user must never land
      // in web storage; only the transient sign-in state may touch
      // sessionStorage, and the UI language pref is the one localStorage key.
      const storeDump = await kcPage.evaluate(() => ({
        ls: Object.keys(localStorage), ss: Object.keys(sessionStorage),
      }));
      ok('oidc: no access token in web storage',
        !storeDump.ls.concat(storeDump.ss).some(k => k.startsWith('oidc.user')),
        JSON.stringify(storeDump));
      await kcPage.close();
    } catch (e) {
      ok('oidc: keycloak round-trip', false,
        String(e && e.message || e).split('\n')[0].slice(0, 160));
      await kcCtx.close().catch(() => {});
    }
  }

  // ============ GLOBAL HYGIENE ============
  ok('zero console errors', consoleErrs.length === 0, consoleErrs.slice(0, 3).join(' | '));
  ok('zero 4xx/5xx responses', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));

} finally {
  execSync('docker compose -f /home/supawich/Desktop/webservice/docker-compose.yml start edge-bridge');
  await browser.close();
}

const passed = results.filter(r => r[1]).length;
console.log(`\n===== ${passed}/${results.length} PASS =====`);
process.exit(passed === results.length ? 0 : 1);
