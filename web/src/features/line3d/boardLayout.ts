// 2D SCADA board: pure layout + edit operations (no React, no DOM).
//
// The board is built from side captures of each mapped 3D part. This module
// decides WHERE each part sits: layoutBoard() packs parts into process-area
// lanes (ordered like the plant, left to right), never touching a pinned
// (locked) part. Pipes are not pictures: they become lines, and every link is
// re-routed from the current rectangles, so moving a part re-routes its lines.

import type { PlantPart } from '../../lib/plantModel';
import type { PartBox } from './scene';

export interface Rect { x: number; y: number; w: number; h: number }
export interface BoardItem extends Rect { locked?: boolean; hidden?: boolean }
export interface Lane { id: string; y: number; h: number }
export type Pair = [string, string];

export interface BoardLayout {
  v: 1;
  w: number;
  h: number;
  items: Record<string, BoardItem>;
  lanes: Lane[];
  /** operator edits on top of the geometry-derived links */
  links: { add: Pair[]; remove: Pair[] };
}

export interface BoardLink { id: string; from: string; to: string; kind: 'drop' | 'manual' }
export interface BoardPipe { key: string; medium: string; stubs: string[] }
export interface BoardLine { id: string; key: string; kind: 'drop' | 'manual' | 'pipe'; medium?: string; pts: [number, number][] }

export const GRID = 10;
export const BOARD_W = 1400;
const PAD = 24;
const GAP = 28;
const LANE_HEAD = 26;
const PX_PER_UNIT = 40;
const MAX_SIDE = 190;
const MIN_SIDE = 30;

/** Stable key of a part on the board: its first glTF node (stable per file). */
export const partKey = (p: PlantPart): string => String(p.nodes[0] ?? p.label);

const isPipe = (p: PlantPart) => p.kind === 'pipe';
const cx = (b: PartBox) => (b.min[0] + b.max[0]) / 2;
const snap = (v: number, g = GRID) => Math.round(v / g) * g;
export const snapTo = snap;

// ── process areas ────────────────────────────────────────────────────────────

const AREA_BY_SEGMENT: Record<string, string> = {
  cem: 'cement', agg: 'aggregates', liq: 'liquids', air: 'air', mix: 'mixing',
};
const AREA_BY_LABEL: [RegExp, string][] = [
  [/silo|cement/i, 'cement'],
  [/aggregate|bin\b|belt|conveyor|hoist|skip/i, 'aggregates'],
  [/liquid|tank|admix|drum|water/i, 'liquids'],
  [/blower|filter|air|dust|pipe/i, 'air'],
  [/mixer|hopper|weigh/i, 'mixing'],
];

/** Process area of each part: from its tag path (batch/cem/...), else its name. */
export function deriveGroups(parts: PlantPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    let area: string | undefined;
    for (const path of Object.values(p.bindings)) {
      area = AREA_BY_SEGMENT[path.split('/')[1] ?? ''];
      if (area) break;
    }
    area ??= AREA_BY_LABEL.find(([re]) => re.test(p.label))?.[1];
    out[partKey(p)] = area ?? 'other';
  }
  return out;
}

// ── sizing ───────────────────────────────────────────────────────────────────

/** Board size of a part from its world box (wider horizontal face, like the capture). */
export function sizeOf(b: PartBox): { w: number; h: number } {
  const ww = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) * PX_PER_UNIT;
  const hh = (b.max[1] - b.min[1]) * PX_PER_UNIT;
  const k = Math.min(1, MAX_SIDE / Math.max(ww, hh, 1));
  let w = ww * k, h = hh * k;
  const up = Math.max(1, MIN_SIDE / Math.max(Math.min(w, h), 1));
  w = Math.min(MAX_SIDE, w * up); h = Math.min(MAX_SIDE, h * up);
  return { w: Math.max(MIN_SIDE, snap(w, 2)), h: Math.max(MIN_SIDE, snap(h, 2)) };
}

// ── layoutBoard ──────────────────────────────────────────────────────────────

const hit = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** A part occupies more than its picture: a caption and a value box sit under it. */
const VALUE_W = 108;
const CAPTION_H = 50;
const cellOf = (r: Rect): Rect => ({ x: r.x - Math.max(0, (VALUE_W - r.w) / 2), y: r.y, w: Math.max(r.w, VALUE_W), h: r.h + CAPTION_H });

export interface LaidOut { w: number; h: number; items: Record<string, Rect>; lanes: Lane[] }

/**
 * Pack the parts into one lane per process area (ordered by where the area
 * sits in the plant). Parts of a lane run left to right in model order and
 * wrap at the board width. `pinned` rectangles are obstacles AND are returned
 * unchanged: a pinned part never moves, and nothing is placed on top of it.
 * Pipes are skipped (they are drawn as lines).
 */
export function layoutBoard(
  parts: PlantPart[], boxes: PartBox[], groups: Record<string, string>, pinned: Record<string, Rect> = {},
): LaidOut {
  const box = new Map(boxes.map((b) => [b.key, b]));
  const items: Record<string, Rect> = {};
  const obstacles: Rect[] = [];
  for (const [k, r] of Object.entries(pinned)) { items[k] = { ...r }; obstacles.push(cellOf(r)); }

  const byArea = new Map<string, { key: string; b: PartBox }[]>();
  for (const p of parts) {
    const k = partKey(p), b = box.get(k);
    if (isPipe(p) || !b || k in pinned) continue;
    const a = groups[k] ?? 'other';
    byArea.set(a, [...(byArea.get(a) ?? []), { key: k, b }]);
  }
  const areas = [...byArea.entries()]
    .map(([id, list]) => ({ id, list: list.sort((p, q) => cx(p.b) - cx(q.b) || q.b.max[1] - p.b.max[1]) }))
    .sort((p, q) => mean(p.list.map((e) => cx(e.b))) - mean(q.list.map((e) => cx(e.b))) || p.id.localeCompare(q.id));

  const lanes: Lane[] = [];
  let top = PAD;
  for (const area of areas) {
    const laneTop = top;
    let x = PAD, y = laneTop + LANE_HEAD, rowH = 0, bottom = y;
    for (const e of area.list) {
      const { w, h } = sizeOf(e.b);
      const cw = Math.max(w, VALUE_W), ch = h + CAPTION_H;
      for (let guard = 0; guard < 2000; guard++) {
        const blocker = obstacles.find((o) => hit({ x, y, w: cw, h: ch }, o, GAP / 2));
        if (blocker) { x = blocker.x + blocker.w + GAP / 2; continue; }
        if (x + cw > BOARD_W - PAD && x > PAD) { x = PAD; y += (rowH || 20) + GAP; rowH = 0; continue; }
        break;
      }
      const r = { x: snap(x + (cw - w) / 2), y: snap(y), w, h };
      items[e.key] = r; obstacles.push(cellOf(r));
      x += cw + GAP; rowH = Math.max(rowH, ch); bottom = Math.max(bottom, r.y + ch);
    }
    lanes.push({ id: area.id, y: laneTop, h: bottom - laneTop });
    top = bottom + GAP;
  }
  const all = Object.values(items);
  return {
    w: Math.max(BOARD_W, ...all.map((r) => r.x + r.w + PAD)),
    h: Math.max(top, ...all.map((r) => r.y + r.h + CAPTION_H + PAD)),
    items, lanes,
  };
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

// ── links ────────────────────────────────────────────────────────────────────

const overlaps = (a: PartBox, b: PartBox, pad = 0) =>
  [0, 1, 2].every((i) => a.min[i] - pad <= b.max[i] && b.min[i] - pad <= a.max[i]);

export const linkId = (a: string, b: string) => `${a}>${b}`;

/** Links the geometry supports (never invented): a vessel above a belt drops onto it; a pipe run joins what it touches. */
export function deriveLinks(parts: PlantPart[], boxes: PartBox[]): { links: BoardLink[]; pipes: BoardPipe[] } {
  const box = new Map(boxes.map((b) => [b.key, b]));
  const solid = parts.filter((p) => !isPipe(p) && box.has(partKey(p)));
  const links: BoardLink[] = [];
  for (const v of solid.filter((p) => p.kind === 'vessel')) {
    const vb = box.get(partKey(v))!;
    const under = solid
      .filter((p) => p.kind === 'conveyor')
      .map((p) => ({ k: partKey(p), b: box.get(partKey(p))! }))
      .filter(({ b }) => b.max[1] <= vb.min[1] + 0.5 * (vb.max[1] - vb.min[1])
        && b.min[0] <= cx(vb) && cx(vb) <= b.max[0]
        && b.min[2] - 1 <= vb.max[2] && vb.min[2] <= b.max[2] + 1)
      .sort((a, b) => b.b.max[1] - a.b.max[1])[0];
    if (under) links.push({ id: linkId(partKey(v), under.k), from: partKey(v), to: under.k, kind: 'drop' });
  }
  const pipes: BoardPipe[] = [];
  for (const p of parts.filter(isPipe)) {
    const pb = box.get(partKey(p));
    if (!pb) continue;
    const touched = solid.filter((s) => s.kind !== 'conveyor' && overlaps(box.get(partKey(s))!, pb, 0.3)).map(partKey);
    if (touched.length >= 2) pipes.push({ key: partKey(p), medium: String(p.params?.color ?? 'air'), stubs: touched });
  }
  return { links, pipes };
}

/** Apply the operator's add/remove edits to the derived links. */
export function effectiveLinks(derived: BoardLink[], edits: BoardLayout['links']): BoardLink[] {
  const removed = new Set(edits.remove.map(([a, b]) => linkId(a, b)));
  const out = derived.filter((l) => !removed.has(l.id));
  for (const [a, b] of edits.add) {
    const id = linkId(a, b);
    if (!out.some((l) => l.id === id) && !removed.has(id)) out.push({ id, from: a, to: b, kind: 'manual' });
  }
  return out;
}

/** Toggle a link between two parts: drop a shown link, restore/add a hidden one. */
export function toggleLink(layout: BoardLayout, derived: BoardLink[], a: string, b: string): BoardLayout {
  if (a === b) return layout;
  const id = linkId(a, b);
  const shown = effectiveLinks(derived, layout.links).some((l) => l.id === id);
  const isDerived = derived.some((l) => l.id === id);
  const add = layout.links.add.filter(([x, y]) => linkId(x, y) !== id);
  const remove = layout.links.remove.filter(([x, y]) => linkId(x, y) !== id);
  if (shown) { if (isDerived) remove.push([a, b]); }
  else if (!isDerived) add.push([a, b]);
  return { ...layout, links: { add, remove } };
}

const mid = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** Orthogonal route between two rectangles (down, across, down; or straight across when side by side). */
export function elbow(a: Rect, b: Rect): [number, number][] {
  const ax = mid(a)[0], bx = mid(b)[0];
  if (b.y >= a.y + a.h) {
    const y1 = a.y + a.h, y2 = b.y, my = snap((y1 + y2) / 2, 2);
    return ax === bx ? [[ax, y1], [bx, y2]] : [[ax, y1], [ax, my], [bx, my], [bx, y2]];
  }
  if (a.y >= b.y + b.h) return elbow(b, a);
  const left = ax < bx ? a : b, right = ax < bx ? b : a;
  const y = (mid(left)[1] + mid(right)[1]) / 2;
  return [[left.x + left.w, y], [right.x, y]];
}

/** Every line to draw, from the CURRENT rectangles (so a move re-routes). Hidden parts drop their lines. */
export function routeBoard(layout: BoardLayout, derived: { links: BoardLink[]; pipes: BoardPipe[] }): BoardLine[] {
  const rect = (k: string): BoardItem | undefined => {
    const it = layout.items[k];
    return it && !it.hidden ? it : undefined;
  };
  const lines: BoardLine[] = [];
  for (const l of effectiveLinks(derived.links, layout.links)) {
    const a = rect(l.from), b = rect(l.to);
    if (a && b) lines.push({ id: l.id, key: l.from, kind: l.kind, pts: elbow(a, b) });
  }
  derived.pipes.forEach((p, i) => {
    const rs = p.stubs.map(rect).filter((r): r is BoardItem => !!r);
    if (rs.length < 2) return;
    const hy = Math.max(...rs.map((r) => r.y + r.h)) + 12 + (i % 4) * 6;
    const xs = rs.map((r) => mid(r)[0]);
    lines.push({ id: `pipe:${p.key}`, key: p.key, kind: 'pipe', medium: p.medium, pts: [[Math.min(...xs), hy], [Math.max(...xs), hy]] });
    rs.forEach((r, j) => lines.push({ id: `pipe:${p.key}:${j}`, key: p.key, kind: 'pipe', medium: p.medium, pts: [[mid(r)[0], r.y + r.h], [mid(r)[0], hy]] }));
  });
  return lines;
}

// ── layout state + edits ─────────────────────────────────────────────────────

const lockedRects = (items: Record<string, BoardItem>) =>
  Object.fromEntries(Object.entries(items).filter(([, i]) => i.locked).map(([k, i]) => [k, { x: i.x, y: i.y, w: i.w, h: i.h }]));

/** Auto layout that keeps every locked part exactly where it is. */
export function autoLayout(
  prev: BoardLayout | null, parts: PlantPart[], boxes: PartBox[], groups: Record<string, string>,
): BoardLayout {
  const old = prev?.items ?? {};
  const out = layoutBoard(parts, boxes, groups, lockedRects(old));
  const items: Record<string, BoardItem> = {};
  for (const [k, r] of Object.entries(out.items)) {
    const was = old[k];
    items[k] = was?.locked ? { ...was } : { ...r, ...(was?.hidden ? { hidden: true } : {}) };
  }
  return { v: 1, w: out.w, h: out.h, items, lanes: out.lanes, links: prev?.links ?? { add: [], remove: [] } };
}

const keep = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Move a part to (x, y), snapped to the grid; locked parts do not move. */
export function moveItem(l: BoardLayout, key: string, x: number, y: number, grid = GRID): BoardLayout {
  const it = l.items[key];
  if (!it || it.locked) return l;
  const nx = keep(snap(x, grid), 0, Math.max(0, l.w - it.w)), ny = keep(snap(y, grid), 0, Math.max(0, l.h - it.h));
  if (nx === it.x && ny === it.y) return l;
  return { ...l, items: { ...l.items, [key]: { ...it, x: nx, y: ny } } };
}

/** Arrow-key nudge: one grid step (or `step` px). */
export const nudgeItem = (l: BoardLayout, key: string, dx: number, dy: number, step = GRID): BoardLayout => {
  const it = l.items[key];
  return it ? moveItem(l, key, it.x + dx * step, it.y + dy * step, step) : l;
};

export function resizeItem(l: BoardLayout, key: string, w: number, h: number): BoardLayout {
  const it = l.items[key];
  if (!it || it.locked) return l;
  const nw = keep(snap(w, 2), MIN_SIDE, 400), nh = keep(snap(h, 2), MIN_SIDE, 400);
  return { ...l, items: { ...l.items, [key]: { ...it, w: nw, h: nh } } };
}

export const setFlag = (l: BoardLayout, key: string, flag: 'locked' | 'hidden', on: boolean): BoardLayout => {
  const it = l.items[key];
  if (!it || !!it[flag] === on) return l;
  const next = { ...it, [flag]: on };
  if (!on) delete next[flag];
  return { ...l, items: { ...l.items, [key]: next } };
};

/** Parts the operator should look at: capture much smaller than the part, or degenerate. */
export function mappingIssues(parts: PlantPart[], caps: Record<string, { w: number; h: number }>, layout: BoardLayout): Record<string, 'missing' | 'tiny' | 'thin'> {
  const out: Record<string, 'missing' | 'tiny' | 'thin'> = {};
  for (const p of parts) {
    if (isPipe(p)) continue;
    const k = partKey(p), c = caps[k];
    if (!c || !layout.items[k]) out[k] = 'missing';
    else if (c.w < 12 && c.h < 12) out[k] = 'tiny';
    else if (Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h)) > 12) out[k] = 'thin';
  }
  return out;
}

/** Place parts that have no item yet (new mapping) without moving anything that exists. */
export function fillMissing(l: BoardLayout, parts: PlantPart[], boxes: PartBox[], groups: Record<string, string>): BoardLayout {
  const pinned = Object.fromEntries(Object.entries(l.items).map(([k, i]) => [k, { x: i.x, y: i.y, w: i.w, h: i.h }]));
  const out = layoutBoard(parts, boxes, groups, pinned);
  const items = { ...l.items };
  for (const [k, r] of Object.entries(out.items)) items[k] ??= r;
  return { ...l, w: Math.max(l.w, out.w), h: Math.max(l.h, out.h), items };
}
