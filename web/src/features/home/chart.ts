// Chart math for the Home panels: resampling into fixed buckets, axis
// domains and ticks, SVG paths in a 1000×1000 viewBox (stretched by the
// panel), aggregations and threshold colours. Pure — no React, no store.

export type Agg = 'last' | 'avg' | 'sum' | 'max';
export type Curve = 'linear' | 'smooth' | 'step';
export type Theme = 'light' | 'dark';
export type Bucketed = (number | null)[];

export interface Pt { t: number; v: number }
export interface Step { v: number; c: string; s?: string }
export interface Thresholds { base: string; steps: Step[] }

// ── Colour ───────────────────────────────────────────────────────────────────
// Categorical slots s0–s4 were validated with the dataviz checker on
// 2026-10-20 (light on #ffffff, dark on #1b1f26): CVD and normal-vision
// separation and 3:1 contrast all pass. Re-run it when changing them.
export const SLOTS: Record<Theme, readonly string[]> = {
  light: ['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#9b4fc4'],
  dark: ['#3987e5', '#d55181', '#9085e9', '#13a0a0', '#b06fd8'],
};
// Status colours: `text` variants pass 4.5:1 as small text, `mark` variants
// pass 3:1 as shapes. Status means state only and never names a series.
const STATUS: Record<Theme, Record<string, { text: string; mark: string }>> = {
  light: {
    ok: { text: '#1a7a50', mark: '#1f8a5b' }, warn: { text: '#9a5c00', mark: '#c08400' },
    crit: { text: '#c62828', mark: '#c62828' }, info: { text: '#5b6573', mark: '#6b7685' },
  },
  dark: {
    ok: { text: '#3fbf80', mark: '#3fbf80' }, warn: { text: '#ffb020', mark: '#ffb020' },
    crit: { text: '#ff5b52', mark: '#ff5b52' }, info: { text: '#8d97a6', mark: '#8d97a6' },
  },
};
export const SERIES_TOKENS = ['s0', 's1', 's2', 's3', 's4'] as const;
export const STATUS_TOKENS = ['ok', 'warn', 'crit', 'info'] as const;
export const ALL_TOKENS = [...SERIES_TOKENS, ...STATUS_TOKENS] as const;

export const isStatus = (c: string) => c in STATUS.light;

/** A colour token (s0–s4, ok/warn/crit/info) or a literal #hex → hex. */
export function colorOf(c: string, theme: Theme, asText = false): string {
  if (c.startsWith('#')) return c;
  if (/^s[0-4]$/.test(c)) return SLOTS[theme][Number(c[1])];
  const st = STATUS[theme][c];
  return st ? (asText ? st.text : st.mark) : SLOTS[theme][0];
}

// ── Resampling ───────────────────────────────────────────────────────────────

/** Points → `n` equal buckets over [from, to). `avg` leaves silent buckets
 *  null (a gap on the chart); `sum` counts them as zero. */
export function bucketize(pts: Pt[], from: number, to: number, n: number, mode: 'avg' | 'sum'): Bucketed {
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  const w = (to - from) / n;
  for (const p of pts) {
    if (p.t < from || p.t >= to) continue;
    const i = Math.min(n - 1, Math.floor((p.t - from) / w));
    sum[i] += p.v;
    cnt[i]++;
  }
  return sum.map((s, i) => (mode === 'sum' ? s : cnt[i] ? s / cnt[i] : null));
}

/** A running counter (batches, m³ produced) → how much it rose in each
 *  bucket. A drop is a counter reset and adds nothing. */
export function deltaPerBucket(pts: Pt[], from: number, to: number, n: number): Bucketed {
  const rise: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].v - pts[i - 1].v;
    if (d > 0) rise.push({ t: pts[i].t, v: d });
  }
  return bucketize(rise, from, to, n, 'sum');
}

export function bucketTimes(from: number, to: number, n: number): number[] {
  const w = (to - from) / n;
  return Array.from({ length: n }, (_, i) => from + w * (i + 0.5));
}

// ── Axis ─────────────────────────────────────────────────────────────────────

export function niceStep(span: number, count = 4): number {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Y domain over the non-null values, padded and snapped to clean steps.
 *  Bars (`zero`) always grow from zero. Explicit limits are kept as given. */
export function domainOf(vals: (number | null)[], yMin: number | null, yMax: number | null, zero: boolean): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of vals) {
    if (x == null || !Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (zero) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) {
    const e = Math.abs(hi) * 0.1 || 1;
    hi += e;
    if (!zero) lo -= e;
  }
  const span = hi - lo;
  let a = yMin ?? (zero ? lo : lo - span * 0.1);
  let b = yMax ?? hi + span * 0.1;
  if (b <= a) b = a + 1;
  const st = niceStep(b - a);
  if (yMin == null) a = zero && lo >= 0 ? 0 : Math.floor(a / st) * st;
  if (yMax == null) b = Math.ceil(b / st) * st;
  return [a, b];
}

export function ticksOf(d: [number, number]): number[] {
  const st = niceStep(d[1] - d[0]);
  const out: number[] = [];
  for (let t = Math.ceil(d[0] / st - 1e-9) * st, k = 0; t <= d[1] + 1e-9 && k < 12; t += st, k++) out.push(+t.toFixed(10));
  return out;
}

/** Decimals a tick label needs at this domain's step. */
export function tickDecimals(d: [number, number]): number {
  const st = niceStep(d[1] - d[0]);
  return st >= 1 ? 0 : st >= 0.1 ? 1 : 2;
}

/** Top offset (%) of a value inside the plot. */
export const pctOf = (d: [number, number], v: number) => Math.max(-2, Math.min(102, ((d[1] - v) / (d[1] - d[0])) * 100));

// ── Paths ────────────────────────────────────────────────────────────────────

const r1 = (x: number) => Math.round(x * 10) / 10;

/** SVG path for bucketed values; a null starts a new segment so gaps stay gaps. */
export function linePath(vals: Bucketed, d: [number, number], curve: Curve): string {
  const n = vals.length;
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  vals.forEach((v, i) => {
    if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push([r1(n === 1 ? 500 : (i / (n - 1)) * 1000), r1(1000 - ((v - d[0]) / (d[1] - d[0])) * 1000)]);
  });
  if (cur.length) segs.push(cur);
  return segs.map((p) => {
    let s = `M${p[0][0]} ${p[0][1]}`;
    if (curve === 'step') {
      for (let i = 1; i < p.length; i++) s += `H${p[i][0]}V${p[i][1]}`;
    } else if (curve === 'smooth') {
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] ?? p[i]; const p1 = p[i]; const p2 = p[i + 1]; const p3 = p[i + 2] ?? p2;
        s += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
      }
    } else {
      for (let i = 1; i < p.length; i++) s += `L${p[i][0]} ${p[i][1]}`;
    }
    return s;
  }).join('');
}

/** Filled area under each segment of the line, down to the plot floor. */
export function areaPath(vals: Bucketed, d: [number, number], curve: Curve): string {
  const n = vals.length;
  const x = (i: number) => r1(n === 1 ? 500 : (i / (n - 1)) * 1000);
  let out = '';
  for (let i = 0; i < n; i++) {
    if (vals[i] == null) continue;
    let j = i;
    while (j + 1 < n && vals[j + 1] != null) j++;
    // only this run is non-null, so linePath draws exactly one segment
    const run = vals.map((v, k) => (k >= i && k <= j ? v : null));
    out += `${linePath(run, d, curve)}L${x(j)} 1000L${x(i)} 1000Z`;
    i = j;
  }
  return out;
}

// ── Values ───────────────────────────────────────────────────────────────────

export function aggOf(series: Bucketed[], agg: Agg): number | null {
  if (agg === 'last') {
    const lasts = series.map((s) => [...s].reverse().find((v) => v != null) ?? null).filter((v): v is number => v != null);
    return lasts.length ? lasts.reduce((a, b) => a + b, 0) / lasts.length : null;
  }
  const all = series.flat().filter((v): v is number => v != null);
  if (!all.length) return null;
  if (agg === 'sum') return all.reduce((a, b) => a + b, 0);
  if (agg === 'max') return Math.max(...all);
  return all.reduce((a, b) => a + b, 0) / all.length;
}

export const sortedSteps = (t: Thresholds) => [...t.steps].sort((a, b) => a.v - b.v);

/** Colour token of a value: the highest step it reached, else the base. */
export function thToken(t: Thresholds | null, v: number | null): string | null {
  if (!t || v == null) return null;
  let c = t.base;
  for (const s of sortedSteps(t)) if (v >= s.v) c = s.c;
  return c;
}

/** hi/hihi/lo/lolo alarm limits → ascending threshold steps:
 *  below lolo critical, below lo warning, above hi warning, above hihi critical. */
export function stepsFromLimits(limits: { v: number; kind: string }[]): Thresholds | null {
  const at = (k: string) => limits.find((l) => l.kind === k)?.v;
  const lolo = at('lolo'); const lo = at('lo'); const hi = at('hi'); const hihi = at('hihi');
  if (lolo == null && lo == null && hi == null && hihi == null) return null;
  const steps: Step[] = [];
  const base = lolo != null ? 'crit' : lo != null ? 'warn' : 'ok';
  if (lolo != null) steps.push({ v: lolo, c: lo != null ? 'warn' : 'ok' });
  if (lo != null) steps.push({ v: lo, c: 'ok' });
  if (hi != null) steps.push({ v: hi, c: 'warn' });
  if (hihi != null) steps.push({ v: hihi, c: 'crit' });
  return { base, steps };
}

/** Axis / tooltip time: seconds on short windows, weekday on a day or more. */
export function fmtTime(ms: number, span: number, full: boolean, lang: string): string {
  const d = new Date(ms);
  const loc = lang.startsWith('th') ? 'th-TH' : 'en-GB';
  const hm = d.toLocaleTimeString(loc, full && span <= 15 * 60e3
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  return full && span >= 86_400e3 ? `${d.toLocaleDateString(loc, { weekday: 'short' })} ${hm}` : hm;
}
