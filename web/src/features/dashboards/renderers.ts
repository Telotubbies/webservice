// Which viz-kit form draws each widget kind (spec §7.1: form follows the
// data's job). Retired forms stay openable — a saved dashboard never breaks —
// but render as their honest replacement: a single ratio is a Meter, not a
// gauge; shares are a sorted BarList, not a pie, donut or treemap.

import type { VizKind } from './model';

export type Renderer = 'timeseries' | 'stat' | 'meter' | 'bullet' | 'barlist' | 'state' | 'histogram' | 'table' | 'alarms' | 'heat' | 'counts' | 'custom';

const MAP: Partial<Record<VizKind, Renderer>> = {
  timeseries: 'timeseries', change: 'timeseries',
  stat: 'stat', value: 'stat',
  gauge: 'meter',
  bargauge: 'bullet',
  pie: 'barlist', treemap: 'barlist', toplist: 'barlist',
  stateline: 'state',
  histogram: 'histogram',
  table: 'table',
  alarms: 'alarms',
  alarmkpi: 'counts', incidents: 'counts', slo: 'counts', monitors: 'counts',
};

/** Kinds the widget editor no longer offers for new widgets. */
export const RETIRED_KINDS: ReadonlySet<VizKind> = new Set<VizKind>(['gauge', 'pie', 'treemap']);

/** Kinds without a generic form (notes, group headers, AI material widgets)
 *  keep their own bodies. */
export function rendererFor(kind: VizKind): Renderer {
  return MAP[kind] ?? 'custom';
}
