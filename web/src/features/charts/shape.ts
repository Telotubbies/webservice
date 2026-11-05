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
