// Pure shaping for the standard chart: where data is missing or bad (shaded,
// never bridged), and the last/min/avg/max legend numbers. A sample is a raw
// reading or a rollup bucket; `v` null means bad quality / not numeric.

export interface Sample {
  t: number;
  v: number | null;
  /** rollup bucket band; absent for raw samples */
  mn?: number | null;
  mx?: number | null;
  /** samples in the bucket (avg weight); absent = 1 */
  n?: number;
}

export interface Gap { from: number; to: number; kind: 'bad' | 'missing' }

/** Gaps inside `range`. Silence longer than `maxGapMs` between samples (or at
 *  either end of the window) is missing, starting one `stepMs` after the last
 *  sample; a run of bad samples is bad until the next good one. Sorted. */
export function findGaps(samples: Sample[], range: [number, number], stepMs: number, maxGapMs = stepMs * 3): Gap[] {
  const [lo, hi] = range;
  if (!samples.length) return [{ from: lo, to: hi, kind: 'missing' }];
  const out: Gap[] = [];
  const push = (from: number, to: number, kind: Gap['kind']) => {
    const a = Math.max(lo, from);
    const b = Math.min(hi, to);
    if (b > a) out.push({ from: a, to: b, kind });
  };
  let badFrom: number | null = null;
  const closeBad = (to: number) => { if (badFrom != null) push(badFrom, to, 'bad'); badFrom = null; };

  if (samples[0].t - lo > maxGapMs) push(lo, samples[0].t, 'missing');
  samples.forEach((p, i) => {
    const prev = samples[i - 1];
    if (prev && p.t - prev.t > maxGapMs) {
      closeBad(prev.t + stepMs);
      push(prev.t + stepMs, p.t, 'missing');
    }
    if (p.v == null) badFrom ??= p.t;
    else closeBad(p.t);
  });
  const last = samples[samples.length - 1].t;
  closeBad(last + stepMs);
  if (hi - last > maxGapMs) push(last + stepMs, hi, 'missing');
  return out;
}

/** A null sample at the start of every missing span, so a line with
 *  spanGaps:false breaks there instead of joining across the silence. */
export function withBreaks(samples: Sample[], gaps: Gap[]): Sample[] {
  const breaks = gaps.filter((g) => g.kind === 'missing').map((g) => g.from);
  if (!breaks.length) return samples;
  const have = new Set(samples.map((p) => p.t));
  return [...samples, ...breaks.filter((t) => !have.has(t)).map((t): Sample => ({ t, v: null, mn: null, mx: null }))]
    .sort((a, b) => a.t - b.t);
}

export interface Stats { last: number | null; lastT: number | null; min: number | null; max: number | null; avg: number | null }

/** min/max read the band when there is one, so a spike averaged away inside
 *  a bucket still shows; avg weights each bucket by its sample count. */
export function statsOf(samples: Sample[]): Stats {
  let last: number | null = null; let lastT: number | null = null;
  let min = Infinity; let max = -Infinity; let sum = 0; let n = 0;
  for (const p of samples) {
    if (p.v == null) continue;
    const w = p.n ?? 1;
    last = p.v; lastT = p.t;
    min = Math.min(min, p.mn ?? p.v);
    max = Math.max(max, p.mx ?? p.v);
    sum += p.v * w; n += w;
  }
  return n ? { last, lastT, min, max, avg: sum / n } : { last: null, lastT: null, min: null, max: null, avg: null };
}

// ── API rows → samples ───────────────────────────────────────────────────────

export interface RawRow { ts: string; v: number | boolean | string | null | undefined; q?: string }
export interface BucketRow { ts: string; min: number | null; max: number | null; avg: number | null; n: number }

/** Raw rows: a non-good quality or non-numeric value is a bad sample (v null).
 *  Bucket rows keep the band; a bucket with no numeric sample is bad. */
export function rowsToSamples(rows: (RawRow | BucketRow)[]): Sample[] {
  const out: Sample[] = [];
  for (const r of rows) {
    const t = Date.parse(r.ts);
    if (Number.isNaN(t)) continue;
    if ('avg' in r) {
      out.push({ t, v: r.avg, mn: r.min, mx: r.max, n: r.n });
      continue;
    }
    // null / '' / undefined are missing, not 0 (Number(null) === 0)
    const blank = r.v == null || (typeof r.v === 'string' && r.v.trim() === '');
    const v = blank ? NaN : typeof r.v === 'boolean' ? (r.v ? 1 : 0) : Number(r.v);
    out.push({ t, v: (r.q && r.q !== 'good') || !Number.isFinite(v) ? null : v });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ── band + y domain ──────────────────────────────────────────────────────────

export interface BandPoint { t: number; mn: number; mx: number }

/** Runs of consecutive rollup buckets that carry a band. A bad bucket or
 *  silence longer than `maxGapMs` ends a run, so the band never bridges a gap. */
export function bandSegments(samples: Sample[], maxGapMs: number): BandPoint[][] {
  const runs: BandPoint[][] = [];
  let cur: BandPoint[] = [];
  let prevT: number | null = null;
  for (const p of samples) {
    if (p.v == null || p.mn == null || p.mx == null) { if (cur.length) runs.push(cur); cur = []; prevT = null; continue; }
    if (prevT != null && p.t - prevT > maxGapMs && cur.length) { runs.push(cur); cur = []; }
    cur.push({ t: p.t, mn: p.mn, mx: p.mx });
    prevT = p.t;
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** y range that holds the band (so a spike averaged away still fits), the
 *  limits and a 6 % margin. Null when there is nothing to scale to. */
export function yDomain(samples: Sample[], limitValues: number[] = []): [number, number] | null {
  let lo = Infinity; let hi = -Infinity;
  for (const p of samples) {
    if (p.v == null) continue;
    lo = Math.min(lo, p.mn ?? p.v); hi = Math.max(hi, p.mx ?? p.v);
  }
  if (!Number.isFinite(lo)) return null;
  for (const v of limitValues) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}
