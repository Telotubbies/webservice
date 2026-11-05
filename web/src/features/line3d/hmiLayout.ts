// HMI schematic layout: the mapped parts of the plant model arranged as a
// classic SCADA mimic (storage on top, process in the middle, transport at
// the bottom). Left-to-right order and spacing follow the model's front
// elevation, so the schematic reads like the plant; links are only drawn
// where the geometry supports them (a vessel above a belt, a pipe run
// touching a vessel), never invented.

import type { PlantPart } from '../../lib/plantModel';
import type { PartBox } from './scene';

export type HmiRow = 'store' | 'process' | 'move';

export interface HmiNode {
  key: string;           // part index as a string (same key the 3D scene uses)
  part: PlantPart;
  row: HmiRow;
  x: number;             // centre, viewBox units
  y: number;
  w: number;
  h: number;
}

export interface HmiLink { from: string; to: string; pts: [number, number][] }
export interface HmiPipe { key: string; part: PlantPart; y: number; x0: number; x1: number; stubs: string[] }

export interface HmiLayout { w: number; h: number; nodes: HmiNode[]; links: HmiLink[]; pipes: HmiPipe[] }

const ROW_OF: Record<string, HmiRow> = {
  vessel: 'store',
  mixer: 'process', pump: 'process', motor: 'process', valve: 'process', indicator: 'process', slider: 'process',
  conveyor: 'move',
};
// symbol size per kind (viewBox units)
const SIZE: Record<string, [number, number]> = {
  vessel: [74, 150], mixer: [110, 70], pump: [56, 56], motor: [52, 52], valve: [44, 30],
  indicator: [60, 70], slider: [60, 70], conveyor: [150, 22],
};
const MIN_GAP = 26;
const MARGIN = 120;
const ROW_Y: Record<HmiRow, number> = { store: 175, process: 500, move: 745 };
export const PIPE_BAND = [345, 410] as const;
/** y band for belt-feed jogs: under the process row's value boxes */
const JOG_Y = 640;

const cx = (b: PartBox) => (b.min[0] + b.max[0]) / 2;
const overlaps = (a: PartBox, b: PartBox, pad = 0) =>
  [0, 1, 2].every((i) => a.min[i] - pad <= b.max[i] && b.min[i] - pad <= a.max[i]);

/** Spread items along x keeping their model order and relative spacing,
 *  with at least `gap` between neighbours; falls back to an even spread
 *  when the real spacing cannot fit. */
function spread(items: { wx: number; w: number }[], width: number): number[] {
  if (items.length === 0) return [];
  const lo = Math.min(...items.map((i) => i.wx));
  const hi = Math.max(...items.map((i) => i.wx));
  const span = width - 2 * MARGIN;
  const need = items.reduce((s, i) => s + i.w, 0) + MIN_GAP * (items.length - 1);
  if (need >= span || hi === lo) {
    // even: each slot gets its share
    let x = MARGIN + Math.max(0, (span - need) / 2);
    return items.map((i) => { const c = x + i.w / 2; x += i.w + MIN_GAP; return c; });
  }
  const xs = items.map((i) => MARGIN + i.w / 2 + ((i.wx - lo) / (hi - lo)) * (span - i.w));
  for (let k = 1; k < xs.length; k++) {
    const min = xs[k - 1] + items[k - 1].w / 2 + MIN_GAP + items[k].w / 2;
    if (xs[k] < min) xs[k] = min;
  }
  // pushed past the right margin: sweep back
  const right = width - MARGIN;
  const last = xs.length - 1;
  if (xs[last] + items[last].w / 2 > right) {
    xs[last] = right - items[last].w / 2;
    for (let k = last - 1; k >= 0; k--) {
      const max = xs[k + 1] - items[k + 1].w / 2 - MIN_GAP - items[k].w / 2;
      if (xs[k] > max) xs[k] = max;
    }
  }
  return xs;
}

export function layoutHmi(parts: PlantPart[], boxes: PartBox[]): HmiLayout {
  const byKey = new Map(boxes.map((b) => [b.key, b]));
  const rows: Record<HmiRow, { key: string; part: PlantPart; box: PartBox }[]> = { store: [], process: [], move: [] };
  const pipeParts: { key: string; part: PlantPart; box: PartBox }[] = [];
  parts.forEach((part, i) => {
    const box = byKey.get(String(i));
    if (!box) return;
    if (part.kind === 'pipe') { pipeParts.push({ key: String(i), part, box }); return; }
    rows[ROW_OF[part.kind] ?? 'process'].push({ key: String(i), part, box });
  });

  // width grows with the busiest row so dense plants stay legible
  const needW = (r: HmiRow) => rows[r].reduce((s, e) => s + (SIZE[e.part.kind] ?? SIZE.indicator)[0] + MIN_GAP, 0) + 2 * MARGIN;
  const w = Math.max(1360, needW('store'), needW('process'), needW('move'));
  const h = 850;

  const nodes: HmiNode[] = [];
  (Object.keys(rows) as HmiRow[]).forEach((row) => {
    const list = rows[row].sort((a, b) => cx(a.box) - cx(b.box));
    const xs = spread(list.map((e) => ({ wx: cx(e.box), w: (SIZE[e.part.kind] ?? SIZE.indicator)[0] })), w);
    list.forEach((e, i) => {
      const [sw, sh] = SIZE[e.part.kind] ?? SIZE.indicator;
      nodes.push({ key: e.key, part: e.part, row, x: xs[i], y: ROW_Y[row], w: sw, h: sh });
    });
  });
  const node = new Map(nodes.map((n) => [n.key, n]));

  // vessel → belt drops: the belt must lie under the vessel in the model
  const links: HmiLink[] = [];
  for (const v of rows.store) {
    const vb = v.box;
    const under = rows.move
      .filter((c) => c.box.max[1] <= vb.min[1] + 0.5 * (vb.max[1] - vb.min[1])
        && c.box.min[0] <= cx(vb) && cx(vb) <= c.box.max[0]
        && c.box.min[2] - 1 <= vb.max[2] && vb.min[2] <= c.box.max[2] + 1)
      .sort((a, b) => b.box.max[1] - a.box.max[1])[0];
    if (!under) continue;
    const a = node.get(v.key)!, c = node.get(under.key)!;
    const top = a.y + a.h / 2;
    const bot = c.y - c.h / 2;
    const bx = Math.min(Math.max(a.x, c.x - c.w / 2 + 10), c.x + c.w / 2 - 10);
    const mid = JOG_Y + (links.length % 4) * 7;
    links.push({ from: v.key, to: under.key, pts: bx === a.x ? [[a.x, top], [a.x, bot]] : [[a.x, top], [a.x, mid], [bx, mid], [bx, bot]] });
  }

  // pipe runs: a header across the parts their geometry touches
  const pipes: HmiPipe[] = [];
  const band = (PIPE_BAND[1] - PIPE_BAND[0]) / Math.max(1, pipeParts.length + 1);
  pipeParts.forEach((p, i) => {
    const touched = [...rows.store, ...rows.process].filter((e) => overlaps(e.box, p.box, 0.3)).map((e) => node.get(e.key)!);
    if (touched.length === 0) return;
    const xs = touched.map((n) => n.x);
    pipes.push({ key: p.key, part: p.part, y: PIPE_BAND[0] + band * (i + 1),
      x0: Math.min(...xs), x1: Math.max(...xs), stubs: touched.map((n) => n.key) });
  });

  return { w, h, nodes, links, pipes };
}
