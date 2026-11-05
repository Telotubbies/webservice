// Raw tag-history reads for the explorer pages (Query console, Metrics
// summary, notebooks, quality profile, uptime tile). Unlike the trend
// pipeline this keeps every sample's quality flag, because those pages
// report on quality itself.
//
// Hard bounds (PARITY §0.3): history is kept 8 h; one request returns the
// NEWEST ≤5000 rows in range. Long windows are read in 80-minute chunks
// (4800 rows at 1 Hz, under the cap); `truncated` reports when any chunk
// still hit the cap, so the UI can say so instead of silently thinning.

import { api } from '../../lib/api';
import type { Quality } from '../../types';

export const RETENTION_MS = 8 * 3600e3;
export const ROW_CAP = 5000;
const CHUNK_MS = 80 * 60e3;

export interface RawPt {
  t: number;
  /** numeric value; booleans become 0/1; null when the sample is not finite */
  v: number | null;
  q: Quality;
}

export interface RawSeries {
  tag: string;
  pts: RawPt[];
  truncated: boolean;
}

function norm(r: { v: number | boolean | null; q: string; ts: string }): RawPt | null {
  const t = Date.parse(r.ts);
  if (Number.isNaN(t)) return null;
  const v = typeof r.v === 'boolean' ? (r.v ? 1 : 0) : r.v == null ? null : Number(r.v);
  const q = (['good', 'bad', 'stale', 'uncertain'] as const).includes(r.q as Quality) ? (r.q as Quality) : 'uncertain';
  return { t, v: v != null && Number.isFinite(v) ? v : null, q };
}

/** Clamp a window to what the backend can still answer. */
export function clampWindow(fromMs: number, toMs: number, now = Date.now()): [number, number] {
  const to = Math.min(toMs, now);
  return [Math.max(fromMs, now - RETENTION_MS), Math.max(to, fromMs)];
}

/** Every stored sample of one tag in [from, to], chunked under the cap. */
export async function fetchRange(tag: string, fromMs: number, toMs: number): Promise<RawSeries> {
  const [from, to] = clampWindow(fromMs, toMs);
  const spans: [number, number][] = [];
  for (let a = from; a < to; a += CHUNK_MS) spans.push([a, Math.min(to, a + CHUNK_MS)]);
  if (!spans.length) return { tag, pts: [], truncated: false };
  const chunks = await Promise.all(spans.map(([a, b]) => api.history(tag, {
    from: new Date(a).toISOString(), to: new Date(b).toISOString(), limit: ROW_CAP,
  })));
  const seen = new Set<number>();
  const pts: RawPt[] = [];
  for (const chunk of chunks) {
    for (const r of chunk) {
      const p = norm(r as { v: number | boolean | null; q: string; ts: string });
      if (!p || seen.has(p.t)) continue;
      seen.add(p.t);
      pts.push(p);
    }
  }
  pts.sort((a, b) => a.t - b.t);
  return { tag, pts, truncated: chunks.some((c) => c.length >= ROW_CAP) };
}

/** The newest `limit` samples (one request) — cheap reads for tiles. */
export async function fetchRecent(tag: string, limit = ROW_CAP, spanMs = RETENTION_MS): Promise<RawSeries> {
  const rows = await api.history(tag, { from: new Date(Date.now() - spanMs).toISOString(), limit });
  const pts = rows.map((r) => norm(r as { v: number | boolean | null; q: string; ts: string })).filter((p): p is RawPt => !!p);
  pts.sort((a, b) => a.t - b.t);
  return { tag, pts, truncated: rows.length >= limit };
}

/* ------------------------------------------------------------------ */
/* summaries                                                           */
/* ------------------------------------------------------------------ */

export type QualityCounts = Record<Quality, number>;

export function qualityCounts(pts: RawPt[]): QualityCounts {
  const c: QualityCounts = { good: 0, bad: 0, uncertain: 0, stale: 0 };
  for (const p of pts) c[p.q]++;
  return c;
}

/** Median sample spacing — the tag's real cadence (1 s for the PLC). */
export function cadenceMs(pts: { t: number }[]): number {
  if (pts.length < 2) return 1000;
  const steps: number[] = [];
  const stride = Math.max(1, Math.floor(pts.length / 400));
  for (let i = stride; i < pts.length; i += stride) steps.push((pts[i].t - pts[i - stride].t) / stride);
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] || 1000;
}

export interface Availability {
  startMs: number;
  endMs: number;
  windowS: number;
  samples: number;
  goodFrac: number | null;
  downS: number;
  uptime: number | null;
  /** read hit the row cap — the window starts at the oldest returned row */
  capped: boolean;
  /** per-bucket up fraction (0..1), oldest first, for the step strip */
  buckets: number[];
}

/**
 * Time-weighted availability over the covered span [first sample, end].
 * A sample "holds" until the next one; held time counts as down when the
 * sample's quality is not good, and any gap longer than `gapMs` counts as
 * down beyond one cadence step (the signal went silent). The span before
 * the first stored sample is NOT counted — it is outside the evidence, and
 * the caption says how much history the figure is based on.
 */
export function availability(pts: RawPt[], endMs: number, capped: boolean, gapMs = 15_000, nBuckets = 48): Availability {
  const empty: Availability = { startMs: endMs, endMs, windowS: 0, samples: 0, goodFrac: null, downS: 0, uptime: null, capped, buckets: [] };
  if (pts.length < 2) return { ...empty, samples: pts.length };
  const start = pts[0].t;
  const span = Math.max(1, endMs - start);
  const step = cadenceMs(pts);
  const bucketMs = span / nBuckets;
  const downPerBucket = new Array<number>(nBuckets).fill(0);
  const addDown = (a: number, b: number) => {
    // spread [a,b) across buckets
    let x = a;
    while (x < b) {
      const k = Math.min(nBuckets - 1, Math.floor((x - start) / bucketMs));
      const edge = start + (k + 1) * bucketMs;
      const y = Math.min(b, edge);
      downPerBucket[k] += y - x;
      x = y <= x ? b : y;
    }
  };
  let down = 0;
  let good = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.q === 'good') good++;
    const next = i + 1 < pts.length ? pts[i + 1].t : endMs;
    const dt = Math.max(0, next - p.t);
    if (p.q !== 'good') {
      down += dt;
      addDown(p.t, p.t + dt);
    } else if (dt > gapMs) {
      down += dt - step;
      addDown(p.t + step, p.t + dt);
    }
  }
  const buckets = downPerBucket.map((d) => Math.max(0, Math.min(1, 1 - d / bucketMs)));
  return {
    startMs: start,
    endMs,
    windowS: span / 1000,
    samples: pts.length,
    goodFrac: good / pts.length,
    downS: down / 1000,
    uptime: Math.max(0, Math.min(1, 1 - down / span)),
    capped,
    buckets,
  };
}

/** Human span for captions: "83 min", "2 h 10 min". */
export function fmtSpan(ms: number, lang: string): string {
  const th = lang.startsWith('th');
  const m = Math.round(ms / 60e3);
  if (m < 1) return th ? `${Math.max(1, Math.round(ms / 1000))} วินาที` : `${Math.max(1, Math.round(ms / 1000))} s`;
  if (m < 60) return th ? `${m} นาที` : `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (th) return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
