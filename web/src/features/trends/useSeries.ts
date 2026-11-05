// History + live merge for trend charts. The backend returns at most 5000
// rows per request (newest first, then re-sorted), so a long window is
// fetched in parallel chunks; the live ring buffer then extends the tail
// every flush so a live chart moves at the 1 Hz tag cadence.

import { useQuery } from '@tanstack/react-query';
import { api, tagQueryApi, type TagBucket } from '../../lib/api';
import { getScope } from '../../lib/scope';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { decimate, type Pt } from './viz';
import { AGG_AFTER_MS, bucketFor, pathOf } from './agg';

const CHUNK_MS = 80 * 60e3; // 4800 s — under the 5000-row cap at 1 Hz
const ROW_CAP = 5000;
export const RETENTION_MS = 8 * 3600e3;

export interface TagSeries {
  tag: string;
  pts: Pt[];
  /** samples dropped because their quality was not good (rendered as gaps) */
  bad: number;
  /** computed on the full-resolution samples, before decimation */
  stats: { last: number | null; lastT: number | null; min: number | null; max: number | null; avg: number | null };
}

function statsOf(pts: Pt[]): TagSeries['stats'] {
  if (!pts.length) return { last: null, lastT: null, min: null, max: null, avg: null };
  let min = Infinity; let max = -Infinity; let sum = 0;
  for (const p of pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; sum += p.v; }
  const l = pts[pts.length - 1];
  return { last: l.v, lastT: l.t, min, max, avg: sum / pts.length };
}

interface Fetched { series: TagSeries[]; truncated: boolean; bucketS: number | null }

export { AGG_AFTER_MS };

async function fetchAgg(tag: string, from: number, to: number): Promise<{ s: TagSeries; bucketS: number }> {
  const sc = getScope();
  if (!sc) throw new Error('no scope');
  const bucketS = bucketFor(to - from);
  const r = await tagQueryApi.history(sc.orgId, sc.siteId, {
    tag: pathOf(tag), from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    agg: 'avg', bucket_s: bucketS,
  });
  const rows = r.rows as TagBucket[];
  const pts: Pt[] = [];
  let min: number | null = null; let max: number | null = null; let sum = 0; let cnt = 0;
  for (const b of rows) {
    const t = Date.parse(b.ts);
    if (b.avg == null || Number.isNaN(t)) continue;
    pts.push({ t, v: b.avg });
    min = b.min != null && (min == null || b.min < min) ? b.min : min;
    max = b.max != null && (max == null || b.max > max) ? b.max : max;
    sum += b.avg; cnt++;
  }
  const last = pts.length ? pts[pts.length - 1] : null;
  return { s: { tag, pts, bad: 0, stats: { last: last?.v ?? null, lastT: last?.t ?? null, min, max, avg: cnt ? sum / cnt : null } }, bucketS };
}

// One tag's history, chunked to stay under the per-request row cap. Chunk
// edges can overlap a sample, so points dedupe on timestamp; non-good
// quality counts toward `bad` and drops out (renders as a gap).
async function fetchTag(tag: string, from: number, to: number): Promise<{ s: TagSeries; truncated: boolean }> {
  const spans: [number, number][] = [];
  for (let a = from; a < to; a += CHUNK_MS) spans.push([a, Math.min(to, a + CHUNK_MS)]);
  const rows = await Promise.all(spans.map(([a, b]) => api.history(tag, {
    from: new Date(a).toISOString(), to: new Date(b).toISOString(), limit: ROW_CAP,
  })));
  let bad = 0;
  const seen = new Set<number>();
  const pts: Pt[] = [];
  for (const chunk of rows) {
    for (const r of chunk) {
      const t = Date.parse(r.ts);
      if (Number.isNaN(t) || seen.has(t)) continue;
      seen.add(t);
      if (r.q && r.q !== 'good') { bad++; continue; }
      const v = typeof r.v === 'boolean' ? (r.v ? 1 : 0) : Number(r.v);
      if (Number.isFinite(v)) pts.push({ t, v });
    }
  }
  pts.sort((a, b) => a.t - b.t);
  return { s: { tag, pts, bad, stats: statsOf(pts) }, truncated: rows.some((c) => c.length >= ROW_CAP) };
}

/**
 * @param fromMs window start (epoch ms)
 * @param toMs   window end, or null for a live window ending "now"
 * @param spanMs live window length (used for the query key so it is stable)
 */
export function useSeries(tags: string[], win: { fromMs: number; toMs: number | null; spanMs: number }) {
  const isLive = win.toMs == null;
  const ver = useStore(() => live.version);
  const q = useQuery({
    queryKey: ['trend-history', tags.join(','), isLive ? `live:${win.spanMs}` : `${win.fromMs}-${win.toMs}`],
    queryFn: async (): Promise<Fetched> => {
      const to = win.toMs ?? Date.now();
      const from = win.toMs == null ? to - win.spanMs : win.fromMs;
      if (to - from > AGG_AFTER_MS) {
        const res = await Promise.all(tags.map((t) => fetchAgg(t, from, to)));
        return { series: res.map((r) => r.s), truncated: false, bucketS: res[0]?.bucketS ?? null };
      }
      const res = await Promise.all(tags.map((t) => fetchTag(t, from, to)));
      return { series: res.map((r) => r.s), truncated: res.some((r) => r.truncated), bucketS: null };
    },
    enabled: tags.length > 0,
    staleTime: isLive ? 60_000 : Infinity,
    refetchInterval: isLive ? 120_000 : false,
  });

  void ver; // re-derive the live tail on every store flush
  const now = Date.now();
  const from = isLive ? now - win.spanMs : win.fromMs;
  const to = win.toMs ?? now;

  const series: TagSeries[] = tags.map((tag, i) => {
    const hist = q.data?.series[i]?.tag === tag ? q.data.series[i] : undefined;
    let pts = hist?.pts ?? [];
    if (isLive && !q.data?.bucketS) {
      // extend with live samples newer than the last stored one
      const lastT = pts.length ? pts[pts.length - 1].t : -Infinity;
      const buf = live.buffers.get(tag) ?? [];
      const tail: Pt[] = [];
      for (let k = buf.length - 1; k >= 0 && buf[k].t > lastT; k--) tail.push(buf[k]);
      if (tail.length) pts = pts.concat(tail.reverse());
      if (pts.length && pts[0].t < from) {
        let s = 0;
        while (s < pts.length && pts[s].t < from) s++;
        pts = pts.slice(s);
      }
    }
    return { tag, pts: decimate(pts), bad: hist?.bad ?? 0, stats: statsOf(pts) };
  });

  return {
    series,
    from,
    to,
    isLive,
    isLoading: q.isLoading && tags.length > 0,
    isError: q.isError,
    truncated: q.data?.truncated ?? false,
    /** set when the series is rollup averages of this many seconds, not raw samples */
    bucketS: q.data?.bucketS ?? null,
    refetch: () => void q.refetch(),
    /** raw (undecimated) stats source */
    hasData: series.some((s) => s.pts.length > 0),
  };
}
