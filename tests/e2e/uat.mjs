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

const BASE = 'http://localhost:5173';
const API = 'http://localhost:8000';
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- MQTT helper: publish telemetry sample via paho (python) ---
function pub(tag, v, q = 'good') {
  const ts = new Date().toISOString();
  const py = `import paho.mqtt.client as m,json,time
c=m.Client(m.CallbackAPIVersion.VERSION2)
c.username_pw_set('tester','tester-demo-pass')
c.connect('localhost',1883,10)
c.loop_start()
c.publish('plant1/sort/line1/conv1/${tag}',json.dumps({'v':${JSON.stringify(v)},'q':'${q}','ts':'${ts}'}),qos=1)
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

const browser = await chromium.launch({ executablePath: '/home/supawich/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrs = [];
const badResponses = [];
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

try {
  // ============ ANONYMOUS ============
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(1500);

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

  // Controls hidden for anonymous
  const tabTexts = await page.locator('a.tab, button.tab').allTextContents();
  ok('anon: no Controls tab', !tabTexts.some(t => /control/i.test(t)));

  // ============ OPERATOR (sign-in dialog) ============
  await page.click('.signin-btn');
  await page.fill('.token-input', 'demo-operator');
  await page.keyboard.press('Enter');
  await sleep(2000);
  ok('operator: signed in (role shown)', await page.locator('.user-btn').count() === 1);

  // ============ ALARM LIFECYCLE via real MQTT injection ============
  // fire alarm
  await pub('temp_c', 95, 'good');
  await page.click('a.tab[href="/alarms"]');
  await sleep(2500);
  const activeRow = page.locator('.alarm-row.alarm-active, .alarm-row').filter({ hasText: 'temp' }).first();
  ok('alarm row appears', await activeRow.count() > 0);
  ok('sev pill on row', await page.locator('.alarm-row [class*=sev], .alarm-row .pill').count() > 0);
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
  await page.setViewportSize({ width: 400, height: 800 });
  await sleep(800);
  ok('<480px: tiny placeholder', (await page.locator('body').innerText()).toLowerCase().includes('too small') || (await page.locator('.tile').count()) === 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(500);

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
