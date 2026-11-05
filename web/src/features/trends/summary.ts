// Chart text alternative — what a chart owes a reader who can't see it
// (screen readers, the table caption): where the value is now, the range it
// covered, and which way it went. Pure, so bun tests cover it without a DOM.

import type { Pt } from './viz';

export type Trend = 'up' | 'down' | 'flat';

export interface Summary { n: number; first: number; last: number; min: number; max: number; trend: Trend }

/** `flatFrac`: a first→last move smaller than this share of the range reads
 *  as steady, so sensor noise never gets announced as "rising". */
export function summarize(pts: readonly Pt[], flatFrac = 0.1): Summary | null {
  let n = 0, first = NaN, last = NaN, min = Infinity, max = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.v)) continue;
    if (n === 0) first = p.v;
    last = p.v;
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
    n++;
  }
  if (n === 0) return null;
  const d = last - first;
  const span = max - min;
  const trend: Trend = span === 0 || Math.abs(d) <= span * flatFrac ? 'flat' : d > 0 ? 'up' : 'down';
  return { n, first, last, min, max, trend };
}

/** Evenly spaced row indices for a table view of `len` samples: at most
 *  `max` rows, always ending on the newest sample. */
export function tableRows(len: number, max = 60): number[] {
  if (len <= 0) return [];
  if (len <= max) return Array.from({ length: len }, (_, i) => i);
  const step = (len - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}
