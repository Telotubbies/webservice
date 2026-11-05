import { expect, test } from 'bun:test';
import { fromSelection, repairScope, scopeCrumbs, toSelection } from './scopeModel';
import type { HArea } from './api';

const tree = [
  { id: 'a1', name: 'Batching', lines: [{ id: 'l1', name: 'Line 1' }] },
  { id: 'a2', name: 'Sorting', lines: [{ id: 'l2', name: 'Sorter' }] },
] as unknown as HArea[];

test('crumbs follow the tree', () =>
  expect(scopeCrumbs(tree, { areaId: 'a1', lineId: 'l1' }).map((c) => c.label)).toEqual(['Batching', 'Line 1']));
test('area-only scope has one crumb', () =>
  expect(scopeCrumbs(tree, { areaId: 'a2' })).toEqual([{ label: 'Sorting', id: 'a2', level: 'area' }]));
test('stale line is dropped', () => expect(repairScope(tree, { areaId: 'a1', lineId: 'gone' })).toEqual({ areaId: 'a1' }));
test('a line from another area is dropped', () => expect(repairScope(tree, { areaId: 'a1', lineId: 'l2' })).toEqual({ areaId: 'a1' }));
test('a deleted area clears everything', () => expect(repairScope(tree, { areaId: 'zz', lineId: 'l1' })).toEqual({}));
test('scope maps onto the shared equipment selection', () => {
  expect(toSelection({ areaId: 'a1', lineId: 'l1' })).toBe('line:l1');
  expect(toSelection({ areaId: 'a1' })).toBe('area:a1');
  expect(toSelection({})).toBeNull();
});
test('and back, finding a line’s area in the tree', () => {
  expect(fromSelection(tree, 'line:l2')).toEqual({ areaId: 'a2', lineId: 'l2' });
  expect(fromSelection(tree, 'area:a1')).toEqual({ areaId: 'a1' });
  expect(fromSelection(tree, '7')).toEqual({});   // an equipment pick is below line level
  expect(fromSelection(tree, null)).toEqual({});
});
