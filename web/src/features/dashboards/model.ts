// Dashboard model: widget definitions, built-in seeds, and persistence.
// localStorage is the offline cache; custom boards sync to the org's backend
// store (see useDashboards) so they are shared across machines.

import { EQUIPMENT, SIGNALS, equipmentOf } from '../../lib/plant';

export type VizKind =
  | 'timeseries' | 'stat' | 'value' | 'gauge' | 'bargauge'
  | 'stateline' | 'histogram' | 'table'
  | 'toplist' | 'pie' | 'alarms' | 'note'
  | 'change' | 'slo' | 'monitors' | 'group' | 'treemap'
  | 'incidents' | 'alarmkpi'
  | 'matlive' | 'matdecision' | 'matkpi' | 'matmix' | 'matmargin' | 'matlog' | 'ailatency' | 'aithroughput';
export type Agg = 'last' | 'avg' | 'min' | 'max';
export type RangeKey = '15m' | '1h' | '4h' | '24h';
export const RANGE_MIN: Record<RangeKey, number> = { '15m': 15, '1h': 60, '4h': 240, '24h': 1440 };

/* ---- template variables (dd `$var` chips) ------------------------------
 * A board declares named variables; each is a pick-list over a real signal
 * segment. Selected values live in the URL (?var_<name>=<value>), '*' = All.
 * Alarm-family widgets (alarms/toplist/pie/treemap/monitors) filter by them
 * automatically; tag widgets opt in via `varTag`, a tag template whose
 * `$name` placeholders are substituted with the selected values. */
export type VarKind = 'equipment' | 'line';
export interface DashVar { name: string; kind: VarKind }
export const ALL_VAR = '*';

export type GroupTone = 'blue' | 'purple' | 'orange' | 'green';
export const GROUP_TONES: GroupTone[] = ['blue', 'purple', 'orange', 'green'];
/** Pastel header + ink per tone (dd themed group bars). Single source —
 *  the editor swatch and the board's group bar both read this. */
export const GROUP_TONE_STYLE: Record<GroupTone, { header: string; ink: string }> = {
  blue: { header: '#dbeafe', ink: '#1d4e9e' },
  purple: { header: '#e9e4fb', ink: '#4f3fb8' },
  orange: { header: '#fdefdc', ink: '#8a5a00' },
  green: { header: '#e3f3e7', ink: '#1c6b45' },
};

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
  groupBy: 'tag' | 'rule' | 'severity' | 'eq'; // toplist/pie/treemap (alarm counts)
  range: RangeKey | 'inherit';
  /** tag template with $var placeholders — when set and every referenced var
   *  has a concrete value, it replaces `tags` (widgets opt in to template vars) */
  varTag?: string;
  // display
  unit: string;                   // '' = signal's own unit
  decimals: number;
  colors: string[];               // per series
  lineWidth: number;
  yMin: number | null; yMax: number | null;
  legend: boolean;
  warn: number | null; crit: number | null; // thresholds (value tint / timeseries markers)
  note: string;                   // note widget body; group widget description
  /** value tiles: solid fill in the threshold colour (dd conditional formatting) */
  fill?: boolean;
  /** group headers: pastel theme tint */
  tone?: GroupTone;
  /** timeseries: append a linear-fit projection past the window end
   *  (client-side estimate, same formula as the backend `forecast` rule) */
  forecast?: boolean;
}

export interface Dashboard {
  id: string; title: string; description: string;
  preset: 'builtin' | 'custom'; author: string; updatedAt: string;
  range: RangeKey; widgets: Widget[];
  shared?: boolean; // custom boards: visible to the whole org (default true)
  vars?: DashVar[];  // template variables, stored in the opaque board body
}

export const newId = () => crypto.randomUUID(); // dashboards use it as the server row id

export function makeWidget(kind: VizKind, over: Partial<Widget> = {}): Widget {
  const size: Record<VizKind, [number, number]> = {
    timeseries: [6, 3], stat: [3, 2], value: [3, 2], gauge: [4, 3], bargauge: [6, 2],
    stateline: [6, 2], histogram: [4, 3], table: [6, 3],
    toplist: [4, 3], pie: [4, 3], alarms: [6, 3], note: [3, 2],
    change: [3, 2], slo: [4, 2], monitors: [4, 2], group: [6, 0.5], treemap: [3, 3],
    incidents: [6, 3], alarmkpi: [12, 3],
    matlive: [6, 5], matdecision: [3, 3], matkpi: [12, 2], matmix: [3, 3], matmargin: [4, 3],
    matlog: [6, 4], ailatency: [6, 3], aithroughput: [6, 3],
  };
  return {
    // y is set by the caller (bottom of the board); not Infinity — JSON turns it into null
    id: newId(), kind, title: '', x: 0, y: 0, w: size[kind][0], h: size[kind][1],
    tags: [], agg: 'last', groupBy: 'tag', range: 'inherit',
    unit: '', decimals: 1, colors: [...SERIES_COLORS], lineWidth: 2, yMin: null, yMax: null, legend: true,
    warn: null, crit: null, note: '', tone: 'blue',
    ...over,
  };
}

/** Pick-list values for a template variable, derived from the real signal
 *  set — never an invented list. */
export function varValues(kind: VarKind): string[] {
  if (kind === 'equipment') return EQUIPMENT.map((e) => e.id);
  const segs = new Set<string>();
  for (const tag of Object.keys(SIGNALS)) {
    const seg = tag.split('.')[2];
    if (seg) segs.add(seg);
  }
  return [...segs].sort();
}

/** Does an alarm's tag pass the selected variables? Unknown tags are
 *  excluded only when a filter is actually narrowing. */
export function alarmMatchesVars(tag: string, defs: DashVar[] | undefined, vals: Record<string, string>): boolean {
  for (const d of defs ?? []) {
    const v = vals[d.name];
    if (!v || v === ALL_VAR) continue;
    if (d.kind === 'equipment' && equipmentOf(tag) !== v) return false;
    if (d.kind === 'line' && tag.split('.')[2] !== v) return false;
  }
  return true;
}

/** Substitute `$name` placeholders in a tag template with the selected
 *  values. Returns null when no placeholder matched or a referenced var is
 *  still 'All' — the widget then keeps its authored tags. */
export function resolveVarTag(tpl: string, vals: Record<string, string>): string | null {
  let out = tpl;
  let hit = false;
  for (const m of tpl.matchAll(/\$(\w+)/g)) {
    const v = vals[m[1]];
    if (!v || v === ALL_VAR) return null;
    out = out.split(m[0]).join(v);
    hit = true;
  }
  return hit ? out : null;
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
    // dd "intelligent test runner" board shape: two blue group bars, solid-fill
    // KPI tiles, distribution with percentiles, treemaps and ranked tables.
    id: 'line-performance', title: 'Line performance', description: 'KPI tiles, distribution and alarm breakdown for the sorting line.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-16T00:00:00Z', range: '1h',
    widgets: [
      makeWidget('group', { id: 'g1', title: 'Line health', x: 0, y: 0, w: 6 }),
      makeWidget('group', { id: 'g2', title: 'Alarm activity', x: 6, y: 0, w: 6 }),
      makeWidget('value', { id: 'p1', title: 'Belt speed', tags: [T.speed], decimals: 2, fill: true, x: 0, y: 0.5, w: 2, h: 3 }),
      makeWidget('timeseries', { id: 'p2', title: 'Belt speed (m/s)', tags: [T.speed], x: 2, y: 0.5, w: 4, h: 3 }),
      makeWidget('histogram', { id: 'p3', title: 'Belt temperature distribution', tags: [T.temp], x: 0, y: 3.5, w: 6, h: 4 }),
      makeWidget('value', { id: 'p4', title: 'Bin level', tags: [T.bin], decimals: 0, warn: 85, crit: 90, x: 0, y: 7.5, w: 3, h: 2 }),
      makeWidget('value', { id: 'p5', title: 'Speed setpoint', tags: [T.sp], x: 3, y: 7.5, w: 3, h: 2 }),
      makeWidget('value', { id: 'p6', title: 'Belt temperature', tags: [T.temp], warn: 70, crit: 75, x: 0, y: 9.5, w: 3, h: 2 }),
      makeWidget('value', { id: 'p7', title: 'Gravel ratio', tags: [T.gravel], decimals: 0, x: 3, y: 9.5, w: 3, h: 2 }),
      makeWidget('table', { id: 'p8', title: 'Latest values', tags: [T.speed, T.temp, T.bin, T.sp, T.gravel], x: 0, y: 11.5, w: 6, h: 4 }),
      makeWidget('treemap', { id: 'a1', title: 'Alarms by rule', groupBy: 'rule', x: 6, y: 0.5, w: 3, h: 3 }),
      makeWidget('treemap', { id: 'a2', title: 'Alarms by signal', groupBy: 'tag', x: 9, y: 0.5, w: 3, h: 3 }),
      makeWidget('timeseries', { id: 'a3', title: 'Belt temperature (°C)', tags: [T.temp], warn: 70, crit: 75, x: 6, y: 3.5, w: 6, h: 4 }),
      makeWidget('toplist', { id: 'a4', title: 'Alarms by severity', groupBy: 'severity', x: 6, y: 7.5, w: 3, h: 3 }),
      makeWidget('slo', { id: 'a5', title: 'SLO summary', x: 9, y: 7.5, w: 3, h: 3 }),
      makeWidget('alarms', { id: 'a6', title: 'Active alarms', x: 6, y: 10.5, w: 6, h: 5 }),
    ],
  },
  {
    // Aggregate AI: the gravel/sand truck decision, the camera behind it and the
    // health of the models doing the work (dd "pipeline visibility" shape).
    id: 'aggregate-ai', title: 'Aggregate AI — gravel / sand',
    description: 'Live CCTV with the per-truck gravel or sand decision, and the inference health behind it.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-17T00:00:00Z', range: '1h',
    widgets: [
      makeWidget('group', { id: 'm-g1', title: 'Truck decision', tone: 'purple', note: 'One answer per truck, judged over the whole dump — never per frame.', x: 0, y: 0, w: 12, h: 0.75 }),
      makeWidget('matlive', { id: 'm1', title: 'Dump point (CCTV)', x: 0, y: 0.75, w: 6, h: 5 }),
      makeWidget('matdecision', { id: 'm2', title: 'Last truck', x: 6, y: 0.75, w: 3, h: 2.5 }),
      makeWidget('matmix', { id: 'm3', title: 'Gravel / sand trucks', x: 9, y: 0.75, w: 3, h: 2.5 }),
      makeWidget('matkpi', { id: 'm4', title: 'Summary', x: 6, y: 3.25, w: 6, h: 2.5 }),
      makeWidget('group', { id: 'm-g2', title: 'Confidence and review', tone: 'blue', note: 'Decisions below the review margin are flagged for a person; the margin and gate are set per camera.', x: 0, y: 5.75, w: 12, h: 0.75 }),
      makeWidget('matmargin', { id: 'm5', title: 'Decision margin distribution', x: 0, y: 6.5, w: 5, h: 3.5 }),
      makeWidget('matlog', { id: 'm6', title: 'Recent trucks', x: 5, y: 6.5, w: 7, h: 3.5 }),
      makeWidget('group', { id: 'm-g3', title: 'AI inference', tone: 'orange', note: 'Latency and throughput of the model server for this gateway.', x: 0, y: 10, w: 12, h: 0.75 }),
      makeWidget('ailatency', { id: 'm7', title: 'Inference latency (ms)', x: 0, y: 10.75, w: 6, h: 3.5 }),
      makeWidget('aithroughput', { id: 'm8', title: 'Inferences and detections per minute', x: 6, y: 10.75, w: 6, h: 3.5 }),
    ],
  },
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
  {
    // dd "incident management overview" shape: pastel themed group headers
    // with a one-line description, KPI tiles, top-N lists and the alarm feed.
    id: 'incident-overview', title: 'Incident management overview',
    description: 'Open incidents, response times and the alarm load behind them.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-18T00:00:00Z', range: '24h',
    vars: [
      { name: 'line', kind: 'line' },
      { name: 'equipment', kind: 'equipment' },
    ],
    widgets: [
      makeWidget('group', { id: 'ih1', title: 'Summary', tone: 'purple', note: 'Where the plant stands right now: open incidents, availability and signal health.', x: 0, y: 0, w: 12, h: 0.75 }),
      makeWidget('incidents', { id: 'i1', title: 'Incidents', x: 0, y: 0.75, w: 6, h: 3 }),
      makeWidget('slo', { id: 'i2', title: 'Availability SLO', x: 6, y: 0.75, w: 3, h: 3 }),
      makeWidget('monitors', { id: 'i3', title: 'Signal status', x: 9, y: 0.75, w: 3, h: 3 }),
      makeWidget('group', { id: 'ih2', title: 'Alarm context', tone: 'blue', note: 'Open alarms feeding the incident load — group bars filter with the variables above.', x: 0, y: 3.75, w: 12, h: 0.75 }),
      makeWidget('toplist', { id: 'i4', title: 'Alarms by equipment', groupBy: 'eq', x: 0, y: 4.5, w: 4, h: 3 }),
      makeWidget('treemap', { id: 'i5', title: 'Alarms by rule', groupBy: 'rule', x: 4, y: 4.5, w: 4, h: 3 }),
      makeWidget('alarms', { id: 'i6', title: 'Open alarms', x: 8, y: 4.5, w: 4, h: 3 }),
      makeWidget('note', { id: 'i7', title: 'About this board', note: 'Counts come from the incidents API and the live alarm set — nothing is sampled or estimated.', x: 0, y: 7.5, w: 12, h: 1 }),
    ],
  },
  {
    // ISA-18.2 alarm-system health (Tier-2 differentiator): rate, flood
    // windows, standing alarms and where the load concentrates.
    id: 'alarm-kpis', title: 'Alarm management KPIs',
    description: 'ISA-18.2 alarm load: rate per 10 minutes, flood windows and the worst offenders.',
    preset: 'builtin', author: 'vissointan', updatedAt: '2026-10-18T00:00:00Z', range: '4h',
    vars: [
      { name: 'line', kind: 'line' },
      { name: 'equipment', kind: 'equipment' },
    ],
    widgets: [
      makeWidget('group', { id: 'kh1', title: 'Alarm load', tone: 'orange', note: 'Rate per 10 minutes and flood windows over the alarms seen in this session.', x: 0, y: 0, w: 12, h: 0.75 }),
      makeWidget('alarmkpi', { id: 'k1', title: 'ISA-18.2 KPIs', x: 0, y: 0.75, w: 12, h: 3 }),
      makeWidget('group', { id: 'kh2', title: 'Offenders', tone: 'green', note: 'Where the alarm load concentrates — by rule, equipment and severity.', x: 0, y: 3.75, w: 12, h: 0.75 }),
      makeWidget('toplist', { id: 'k2', title: 'Top offending rules', groupBy: 'rule', x: 0, y: 4.5, w: 4, h: 3 }),
      makeWidget('treemap', { id: 'k3', title: 'Alarms by equipment', groupBy: 'eq', x: 4, y: 4.5, w: 4, h: 3 }),
      makeWidget('alarms', { id: 'k4', title: 'Standing alarms', x: 8, y: 4.5, w: 4, h: 3 }),
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
