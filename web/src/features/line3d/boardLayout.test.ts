import { describe, expect, test } from 'bun:test';
import type { PlantPart } from '../../lib/plantModel';
import type { PartBox } from './scene';
import {
  autoLayout, BOARD_W, deriveGroups, deriveLinks, effectiveLinks, elbow, layoutBoard, moveItem, nudgeItem,
  partKey, routeBoard, setFlag, toggleLink, type BoardLayout, type Rect,
} from './boardLayout';

let n = 0;
const part = (label: string, kind: string, bindings: Record<string, string> = {}, params = {}): PlantPart =>
  ({ label, kind, nodes: [++n], bindings, params });
const box = (p: PlantPart, x0: number, x1: number, y0: number, y1: number): PartBox =>
  ({ key: partKey(p), min: [x0, y0, -1], max: [x1, y1, 1] });

const silo = part('Cement silo 1', 'vessel', { level: 'batch/cem/silo1/level_pct' });
const silo2 = part('Cement silo 2', 'vessel', { level: 'batch/cem/silo2/level_pct' });
const bin = part('Aggregate bin 1', 'vessel', { level: 'batch/agg/bin1/level_pct' });
const belt = part('Belt conveyor 1', 'conveyor');
const mixer = part('Mixer', 'mixer', { run: 'batch/mix/mixer1/running' });
const pipe = part('Pipe line DN100', 'pipe', {}, { color: 'cement' });
const parts = [silo, silo2, bin, belt, mixer, pipe];
const boxes = [
  box(silo, 0, 2, 3, 9), box(silo2, 3, 5, 3, 9), box(bin, 8, 10, 3, 9), box(belt, 7, 14, 0, 1),
  box(mixer, 12, 15, 4, 6), box(pipe, 0, 5, 2, 3.5),
];
const groups = deriveGroups(parts);

describe('deriveGroups', () => {
  test('tag path first, then name', () => {
    expect(groups[partKey(silo)]).toBe('cement');
    expect(groups[partKey(bin)]).toBe('aggregates');
    expect(groups[partKey(belt)]).toBe('aggregates');
    expect(groups[partKey(mixer)]).toBe('mixing');
  });
});

describe('layoutBoard', () => {
  const out = layoutBoard(parts, boxes, groups);
  const rects = Object.entries(out.items);
  const clash = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test('places every drawable part, pipes become lines', () => {
    expect(Object.keys(out.items).sort()).toEqual([silo, silo2, bin, belt, mixer].map(partKey).sort());
  });
  test('no overlaps and inside the board', () => {
    for (const [ka, a] of rects) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(out.w);
      for (const [kb, b] of rects) if (ka < kb) expect(clash(a, b)).toBe(false);
    }
  });
  test('one lane per area, plant order left to right', () => {
    expect(out.lanes.map((l) => l.id)).toEqual(['cement', 'aggregates', 'mixing']);
    expect(out.items[partKey(silo)].x).toBeLessThan(out.items[partKey(silo2)].x);
  });
  test('is deterministic', () => {
    expect(layoutBoard(parts, boxes, groups)).toEqual(out);
  });
  test('locked parts never move and are not overlapped', () => {
    const pin = { [partKey(belt)]: { x: 60, y: 40, w: 150, h: 30 } };
    const again = layoutBoard(parts, boxes, groups, pin);
    expect(again.items[partKey(belt)]).toEqual(pin[partKey(belt)]);
    for (const [k, r] of Object.entries(again.items)) if (k !== partKey(belt)) expect(clash(r, pin[partKey(belt)])).toBe(false);
  });
  test('wraps lanes at the board width', () => {
    const many = Array.from({ length: 30 }, (_, i) => part(`Silo ${i}`, 'vessel'));
    const o = layoutBoard(many, many.map((p, i) => box(p, i, i + 2, 0, 6)), Object.fromEntries(many.map((p) => [partKey(p), 'cement'])));
    expect(Math.max(...Object.values(o.items).map((r) => r.x + r.w))).toBeLessThanOrEqual(BOARD_W);
    expect(o.lanes).toHaveLength(1);
  });
});

describe('autoLayout keeps manual placement of locked parts', () => {
  test('re-layout after a drag', () => {
    let l = autoLayout(null, parts, boxes, groups);
    const k = partKey(silo);
    l = moveItem(l, k, 333, 217);
    l = setFlag(l, k, 'locked', true);
    const placed = { ...l.items[k] };
    const next = autoLayout(l, parts, boxes, groups);
    expect(next.items[k]).toEqual(placed);
    expect(next.items[k].locked).toBe(true);
    expect(next.items[partKey(silo2)]).toBeDefined();
  });
  test('unlocked parts do go back to their auto place', () => {
    let l = autoLayout(null, parts, boxes, groups);
    const auto = { ...l.items[partKey(bin)] };
    l = moveItem(l, partKey(bin), 700, 500);
    expect(autoLayout(l, parts, boxes, groups).items[partKey(bin)]).toMatchObject({ x: auto.x, y: auto.y });
  });
  test('hidden stays hidden', () => {
    let l = autoLayout(null, parts, boxes, groups);
    l = setFlag(l, partKey(bin), 'hidden', true);
    expect(autoLayout(l, parts, boxes, groups).items[partKey(bin)].hidden).toBe(true);
  });
});

describe('edits', () => {
  const base = autoLayout(null, parts, boxes, groups);
  const k = partKey(silo);
  test('drag snaps to the grid', () => {
    const m = moveItem(base, k, 103, 87);
    expect([m.items[k].x, m.items[k].y]).toEqual([100, 90]);
  });
  test('arrow nudge moves one grid step, shift moves 1px', () => {
    const a = base.items[k];
    expect(nudgeItem(base, k, 1, 0).items[k].x).toBe(a.x + 10);
    expect(nudgeItem(base, k, 0, 1, 1).items[k].y).toBe(a.y + 1);
  });
  test('locked part ignores move and nudge', () => {
    const l = setFlag(base, k, 'locked', true);
    expect(moveItem(l, k, 500, 500)).toBe(l);
    expect(nudgeItem(l, k, 1, 0)).toBe(l);
  });
  test('cannot leave the board', () => {
    const m = moveItem(base, k, -50, -50);
    expect([m.items[k].x, m.items[k].y]).toEqual([0, 0]);
  });
});

describe('links', () => {
  const d = deriveLinks(parts, boxes);
  test('vessel above a belt drops onto it; pipe joins what it touches', () => {
    expect(d.links.map((l) => l.id)).toContain(`${partKey(bin)}>${partKey(belt)}`);
    expect(d.pipes[0].stubs.sort()).toEqual([partKey(silo), partKey(silo2)].sort());
    expect(d.pipes[0].medium).toBe('cement');
  });
  test('moving a part re-routes its line', () => {
    const l = autoLayout(null, parts, boxes, groups);
    const id = `${partKey(bin)}>${partKey(belt)}`;
    const before = routeBoard(l, d).find((x) => x.id === id)!;
    const moved = moveItem(l, partKey(bin), l.items[partKey(bin)].x + 200, l.items[partKey(bin)].y);
    const after = routeBoard(moved, d).find((x) => x.id === id)!;
    expect(after.pts).not.toEqual(before.pts);
  });
  test('hidden part drops its lines', () => {
    const l = setFlag(autoLayout(null, parts, boxes, groups), partKey(silo), 'hidden', true);
    expect(routeBoard(l, d).filter((x) => x.kind === 'pipe')).toEqual([]);
  });
  test('toggle removes a derived link and restores it; adds a manual one', () => {
    const l0 = autoLayout(null, parts, boxes, groups);
    const [a, b] = [partKey(bin), partKey(belt)];
    const l1 = toggleLink(l0, d.links, a, b);
    expect(effectiveLinks(d.links, l1.links)).toHaveLength(0);
    expect(effectiveLinks(d.links, toggleLink(l1, d.links, a, b).links)).toHaveLength(1);
    const l2 = toggleLink(l0, d.links, partKey(silo), partKey(mixer));
    expect(effectiveLinks(d.links, l2.links).some((x) => x.kind === 'manual')).toBe(true);
  });
  test('elbow runs down-across-down, straight when aligned', () => {
    expect(elbow({ x: 0, y: 0, w: 20, h: 20 }, { x: 0, y: 100, w: 20, h: 20 })).toEqual([[10, 20], [10, 100]]);
    expect(elbow({ x: 0, y: 0, w: 20, h: 20 }, { x: 100, y: 100, w: 20, h: 20 })).toHaveLength(4);
  });
});

test('layout json round-trips', () => {
  const l: BoardLayout = autoLayout(null, parts, boxes, groups);
  expect(JSON.parse(JSON.stringify(l))).toEqual(l);
});
