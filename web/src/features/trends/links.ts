// Pivot links into Trends. Kept out of TrendsPage so Overview / Tags /
// Insights / Line can link without pulling the lazy Trends chunk.
//   /trends?tags=a,b&w=1h            live window
//   /trends?tags=a&from=<ms>&to=<ms>  fixed window (insight / alarm evidence)

export const WINDOWS = {
  '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3, '8h': 8 * 3600e3,
  // beyond 8 h the series comes from the rollup tables (averages), not raw samples
  '1d': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3, '1y': 365 * 24 * 3600e3,
} as const;
export type WindowKey = keyof typeof WINDOWS;

/** `/trends` URL for a tag set: a named live window, or a fixed from/to
 *  range when both epochs are given. */
export function trendHref(tags: string[], opts: { w?: WindowKey; from?: number; to?: number } = {}): string {
  const p = new URLSearchParams();
  p.set('tags', tags.join(','));
  if (opts.from != null && opts.to != null && opts.to > opts.from) {
    p.set('from', String(Math.round(opts.from)));
    p.set('to', String(Math.round(opts.to)));
  } else if (opts.w) p.set('w', opts.w);
  return `/trends?${p.toString()}`;
}

/** Evidence window around an event: 10 min of context before, 5 after
 *  (or until now when the event is still open). */
export function evidenceWindow(startIso: string, endIso?: string | null): { from: number; to: number } | null {
  const a = Date.parse(startIso);
  if (Number.isNaN(a)) return null;
  const e = endIso ? Date.parse(endIso) : NaN;
  const now = Date.now();
  const b = Number.isNaN(e) ? now : Math.min(now, e + 5 * 60e3);
  return { from: a - 10 * 60e3, to: Math.max(b, a + 60e3) };
}
