// Home layout model: sections → groups → panels, the default Home, pure
// layout edits (move / resize / duplicate / remove / add) and per-org
// persistence in localStorage. Panels name their data by source id:
//   tag:<name>        tag history + live tail (bucket average)
//   delta:<name>      increase of a counter tag per bucket (batches, m³)
//   alarms:<severity> alarms raised per bucket

import type { Agg, Curve, Theme, Thresholds } from './chart';

export type Viz = 'line' | 'area' | 'bars' | 'stat' | 'top' | 'alarms';
export type Height = 'S' | 'M' | 'L' | 'XL';

export interface SeriesRef { src: string; color: string; hidden?: boolean }

export interface Panel {
  id: string;
  viz: Viz;
  /** i18n key for built-in panels; `title` wins once the user types one */
  titleKey?: string;
  title: string;
  series: SeriesRef[];
  cols: number;
  h: Height;
  stripe: 'auto' | 'custom' | 'none';
  stripeColor: string;
  lineWidth: number;
  fill: number;
  curve: Curve;
  points: boolean;
  yMin: number | null; yMax: number | null;
  /** raw text of the axis inputs, so "1." survives while typing */
  yMinS?: string; yMaxS?: string;
  unit: string;
  dec: number | null;
  legend: 'bottom' | 'right' | 'hidden';
  header: 'none' | 'single' | 'perSeries';
  agg: Agg;
  /** thresholds follow the tag's alarm-rule limits instead of `thresholds` */
  thFromRules: boolean;
  thresholds: Thresholds | null;
  thStyle: 'off' | 'lines' | 'bands';
  statSize: number;
  statColor: 'threshold' | 'fixed' | 'none';
  statFixed: string;
  statBg: 'sparkline' | 'solid' | 'none';
  barColor: string;
}

export interface Group { id: string; titleKey?: string; linkKey?: string; href?: string; cols: number; joined: boolean; panels: Panel[] }
export interface Section { id: string; titleKey: string; linkKey: string; href: string; groups: Group[] }
export interface HomeState { layout: Section[]; theme: Theme }

export const HEIGHTS: Record<Height, number> = { S: 180, M: 280, L: 372, XL: 470 };
export const WIDTHS = [3, 4, 6, 8, 12];
export const MAX_SERIES = 5;
export const TS_VIZ: Viz[] = ['line', 'area', 'bars', 'stat'];

export function P(o: Partial<Panel> & { id: string }): Panel {
  return {
    viz: 'line', title: '', series: [], cols: 6, h: 'M', stripe: 'auto', stripeColor: 's0',
    lineWidth: 2, fill: 0, curve: 'linear', points: false, yMin: null, yMax: null, unit: '', dec: null,
    legend: 'bottom', header: 'none', agg: 'last', thFromRules: false, thresholds: null, thStyle: 'off',
    statSize: 64, statColor: 'threshold', statFixed: 's0', statBg: 'sparkline', barColor: 's0',
    ...o,
  };
}

// Batching-plant tags (lib/concrete `BATCH`), literal so this module stays
// free of the i18n runtime and testable under bun.
const B = (p: string) => `plant1.batch.${p}`;
const tagSrc = (p: string) => `tag:${B(p)}`;

export function defaultHome(): Section[] {
  return [
    { id: 'prod', titleKey: 'home.secProd', linkKey: 'home.linkProd', href: '/oee', groups: [
      { id: 'g-prod', cols: 12, joined: false, panels: [
        P({ id: 'output', titleKey: 'home.pOutput', viz: 'bars', series: [{ src: `delta:${B('plant.production.m3_total')}`, color: 's0' }],
          header: 'single', agg: 'sum', dec: 1, legend: 'hidden', stripe: 'none' }),
        P({ id: 'alarms', titleKey: 'home.pAlarms', viz: 'bars', series: [{ src: 'alarms:critical', color: 'crit' }, { src: 'alarms:warning', color: 'warn' }],
          header: 'perSeries', agg: 'sum', dec: 0, legend: 'hidden' }),
      ] },
    ] },
    { id: 'batch', titleKey: 'home.secBatch', linkKey: 'home.linkTwin', href: '/', groups: [
      { id: 'g-weigh', titleKey: 'home.grpWeighing', linkKey: 'home.linkTrends', href: '/trends', cols: 6, joined: true, panels: [
        P({ id: 'weights', titleKey: 'home.pWeights', series: [
          { src: tagSrc('agg.weigh1.weight_kg'), color: 's0' }, { src: tagSrc('cem.weigh1.weight_kg'), color: 's1' },
          { src: tagSrc('liq.weigh1.weight_kg'), color: 's3' }], header: 'perSeries', agg: 'max', h: 'L', legend: 'hidden', stripe: 'none' }),
        P({ id: 'mixer', titleKey: 'home.pMixer', series: [{ src: tagSrc('mix.mixer1.current_a'), color: 's2' }], header: 'single', agg: 'max',
          h: 'L', fill: 12, thFromRules: true, thStyle: 'lines', stripe: 'none' }),
      ] },
      // Key readings share one look: neutral value + trend, colour only when a rule threshold is crossed (ISA-101).
      { id: 'g-kpi', titleKey: 'home.grpReadings', linkKey: 'home.linkSignals', href: '/tags', cols: 6, joined: false, panels: [
        P({ id: 'rate', titleKey: 'home.pRate', viz: 'stat', series: [{ src: tagSrc('plant.production.rate_m3h'), color: 's0' }], h: 'S', stripe: 'none' }),
        P({ id: 'batches', titleKey: 'home.pBatches', viz: 'stat', series: [{ src: tagSrc('plant.auto.cycle_count'), color: 's2' }], h: 'S', stripe: 'none', dec: 0 }),
        P({ id: 'mixerA', titleKey: 'home.pMixer', viz: 'stat', series: [{ src: tagSrc('mix.mixer1.current_a'), color: 's2' }], h: 'S', stripe: 'none',
          thFromRules: true }),
        P({ id: 'trucks', titleKey: 'home.pTrucks', viz: 'stat', series: [{ src: tagSrc('mix.truck.count'), color: 's3' }], h: 'S', stripe: 'none', dec: 0 }),
      ] },
    ] },
    { id: 'mat', titleKey: 'home.secMaterials', linkKey: 'home.linkSignals', href: '/tags', groups: [
      { id: 'g-mat', cols: 12, joined: false, panels: [
        P({ id: 'silos', titleKey: 'home.pSilos', series: [1, 2, 3, 4].map((i) => ({ src: tagSrc(`cem.silo${i}.level_pct`), color: `s${i - 1}` })),
          yMin: 0, yMax: 100, dec: 0, thresholds: { base: 'warn', steps: [{ v: 10, c: 'ok' }] }, thStyle: 'bands', stripe: 'none' }),
        P({ id: 'bins', titleKey: 'home.pBins', series: [1, 2, 3, 4].map((i) => ({ src: tagSrc(`agg.bin${i}.level_pct`), color: `s${i - 1}` })),
          yMin: 0, yMax: 100, dec: 0, thresholds: { base: 'warn', steps: [{ v: 15, c: 'ok' }] }, thStyle: 'bands', stripe: 'none' }),
        P({ id: 'liquids', titleKey: 'home.pLiquids', series: [
          { src: tagSrc('liq.tank1.level_pct'), color: 's3' }, { src: tagSrc('liq.drum1.level_pct'), color: 's1' }, { src: tagSrc('liq.drum2.level_pct'), color: 's4' }],
          yMin: 0, yMax: 100, dec: 0, thresholds: { base: 'warn', steps: [{ v: 20, c: 'ok' }] }, thStyle: 'bands', stripe: 'none' }),
        P({ id: 'blower', titleKey: 'home.pBlower', series: [{ src: tagSrc('air.blower1.pressure_bar'), color: 's0' }], header: 'single', agg: 'last',
          curve: 'smooth', fill: 10, thFromRules: true, thStyle: 'lines', stripe: 'none' }),
      ] },
    ] },
    { id: 'alarms', titleKey: 'home.secAlarms', linkKey: 'home.linkAlarms', href: '/alarms', groups: [
      { id: 'g-alarms', cols: 12, joined: false, panels: [
        P({ id: 'top', titleKey: 'home.pTop', viz: 'top', cols: 5, h: 'L', stripe: 'none' }),
        P({ id: 'active', titleKey: 'home.pActive', viz: 'alarms', cols: 7, h: 'L' }),
      ] },
    ] },
  ];
}

export function findPanel(layout: Section[], id: string): Panel | null {
  for (const s of layout) for (const g of s.groups) for (const p of g.panels) if (p.id === id) return p;
  return null;
}

export const defaultPanel = (id: string) => findPanel(defaultHome(), id);

/** Rebuild every group's panel list through `fn` (immutably). */
export function editGroups(layout: Section[], fn: (g: Group, panels: Panel[]) => Panel[]): Section[] {
  return layout.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, panels: fn(g, g.panels.slice()) })) }));
}

export function updatePanel(layout: Section[], id: string, patch: Partial<Panel> | ((p: Panel) => Partial<Panel>)): Section[] {
  return editGroups(layout, (_, ps) => ps.map((p) => (p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)));
}

/** Drop `id` before `targetId`, or at the end of group `groupId` when no target. */
export function movePanel(layout: Section[], id: string, targetId: string | null, groupId: string | null): Section[] {
  const moving = findPanel(layout, id);
  if (!moving || id === targetId) return layout;
  const without = editGroups(layout, (_, ps) => ps.filter((p) => p.id !== id));
  return editGroups(without, (g, ps) => {
    if (!targetId) return g.id === groupId ? [...ps, moving] : ps;
    const i = ps.findIndex((p) => p.id === targetId);
    if (i >= 0) ps.splice(i, 0, moving);
    return ps;
  });
}

export function shiftPanel(layout: Section[], id: string, dir: -1 | 1): Section[] {
  return editGroups(layout, (_, ps) => {
    const i = ps.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ps.length) return ps;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    return ps;
  });
}

export function resizePanel(layout: Section[], id: string, dir: -1 | 1): Section[] {
  return updatePanel(layout, id, (p) => {
    const i = Math.max(0, WIDTHS.indexOf(p.cols));
    return { cols: WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, i + dir))] };
  });
}

export function duplicatePanel(layout: Section[], id: string, newId: string): Section[] {
  return editGroups(layout, (_, ps) => {
    const i = ps.findIndex((p) => p.id === id);
    if (i >= 0) ps.splice(i + 1, 0, { ...structuredClone(ps[i]), id: newId });
    return ps;
  });
}

export const removePanel = (layout: Section[], id: string) => editGroups(layout, (_, ps) => ps.filter((p) => p.id !== id));

export const addPanel = (layout: Section[], groupId: string, panel: Panel) =>
  editGroups(layout, (g, ps) => (g.id === groupId ? [...ps, panel] : ps));

/** Add or remove a source. A new one takes the first free colour slot so the
 *  others keep theirs; a big number holds exactly one source. */
export function toggleSource(p: Panel, src: string, _unitOf: (src: string) => string): Pick<Panel, 'series'> {
  const has = p.series.some((s) => s.src === src);
  if (p.viz === 'stat') return { series: has ? [] : [{ src, color: p.series[0]?.color ?? 's0' }] };
  if (has) return { series: p.series.filter((s) => s.src !== src) };
  const used = new Set(p.series.map((s) => s.color));
  const color = ['s0', 's1', 's2', 's3', 's4'].find((c) => !used.has(c)) ?? 's0';
  return { series: [...p.series, { src, color }] };
}

/** Legend click: isolate one series, or show all again when it is already the
 *  only one shown. With Ctrl/⌘ it toggles just that series. */
export function legendClick(p: Panel, src: string, toggle: boolean): Pick<Panel, 'series'> {
  if (toggle) return { series: p.series.map((s) => (s.src === src ? { ...s, hidden: !s.hidden } : s)) };
  const vis = p.series.filter((s) => !s.hidden);
  const only = vis.length === 1 && vis[0].src === src;
  return { series: p.series.map((s) => ({ ...s, hidden: only ? false : s.src !== src })) };
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const keyOf = (org: string) => `wds.home.v2:${org}`;

/** Saved Home for this org, or the default when nothing valid is stored. */
export function loadHome(store: KV, org: string): HomeState {
  try {
    const raw = store.getItem(keyOf(org));
    if (raw) {
      const o = JSON.parse(raw) as Partial<HomeState>;
      if (Array.isArray(o.layout)) return { layout: o.layout, theme: o.theme === 'dark' ? 'dark' : 'light' };
    }
  } catch { /* corrupt or blocked storage: start from the default */ }
  return { layout: defaultHome(), theme: 'light' };
}

/** false when storage is denied; the Home then lives in memory only. */
export function saveHome(store: KV, org: string, s: HomeState): boolean {
  try { store.setItem(keyOf(org), JSON.stringify(s)); return true; } catch { return false; }
}
