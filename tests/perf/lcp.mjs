// Ops-wall LCP probe (v4 T13). Signs in through the dev-token wall
// (APP_ENV=dev test stack — same path tests/e2e/uat.mjs uses), lands on
// `/`, and reports the Largest Contentful Paint entry after settle.
// Prints LCP_MS=<n> / FCP_MS=<n> for the pytest wrapper to parse.

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright')
  .catch(() => { throw new Error('playwright not resolvable — set PLAYWRIGHT_PATH'); });

const BASE = process.env.WEB_URL || 'http://localhost:5173';
const TOKEN = process.env.OPERATOR_TOKEN || 'demo-operator';

const browser = await chromium.launch(process.env.PW_EXECUTABLE
  ? { executablePath: process.env.PW_EXECUTABLE } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // LCP observers only report entries painted AFTER observer creation —
  // attach it on the very first document before any tile paints.
  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__fcp = 0;
    try {
      new PerformanceObserver((list) => {
        const e = list.getEntries();
        if (e.length) window.__lcp = e[e.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint') window.__fcp = e.startTime;
        }
      }).observe({ type: 'paint', buffered: true });
    } catch (_) { /* observer unsupported — LCP_MS stays 0 */ }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // dev sign-in wall -> operator session -> ops wall
  await page.waitForSelector('.token-input', { timeout: 20000 });
  await page.fill('.token-input', TOKEN);
  await page.keyboard.press('Enter');
  // the wall's tiles are the expected LCP candidates — wait for them,
  // then give the observer room for any late, larger paint.
  await page.waitForSelector('.tile', { timeout: 30000 });
  await page.waitForTimeout(6000);
  const lcp = await page.evaluate(() => Math.round(window.__lcp));
  const fcp = await page.evaluate(() => Math.round(window.__fcp));
  if (!lcp) { console.error('no LCP entry captured'); process.exit(2); }
  console.log(`LCP_MS=${lcp}`);
  console.log(`FCP_MS=${fcp}`);
} finally {
  await browser.close();
}
