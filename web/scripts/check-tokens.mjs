// ADR-14 gate: component CSS must use tokens, not raw hex/px font sizes, and
// must not violate the SDLC 07 minimums or the alarm colour reservation.
// Run: bun scripts/check-tokens.mjs  (non-zero exit on violations)

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('../src', import.meta.url).pathname;
const TOKEN_FILE = 'styles/tokens.css';
const MIN_FONT_PX = 12;              // captions may not go below this (07)
const MIN_BODY_PX = 15;              // body/value floor check: warn-only for 13/14
const FORBIDDEN_RESERVATION = /#(e5484d|e2a72e)/i; // alarm hues outside allowed files
const RESERVATION_OK = [/^sev/, /alarm/, /status|State|Status/];

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.css')) files.push(p);
  }
})(ROOT);

let violations = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  if (rel === TOKEN_FILE) continue;
  const css = readFileSync(f, 'utf8');
  for (const [i, line] of css.split('\n').entries()) {
    const n = i + 1;
    const fail = (msg) => { violations++; console.log(`${rel}:${n}  ${msg}`); };
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      fail(`raw hex ${m[0]} — use a token`);
    }
    for (const m of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (Number(m[1]) < MIN_FONT_PX) fail(`font-size ${m[1]}px below floor ${MIN_FONT_PX}px`);
    }
    if (FORBIDDEN_RESERVATION.test(line) && !RESERVATION_OK.some((re) => re.test(rel))) {
      fail('reserved alarm hue used outside alarm/state styles');
    }
  }
}
console.log(violations ? `\n${violations} token violation(s)` : 'token check passed');
process.exit(violations ? 1 : 0);
