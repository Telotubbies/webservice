#!/usr/bin/env node
// check-i18n — fails (exit 1) when an i18n key exists in one language but
// not the other (roadmap 8.6 / spec U10: "no missing i18n keys in CI").
//
// Scans, statically (no bundler, no DOM):
//   web/src/lib/i18n.ts              — `const en = {...}` / `const th = {...}`
//   web/src/features/**/i18n.ts      — i18n.addResourceBundle('en'|'th', …, {...})
//
// Plural suffixes (_zero/_one/_two/_few/_many/_other) are normalized to the
// base key before comparing: English needs `count_one`+`count_other`, Thai
// only `count_other` — a missing _other IS still a failure either way.
//
// Usage: node scripts/check-i18n.mjs   (or: bun scripts/check-i18n.mjs)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = join(ROOT, 'web', 'src');
const PLURAL = /_(?:zero|one|two|few|many|other)$/;

// Non-fatal parse problems (unterminated comments/strings, odd tokens) —
// logged, never fatal: the parity verdict and exit code are unchanged.
let warnCount = 0;
function warn(msg) {
  warnCount += 1;
  if (warnCount > 20) {
    if (warnCount === 21) console.warn('check-i18n: warning: further warnings suppressed');
    return;
  }
  console.warn(`check-i18n: warning: ${msg}`);
}

// ---------------------------------------------------------------- files
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && !name.startsWith('.')) yield* walk(p);
    } else if (name === 'i18n.ts') {
      yield p;
    }
  }
}

// -------------------------------------------------- object-literal scan
// Skip strings/comments while hunting balanced braces.
function matchingBrace(src, open) {
  let depth = 0, i = open, quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 2;
      else if (c === quote) { quote = null; i += 1; }
      else if (quote === '`' && c === '$' && src[i + 1] === '{') {
        const e = matchingBrace(src, i + 1); // nested ${} inside template
        if (e < 0) { warn(`unbalanced \${} at offset ${i}`); return -1; }
        i = e + 1;
      } else i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) { warn(`unterminated /* comment at offset ${i}`); return -1; }
      i = end + 2; continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return -1;
}

function skipWs(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) { warn(`unterminated /* comment at offset ${i}`); return src.length; }
      i = end + 2; continue;
    }
    return i;
  }
}

function readToken(src, i) {
  i = skipWs(src, i);
  const c = src[i];
  if (c === "'" || c === '"' || c === '`') {
    const end = matchingQuote(src, i, c);
    return { value: src.slice(i + 1, end), end: end + 1, string: true };
  }
  const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
  if (m) return { value: m[0], end: i + m[0].length, string: false };
  return null;
}

function matchingQuote(src, i, q) {
  const start = i;
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i;
    if (q === '`' && c === '$' && src[i + 1] === '{') {
      const e = matchingBrace(src, i + 1);
      if (e < 0) { warn(`unbalanced \${} at offset ${i}`); return src.length; }
      i = e + 1; continue;
    }
    i += 1;
  }
  warn(`unterminated ${q} string at offset ${start}`);
  return src.length;
}

// Flatten one object literal (src[open] === '{') into leaf key paths.
function flatten(src, open, prefix, out) {
  let i = open + 1;
  for (;;) {
    i = skipWs(src, i);
    if (i >= src.length || src[i] === '}') return i + 1;
    const key = readToken(src, i);
    if (!key) {                                   // not a key — warn, advance
      warn(`unparseable token at offset ${i}`);
      i += 1;
      continue;
    }
    i = skipWs(src, key.end);
    if (src[i] !== ':') {                          // shorthand/spread — skip
      i = skipValue(src, key.end);
      continue;
    }
    i = skipWs(src, i + 1);
    const path = prefix ? `${prefix}.${key.value}` : key.value;
    if (src[i] === '{') {
      i = flatten(src, i, path, out);
    } else {
      out.add(path);
      i = skipValue(src, i);
    }
    i = skipWs(src, i);
    if (src[i] === ',') i += 1;
  }
}

// Skip a non-object value (string, number, array, call…) to ',' or '}'.
function skipValue(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = matchingQuote(src, i, c) + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) { warn(`unterminated /* comment at offset ${i}`); return src.length; }
      i = end + 2; continue;
    }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') { if (depth === 0) return i; depth -= 1; i += 1; continue; }
    else if (c === ',' && depth === 0) return i;
    i += 1;
  }
  return i;
}

// ------------------------------------------------------------- bundles
function* bundles(file, src) {
  // yields { lang, keys:Set }
  if (file.endsWith(join('lib', 'i18n.ts'))) {
    for (const lang of ['en', 'th']) {
      const m = new RegExp(`const\\s+${lang}\\b[^=;]*=`).exec(src);
      if (!m) continue;
      const open = src.indexOf('{', m.index);
      if (open < 0) continue;
      const keys = new Set();
      flatten(src, open, '', keys);
      yield { lang, keys };
    }
    return;
  }
  const re = /addResourceBundle\(\s*['"`](en|th)['"`]/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index);
    if (open < 0) continue;
    const keys = new Set();
    flatten(src, open, '', keys);
    yield { lang: m[1], keys };
  }
}

const base = (k) => k.replace(PLURAL, '');

// ----------------------------------------------------------------- main
const files = [join(SRC, 'lib', 'i18n.ts'), ...walk(join(SRC, 'features'))];
const en = new Set(); const th = new Set();
const seen = new Map();      // key -> file (for error messages)
let bundlesFound = 0;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f);
  for (const b of bundles(f, src)) {
    bundlesFound += 1;
    const into = b.lang === 'en' ? en : th;
    for (const k of b.keys) {
      into.add(base(k));
      if (!seen.has(`${b.lang}:${base(k)}`)) seen.set(`${b.lang}:${base(k)}`, rel);
    }
  }
}

if (bundlesFound === 0) {
  console.error('check-i18n: found no resource bundles — is web/src moved?');
  process.exit(1);
}

const missingTh = [...en].filter((k) => !th.has(k));
const missingEn = [...th].filter((k) => !en.has(k));
for (const k of missingTh) console.error(`check-i18n: '${k}' missing in th  (en: ${seen.get(`en:${k}`)})`);
for (const k of missingEn) console.error(`check-i18n: '${k}' missing in en  (th: ${seen.get(`th:${k}`)})`);

if (missingTh.length || missingEn.length) {
  console.error(`check-i18n: ${missingTh.length + missingEn.length} asymmetric key(s) across ${bundlesFound} bundles`);
  process.exit(1);
}
console.log(`check-i18n: en/th parity OK — ${en.size} keys across ${bundlesFound} bundles`);
