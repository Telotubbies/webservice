import { expect, test } from 'bun:test';
import { pareto } from './pareto';

test('sorted with cumulative share', () =>
  expect(pareto([{ label: 'a', value: 1 }, { label: 'b', value: 3 }], 8, 'Other')).toEqual([
    { label: 'b', value: 3, cumPct: 75 }, { label: 'a', value: 1, cumPct: 100 }]));
test('tail folds into Other', () =>
  expect(pareto([1, 2, 3, 4].map((v, i) => ({ label: `x${i}`, value: v })), 2, 'Other').at(-1)?.label).toBe('Other'));
test('Other carries the tail total and closes at 100 %', () =>
  expect(pareto([1, 2, 3, 4].map((v, i) => ({ label: `x${i}`, value: v })), 2, 'Other').at(-1)).toEqual({ label: 'Other', value: 3, cumPct: 100 }));
test('all zero stays at zero share', () =>
  expect(pareto([{ label: 'a', value: 0 }], 8, 'Other')).toEqual([{ label: 'a', value: 0, cumPct: 0 }]));
