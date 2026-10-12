// ADR-14 gate: every i18n key must exist in both en and th.
// Run: node scripts/check-i18n.mjs

import { readFileSync } from 'fs';

const src = readFileSync(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8');
const grab = (from, to) => {
  const i = src.indexOf(from);
  const j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`cannot find block ${from.trim()}`);
  return src.slice(i + from.length, j).trim().replace(/;$/, '').replace(/,$/, '');
};
const en = eval(`(${grab('const en = ', 'type Dict')})`);
const th = eval(`(${grab('const th: Dict = ', 'export const resources')})`);
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : flat(v, p + k + '.')));
const ek = new Set(flat(en));
const tk = new Set(flat(th));
let bad = 0;
for (const k of ek) if (!tk.has(k)) { bad++; console.log(`missing in th: ${k}`); }
for (const k of tk) if (!ek.has(k)) { bad++; console.log(`missing in en: ${k}`); }
console.log(bad ? `\n${bad} i18n gap(s)` : `i18n parity ok (${ek.size} keys)`);
process.exit(bad ? 1 : 0);
