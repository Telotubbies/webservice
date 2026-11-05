#!/usr/bin/env node
// check-hex — fails (exit 1) when a .tsx file under web/src gains a raw hex
// colour. Colours come from tokens (web/src/theme/tokens.css, dd-theme.css)
// so light/dark parity is a token swap, never a hunt through components.
//
// Files that already carried hex when this check was introduced are listed in
// scripts/check-hex.allow.txt and skipped; shrink that list, never grow it.
// Comments are ignored, and so are in-page anchors (href="#add", to="#top").
//
// Usage:  node scripts/check-hex.mjs                 check
//         node scripts/check-hex.mjs --write-allow   (re)write the allowlist from today's state

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = join(ROOT, 'web', 'src');
const ALLOW = join(ROOT, 'scripts', 'check-hex.allow.txt');
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const ANCHOR = /(?:href|to)=\{?["'`]#[^"'`]*["'`]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Blank out comments but keep line numbers. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

function scan(file) {
  const lines = stripComments(readFileSync(file, 'utf8')).replace(ANCHOR, (m) => ' '.repeat(m.length)).split('\n');
  const hits = [];
  lines.forEach((line, i) => { for (const m of line.matchAll(HEX)) hits.push({ line: i + 1, hex: m[0] }); });
  return hits;
}

const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const files = walk(SRC);

if (process.argv.includes('--write-allow')) {
  const dirty = files.filter((f) => scan(f).length).map(rel).sort();
  writeFileSync(ALLOW, `# Legacy .tsx files that carried raw hex colours when check-hex was added.\n# Remove a line once its file is on tokens; never add one.\n${dirty.join('\n')}\n`);
  console.log(`check-hex: wrote ${dirty.length} legacy files to ${rel(ALLOW)}`);
  process.exit(0);
}

const allow = new Set(existsSync(ALLOW)
  ? readFileSync(ALLOW, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : []);
let bad = 0;
for (const f of files) {
  if (allow.has(rel(f))) continue;
  for (const h of scan(f)) { console.error(`${rel(f)}:${h.line}  raw colour ${h.hex} — use a token`); bad++; }
}
if (bad) { console.error(`check-hex: ${bad} raw hex colour(s) in .tsx`); process.exit(1); }
console.log(`check-hex: OK — ${files.length} .tsx files, ${allow.size} legacy files allowlisted`);
