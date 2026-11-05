// Time range in the URL (Grafana style), pure. `?range=4h` is a live window
// ending now; `?from=<ms>&to=<ms>` is an absolute one. Anything unreadable
// falls back to 1 h live. The old `?w=` window links still resolve.

export const RANGE_PRESETS = ['15m', '1h', '4h', '8h', '24h', '7d', '30d', '1y'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const MS: Record<RangePreset, number> = {
  '15m': 15 * 60_000, '1h': 3600_000, '4h': 4 * 3600_000, '8h': 8 * 3600_000,
  '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000, '1y': 365 * 24 * 3600_000,
};
const ALIAS: Record<string, RangePreset> = { '1d': '24h' };

export interface TimeRange { from: number; to: number; live: boolean; preset: string | null }

export const presetMs = (p: RangePreset) => MS[p];

function preset(raw: string | null): RangePreset | null {
  if (!raw) return null;
  const p = ALIAS[raw] ?? raw;
  return (RANGE_PRESETS as readonly string[]).includes(p) ? (p as RangePreset) : null;
}

export function parseRange(search: string, now: number): TimeRange {
  const q = new URLSearchParams(search);
  const from = Number(q.get('from'));
  const to = Number(q.get('to'));
  if (q.has('from') && q.has('to') && Number.isFinite(from) && Number.isFinite(to) && to > from && from >= 0) {
    return { from, to, live: false, preset: null };
  }
  const p = preset(q.get('range')) ?? preset(q.get('w')) ?? '1h';
  return { from: now - MS[p], to: now, live: true, preset: p };
}

export function formatRange(r: TimeRange): string {
  return r.live && r.preset ? `range=${r.preset}` : `from=${r.from}&to=${r.to}`;
}
