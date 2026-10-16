// Event correlation: fold events that belong together into one cluster so a
// burst reads as one story, not forty rows (Datadog event correlation, ISA-18.2
// flood handling). Pure: same input and settings always give the same groups.

import type { PlantEvent } from './model';
import type { Severity } from '../../shared/ui/Status';

export type CorrBy = 'equipment' | 'signal' | 'all';
export interface CorrSettings { gapMin: number; by: CorrBy }
export const DEFAULT_CORR: CorrSettings = { gapMin: 5, by: 'equipment' };
export const GAPS = [1, 5, 15, 30] as const;

export interface Cluster {
  id: string;
  events: PlantEvent[];          // newest first
  from: number; to: number;
  worst: Severity | null;
  key: string;                   // what tied them together ('' for the whole plant)
  sources: PlantEvent['source'][];
  signals: string[];
}

const RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

const keyOf = (e: PlantEvent, by: CorrBy): string | null =>
  by === 'all' ? '' : by === 'equipment' ? (e.equipment ?? null) : (e.tag ?? null);

/** Returns display items newest first. A cluster needs two or more events;
 *  lone events (and events with no key for the chosen grouping) pass through. */
export function correlate(events: PlantEvent[], s: CorrSettings): (PlantEvent | Cluster)[] {
  const gap = s.gapMin * 60_000;
  const byKey = new Map<string, PlantEvent[]>();
  const loose: PlantEvent[] = [];
  for (const e of events) {
    const k = keyOf(e, s.by);
    if (k === null) { loose.push(e); continue; }
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
  }

  const out: (PlantEvent | Cluster)[] = [...loose];
  for (const [key, list] of byKey) {
    const asc = [...list].sort((a, b) => a.at - b.at);
    let cur: PlantEvent[] = [];
    const flush = () => {
      if (cur.length === 1) out.push(cur[0]);
      else if (cur.length > 1) out.push(toCluster(key, cur));
      cur = [];
    };
    for (const e of asc) {
      if (cur.length && e.at - cur[cur.length - 1].at > gap) flush();
      cur.push(e);
    }
    flush();
  }
  return out.sort((a, b) => time(b) - time(a));
}

export const isCluster = (x: PlantEvent | Cluster): x is Cluster => 'events' in x;
const time = (x: PlantEvent | Cluster) => (isCluster(x) ? x.to : x.at);

function toCluster(key: string, asc: PlantEvent[]): Cluster {
  const events = [...asc].reverse();
  let worst: Severity | null = null;
  for (const e of events) {
    if (e.severity && (worst === null || RANK[e.severity] > RANK[worst])) worst = e.severity;
  }
  return {
    id: `${key}:${asc[0].id}`, events, from: asc[0].at, to: asc[asc.length - 1].at, worst, key,
    sources: [...new Set(events.map((e) => e.source))],
    signals: [...new Set(events.map((e) => e.tag).filter((x): x is string => !!x))],
  };
}

const KEY = 'wds.eventCorr'; // UI pref only
export function loadCorr(): { on: boolean } & CorrSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CorrSettings> & { on?: boolean };
    return {
      on: v.on === true,
      gapMin: GAPS.includes(v.gapMin as 1) ? (v.gapMin as number) : DEFAULT_CORR.gapMin,
      by: v.by === 'signal' || v.by === 'all' ? v.by : DEFAULT_CORR.by,
    };
  } catch { return { on: false, ...DEFAULT_CORR }; }
}
export function saveCorr(v: { on: boolean } & CorrSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* prefs are best-effort */ }
}
