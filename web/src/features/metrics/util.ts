// Shared helpers for the Metrics suite pages.
//
// v2 endpoints speak site-relative `path` (sort/line1/conv1/speed_mps) while
// Trends and the live store speak v1 display names (plant1.sort.line1.conv1.
// speed_mps). `/api/tags` returns display names — stripping the first dotted
// segment reproduces the v2 path, so one fetch builds path → v1-name map and
// every "open in Trends" link resolves to real history.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { trendHref } from '../trends/links';

export { trendHref };

/** Equipment group for a v2 path — same convention as the summary page:
 *  the segment above the leaf (`sort/line1/conv1/x` → `conv1`). */
export const groupOf = (path: string) =>
  path.split('/').slice(-2, -1)[0] ?? path.split('/')[0];

/** v2 path → v1 display name, or the path itself when the shim can't know it. */
export function useTrendNames(): Map<string, string> {
  const q = useQuery({ queryKey: ['tags'], queryFn: api.tags, staleTime: 60_000 });
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const t of q.data ?? []) {
      const dot = t.name.indexOf('.');
      if (dot > 0) m.set(t.name.slice(dot + 1).replace(/\./g, '/'), t.name);
    }
    return m;
  }, [q.data]);
}

/** Trend link for a v2 path — resolves to the v1 display name when known. */
export function trendLink(path: string, names: Map<string, string>): string {
  return trendHref([names.get(path) ?? path.replace(/\//g, '.')]);
}
