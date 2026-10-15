// Dashboard model: widget definitions, built-in seeds, and persistence.
// localStorage is the offline cache; custom boards sync to the org's backend
// store (see useDashboards) so they are shared across machines.

export type VizKind = 'timeseries' | 'value' | 'toplist' | 'alarms' | 'note';
export type Agg = 'last' | 'avg' | 'min' | 'max';
export type RangeKey = '15m' | '1h' | '4h' | '24h';
export const RANGE_MIN: Record<RangeKey, number> = { '15m': 15, '1h': 60, '4h': 240, '24h': 1440 };

/** Fixed categorical order (dataviz rule: assign in order, never cycle past it).
 *  ISA-101: no red / orange / amber / green — those mean abnormal or running.
 *  Mirrors SERIES_PALETTE in features/trends/viz.ts (validated order). */
export const SERIES_COLORS = ['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#1d5a9e', '#9b4fc4'];
/** Pre-ISA-101 defaults. Widgets saved with these render with the new
 *  palette (see seriesColor in widgets.tsx); stored JSON is untouched. */
export const LEGACY_SERIES_COLORS = ['#006bc2', '#c159ff', '#1c9a67', '#f99d02', '#5e6dd6', '#00a0a8'];

export interface Widget {
  id: string;
  kind: VizKind;
  title: string;
  // layout on a 12-column grid
  x: number; y: number; w: number; h: number;
  // data
  tags: string[];                 // timeseries: 1..6, value: 1
  agg: Agg;                       // value
  groupBy: 'tag' | 'rule' | 'severity'; // toplist (alarm counts)
  range: RangeKey | 'inherit';
  // display
  unit: string;                   // '' = signal's own unit
  decimals: number;
  colors: string[];               // per series
  lineWidth: number;
  yMin: number | null; yMax: number | null;
  legend: boolean;
  warn: number | null; crit: number | null; // thresholds (value tint / timeseries markers)
  note: string;                   // note widget body
}

export interface Dashboard {
  id: string; title: string; description: string;
  preset: 'builtin' | 'custom'; author: string; updatedAt: string;
  range: RangeKey; widgets: Widget[];
  shared?: boolean; // custom boards: visible to the whole org (default true)
}

export const newId = () => crypto.randomUUID(); // dashboards use it as the server row id

export function makeWidget(kind: VizKind, over: Partial<Widget> = {}): Widget {
  const size: Record<VizKind, [number, number]> = { timeseries: [6, 3], value: [3, 2], toplist: [4, 3], alarms: [6, 3], note: [3, 2] };
  return {
    // y is set by the caller (bottom of the board); not Infinity — JSON turns it into null
    id: newId(), kind, title: '', x: 0, y: 0, w: size[kind][0], h: size[kind][1],
    tags: [], agg: 'last', groupBy: 'tag', range: 'inherit',
    unit: '', decimals: 1, colors: [...SERIES_COLORS], lineWidth: 2, yMin: null, yMax: null, legend: true,
    warn: null, crit: null, note: '',
    ...over,
  };
}

const T = {
  speed: 'plant1.sort.line1.conv1.speed_mps',
  temp: 'plant1.sort.line1.conv1.temp_c',
  bin: 'plant1.sort.line1.bin1.level_pct',
  sp: 'plant1.sort.line1.motor1.speed_sp',
  gravel: 'plant1.sort.vision.cam1.gravel_ratio',
};

const SEEDS: Dashboard[] = [
  {
    id: 'line-1', title: 'Sorting line 1 — overview', description: 'Live state of the gravel sorting line.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-14T00:00:00Z', range: '1h',
    widgets: [
      makeWidget('value', { id: 'w1', title: 'Belt speed', tags: [T.speed], decimals: 2, x: 0, y: 0 }),
      makeWidget('value', { id: 'w2', title: 'Belt temperature', tags: [T.temp], warn: 70, crit: 75, x: 3, y: 0 }),
      makeWidget('value', { id: 'w3', title: 'Bin level', tags: [T.bin], decimals: 0, warn: 85, crit: 90, x: 6, y: 0 }),
      makeWidget('value', { id: 'w4', title: 'Speed setpoint', tags: [T.sp], x: 9, y: 0 }),
      makeWidget('timeseries', { id: 'w5', title: 'Belt speed (m/s)', tags: [T.speed], x: 0, y: 2 }),
      makeWidget('timeseries', { id: 'w6', title: 'Belt temperature (°C)', tags: [T.temp], warn: 70, crit: 75, x: 6, y: 2 }),
      makeWidget('timeseries', { id: 'w7', title: 'Bin fill (%)', tags: [T.bin], yMin: 0, yMax: 100, warn: 85, crit: 90, x: 0, y: 5 }),
      makeWidget('alarms', { id: 'w8', title: 'Active alarms', x: 6, y: 5 }),
    ],
  },
  {
    id: 'vision', title: 'Vision quality', description: 'Camera classification output.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-14T00:00:00Z', range: '4h',
    widgets: [
      makeWidget('value', { id: 'v1', title: 'Gravel ratio', tags: [T.gravel], decimals: 0, x: 0, y: 0 }),
      makeWidget('timeseries', { id: 'v2', title: 'Gravel ratio (%)', tags: [T.gravel], decimals: 0, x: 3, y: 0, w: 9 }),
      makeWidget('toplist', { id: 'v3', title: 'Alarms by severity', groupBy: 'severity', x: 0, y: 3, w: 4 }),
      makeWidget('note', { id: 'v4', title: 'How to read this', note: 'Gravel ratio is the share of gravel in the last camera frames. Below 40 % means the screen is clogging.', x: 4, y: 3, w: 4 }),
    ],
  },
];

const KEY = 'wds.dashboards.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadDashboards(): Dashboard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // boards saved before server sync have short ids; the backend needs UUIDs
      const saved = (JSON.parse(raw) as Dashboard[]).map((d) =>
        d.preset === 'custom' && !UUID.test(d.id) ? { ...d, id: newId() } : d);
      // keep built-ins the user never touched in sync with new seeds
      const ids = new Set(saved.map((d) => d.id));
      return [...saved, ...SEEDS.filter((s) => !ids.has(s.id))];
    }
  } catch { /* corrupt or blocked storage — fall back to seeds */ }
  return structuredClone(SEEDS);
}

export function saveDashboards(list: Dashboard[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function resetDashboard(id: string): Dashboard | undefined {
  const seed = SEEDS.find((s) => s.id === id);
  return seed && structuredClone(seed);
}
