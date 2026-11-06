// One tag's history for the standard chart: the source (raw / 1m / 1h) is
// chosen from the window by pickSource, raw is fetched in chunks under the
// 5000-row cap, rollups in one call. Rows come back as Samples.

import { useQuery } from '@tanstack/react-query';
import { tagQueryApi } from '../../lib/api';
import { getScope } from '../../lib/scope';
import { pathOf } from '../trends/agg';
import { rowsToSamples, type BucketRow, type RawRow, type Sample } from './shape';
import { pickSource, type SourcePlan } from './source';

const CHUNK_MS = 80 * 60e3; // 4800 s: under the row cap at 1 Hz
const ROW_CAP = 5000;

export interface ChartHistory { samples: Sample[]; plan: SourcePlan; truncated: boolean }

export async function fetchChartHistory(tag: string, from: number, to: number, now = Date.now()): Promise<ChartHistory> {
  const sc = getScope();
  if (!sc) throw new Error('no scope');
  const plan = pickSource(from, to, now);
  const base = { tag: pathOf(tag) };
  const iso = (ms: number) => new Date(ms).toISOString();
  if (plan.source !== 'raw') {
    const r = await tagQueryApi.history(sc.orgId, sc.siteId, { ...base, from: iso(from), to: iso(to), agg: 'avg', bucket_s: plan.bucketS! });
    return { samples: rowsToSamples(r.rows as BucketRow[]), plan, truncated: false };
  }
  const spans: [number, number][] = [];
  for (let a = from; a < to; a += CHUNK_MS) spans.push([a, Math.min(to, a + CHUNK_MS)]);
  const res = await Promise.all(spans.map(([a, b]) =>
    tagQueryApi.history(sc.orgId, sc.siteId, { ...base, from: iso(a), to: iso(b), agg: 'raw', limit: ROW_CAP })));
  const seen = new Set<string>();
  const rows = res.flatMap((r) => r.rows as RawRow[]).filter((r) => !seen.has(r.ts) && !!seen.add(r.ts));
  return { samples: rowsToSamples(rows), plan, truncated: res.some((r) => r.rows.length >= ROW_CAP) };
}

export function useChartHistory(tag: string, from: number, to: number, load = fetchChartHistory) {
  const q = useQuery({
    queryKey: ['chart-history', tag, from, to],
    queryFn: () => load(tag, from, to),
    staleTime: Infinity,
  });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() };
}
