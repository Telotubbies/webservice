// Series helpers, pure. withGaps turns silence into a visible break (an
// outage must never draw as a flat healthy line); breachOnsets marks where a
// value first enters an alarm region; legendToggle implements Grafana's
// click = isolate / ⌘-click = toggle.

import { medianCadence, type Pt } from './stat';

export function withGaps(pts: Pt[], factor = 3): { t: number; v: number | null }[] {
  const gap = medianCadence(pts) * factor;
  const out: { t: number; v: number | null }[] = [];
  pts.forEach((p, i) => {
    if (i > 0 && gap > 0 && p.t - pts[i - 1].t > gap) out.push({ t: pts[i - 1].t + gap / factor, v: null });
    out.push(p);
  });
  return out;
}

export type LimitKind = 'hi' | 'hihi' | 'lo' | 'lolo';

export function breachOnsets(pts: Pt[], limit: { v: number; kind: LimitKind }): number[] {
  const low = limit.kind === 'lo' || limit.kind === 'lolo';
  const inside = (v: number) => (low ? v <= limit.v : v >= limit.v);
  const out: number[] = [];
  let was = false;
  for (const p of pts) {
    const now = inside(p.v);
    if (now && !was) out.push(p.t);
    was = now;
  }
  return out;
}

/** isolate: show only `key`, or everything again if it was already alone.
 *  toggle: flip `key`; hiding the last visible series shows all instead. */
export function legendToggle(visible: Set<string>, key: string, mode: 'isolate' | 'toggle', all: string[]): Set<string> {
  if (mode === 'isolate') return visible.size === 1 && visible.has(key) ? new Set(all) : new Set([key]);
  const next = new Set(visible);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next.size === 0 ? new Set(all) : next;
}
