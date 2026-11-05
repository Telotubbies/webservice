// StatTile maths, pure. Delta compares the latest value with the one nearest
// to `windowMs` ago; direction is a fact, not a verdict (up is not "good").
// Sparkline paths break on silence so a dead feed never draws as flat.

export type Pt = { t: number; v: number };

export function statDelta(pts: Pt[], now: number, windowMs: number): { delta: number; pct: number | null; dir: 'up' | 'down' | 'flat' } | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const at = now - windowMs;
  let ref = pts[0];
  for (const p of pts) if (Math.abs(p.t - at) < Math.abs(ref.t - at)) ref = p;
  if (ref === last) return null;
  const delta = Number((last.v - ref.v).toPrecision(12));
  const pct = ref.v === 0 ? null : Number(((delta / Math.abs(ref.v)) * 100).toPrecision(12));
  const dir = (pct != null ? Math.abs(pct) < 0.5 : delta === 0) ? 'flat' : delta > 0 ? 'up' : 'down';
  return { delta, pct, dir };
}

/** Median spacing between samples — the signal's normal cadence. */
export function medianCadence(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  const d = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** SVG path `d` in a w×h box; a gap wider than 3× the cadence starts a new
 *  subpath (`M`) instead of bridging the silence. */
export function sparkPath(pts: Pt[], w: number, h: number, domain?: [number, number]): string {
  if (!pts.length) return '';
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  let lo = domain?.[0] ?? Infinity;
  let hi = domain?.[1] ?? -Infinity;
  if (!domain) for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const span = hi - lo;
  const x = (t: number) => (t1 === t0 ? w / 2 : ((t - t0) / (t1 - t0)) * w);
  const y = (v: number) => (span === 0 ? h / 2 : h - ((v - lo) / span) * h);
  const gap = medianCadence(pts) * 3;
  return pts.map((p, i) => {
    const jump = i === 0 || (gap > 0 && p.t - pts[i - 1].t > gap);
    return `${jump ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  }).join(' ');
}
