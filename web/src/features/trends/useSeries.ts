// History + live merge for trend charts. The backend returns at most 5000
// rows per request (newest first, then re-sorted), so a long window is
// fetched in parallel chunks; the live ring buffer then extends the tail
// every flush so a live chart moves at the 1 Hz tag cadence.

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { decimate, type Pt } from './viz';

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

interface Fetched { series: TagSeries[]; truncated: boolean }

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
      const res = await Promise.all(tags.map((t) => fetchTag(t, from, to)));
      return { series: res.map((r) => r.s), truncated: res.some((r) => r.truncated) };
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
    if (isLive) {
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
    refetch: () => void q.refetch(),
    /** raw (undecimated) stats source */
    hasData: series.some((s) => s.pts.length > 0),
  };
}
