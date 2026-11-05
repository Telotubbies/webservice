import { describe, expect, test } from 'bun:test';
import { layoutHmi } from './hmiLayout';
import type { PlantPart } from '../../lib/plantModel';
import type { PartBox } from './scene';

const part = (label: string, kind: string): PlantPart => ({ label, kind, nodes: [], bindings: {} });
const box = (key: string, x0: number, x1: number, y0: number, y1: number): PartBox =>
  ({ key, min: [x0, y0, -1], max: [x1, y1, 1] });

describe('layoutHmi', () => {
  const parts = [part('Silo B', 'vessel'), part('Belt', 'conveyor'), part('Silo A', 'vessel'), part('Pump', 'pump'), part('Pipe', 'pipe')];
  const boxes = [box('0', 4, 6, 3, 9), box('1', -1, 10, 0, 1), box('2', 0, 2, 3, 9), box('3', 8, 9, 0, 2), box('4', 1, 9, 1, 8)];
  const lay = layoutHmi(parts, boxes);
  const at = (k: string) => lay.nodes.find((n) => n.key === k)!;

  test('rows by kind, model order left to right', () => {
    expect(at('0').row).toBe('store');
    expect(at('1').row).toBe('move');
    expect(at('3').row).toBe('process');
    expect(at('2').x).toBeLessThan(at('0').x);
    expect(lay.nodes.find((n) => n.key === '4')).toBeUndefined();
  });

  test('no overlaps within a row', () => {
    const store = lay.nodes.filter((n) => n.row === 'store').sort((a, b) => a.x - b.x);
    for (let i = 1; i < store.length; i++) expect(store[i].x - store[i].w / 2).toBeGreaterThan(store[i - 1].x + store[i - 1].w / 2);
  });

  test('drops only to a belt under the vessel; pipes join touched parts', () => {
    expect(lay.links.map((l) => l.from).sort()).toEqual(['0', '2']);
    expect(lay.pipes[0].stubs.sort()).toEqual(['0', '2', '3']);
  });

  test('parts without a box are skipped', () => {
    expect(layoutHmi([part('X', 'motor')], []).nodes).toHaveLength(0);
  });
});
