// Home data: every panel source resampled into fixed buckets for the window
// and the window before it (for the header's change). Tag history comes from
// the shared trend loader (history + live tail); alarms from the live store.

import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { SIGNALS, equipmentOf, shortName, unitOf } from '../../lib/plant';
import { normSeverity } from '../../shared/ui/Status';
import { useSeries } from '../trends/useSeries';
import type { Limit } from '../trends/viz';
import { bucketize, deltaPerBucket, stepsFromLimits, type Bucketed, type Pt, type Thresholds } from './chart';
import type { Panel, Section } from './model';

export interface Win { from: number; to: number; span: number; live: boolean }
export interface Filters { equip: string; sev: string }
export interface SrcData { cur: Bucketed; prev: Bucketed }

export interface SrcInfo {
  src: string;
  label: string;
  unit: string;
  dec: number;
  /** owning equipment (filters); undefined for plant-wide sources */
  equipment?: string;
  /** counts per bucket (bars, sums) rather than sampled values */
  isCount: boolean;
  /** the tag behind the source, for alarm-rule limits */
  tag?: string;
}

const kindOf = (src: string) => src.slice(0, src.indexOf(':'));
const restOf = (src: string) => src.slice(src.indexOf(':') + 1);

export function srcInfo(src: string, t: TFunction): SrcInfo {
  const kind = kindOf(src);
  const name = restOf(src);
  if (kind === 'alarms') {
    const sev = name === 'critical' ? 'sevCritical' : name === 'warning' ? 'sevWarning' : 'sevInfo';
    return { src, label: t(`home.${sev}`), unit: t('home.unitAlarms'), dec: 0, isCount: true };
  }
  const meta = SIGNALS[name];
  const unit = unitOf(name, live.tags.find((x) => x.name === name)?.unit) ?? '';
  return {
    src, tag: name, label: meta ? t(meta.labelKey) : shortName(name), unit,
    dec: meta?.decimals ?? 1, equipment: equipmentOf(name), isCount: kind === 'delta',
  };
}

/** Every source a layout reads. */
export function sourcesOf(layout: Section[]): string[] {
  const out = new Set<string>();
  for (const s of layout) for (const g of s.groups) for (const p of g.panels) for (const r of p.series) out.add(r.src);
  return [...out];
}

/** Bucketed data per source for the window; `get(src, n)` is memoized per render. */
export function useHomeData(layout: Section[], win: Win, f: Filters) {
  const srcs = sourcesOf(layout);
  const tags = [...new Set(srcs.filter((s) => kindOf(s) === 'tag' || kindOf(s) === 'delta').map(restOf))].sort();
  // twice the window, so the header can compare with the window before
  const q = useSeries(tags, { fromMs: win.from - win.span, toMs: win.live ? null : win.to, spanMs: win.span * 2 });
  const alarmRev = useStore(() => live.alarmRev);
  const byTag = useMemo(() => new Map(q.series.map((s) => [s.tag, s.pts as Pt[]])), [q.series]);

  const alarmPts = useMemo(() => {
    const m: Record<string, Pt[]> = { critical: [], warning: [], info: [] };
    for (const a of live.alarms) {
      if (f.equip !== 'all' && equipmentOf(a.tag) !== f.equip) continue;
      const t = Date.parse(a.ts);
      if (!Number.isNaN(t)) m[normSeverity(a.severity)].push({ t, v: 1 });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmRev, f.equip]);

  const cache = new Map<string, SrcData>();
  const get = (src: string, n: number): SrcData => {
    const key = `${src}|${n}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const kind = kindOf(src);
    const name = restOf(src);
    const prevFrom = win.from - win.span;
    let out: SrcData;
    if (kind === 'alarms') {
      const pts = alarmPts[name] ?? [];
      out = { cur: bucketize(pts, win.from, win.to, n, 'sum'), prev: bucketize(pts, prevFrom, win.from, n, 'sum') };
    } else {
      const pts = byTag.get(name) ?? [];
      out = kind === 'delta'
        ? { cur: deltaPerBucket(pts, win.from, win.to, n), prev: deltaPerBucket(pts, prevFrom, win.from, n) }
        : { cur: bucketize(pts, win.from, win.to, n, 'avg'), prev: bucketize(pts, prevFrom, win.from, n, 'avg') };
    }
    cache.set(key, out);
    return out;
  };

  return { get, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

/** Thresholds in force: the tag's alarm-rule limits, or the panel's own. */
export function thresholdsOf(p: Panel, limits: Map<string, Limit[]>): Thresholds | null {
  if (!p.thFromRules) return p.thresholds;
  const tag = p.series[0]?.src.replace(/^(tag|delta):/, '');
  return tag ? stepsFromLimits(limits.get(tag) ?? []) : null;
}
