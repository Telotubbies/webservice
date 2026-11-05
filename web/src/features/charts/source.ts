// Which table answers a chart window — the one place the range → source
// decision lives on the client. Raw up to 8 h, then the rollup bucket from
// trends/agg (≈600 points per window). The table is named by the bucket the
// same way the backend's rollup.pick_source names it, so the badge we show
// matches the `source` the API reports.

import { AGG_AFTER_MS, bucketFor } from '../trends/agg';

export type Source = 'raw' | '1m' | '1h';
export interface SourcePlan { source: Source; bucketS: number | null }

/** Mirrors backend rollup.RETAIN_1M_DAYS: 1m rows only exist for 90 days. */
export const RETAIN_1M_MS = 90 * 86400e3;

export function pickSource(fromMs: number, toMs: number, nowMs: number): SourcePlan {
  if (toMs - fromMs <= AGG_AFTER_MS) return { source: 'raw', bucketS: null };
  let b = bucketFor(toMs - fromMs);
  // past 1m retention the backend would scan raw for a minute bucket; ask for
  // whole hours instead so the hourly rollup answers
  if (b % 3600 !== 0 && fromMs < nowMs - RETAIN_1M_MS) b = Math.ceil(b / 3600) * 3600;
  return { source: b % 3600 === 0 ? '1h' : '1m', bucketS: b };
}
