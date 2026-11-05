import { expect, test } from 'bun:test';
import { bulletScale } from './bullet';

test('scales and clamps', () =>
  expect(bulletScale({ value: 120, target: 80, max: 100, bands: [50] })).toEqual({ valuePct: 100, targetPct: 80, bandPcts: [50] }));
test('no target, negative clamps to zero', () =>
  expect(bulletScale({ value: -5, max: 10 })).toEqual({ valuePct: 0, targetPct: null, bandPcts: [] }));
test('zero max does not divide by zero', () =>
  expect(bulletScale({ value: 3, max: 0 }).valuePct).toBe(0));
