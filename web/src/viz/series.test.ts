import { expect, test } from 'bun:test';
import { breachOnsets, legendToggle, withGaps } from './series';

test('gap becomes null', () =>
  expect(withGaps([{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 9, v: 1 }]).some((p) => p.v === null)).toBe(true));
test('regular cadence keeps every point and adds none', () =>
  expect(withGaps([{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 3 }])).toEqual([{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 3 }]));
test('onset only on entry', () =>
  expect(breachOnsets([{ t: 0, v: 70 }, { t: 1, v: 81 }, { t: 2, v: 85 }, { t: 3, v: 70 }, { t: 4, v: 90 }], { v: 80, kind: 'hi' })).toEqual([1, 4]));
test('low limits breach downward', () =>
  expect(breachOnsets([{ t: 0, v: 5 }, { t: 1, v: 1 }, { t: 2, v: 0 }], { v: 2, kind: 'lolo' })).toEqual([1]));
test('already in breach at the start counts as an onset', () =>
  expect(breachOnsets([{ t: 0, v: 95 }, { t: 1, v: 96 }], { v: 80, kind: 'hihi' })).toEqual([0]));
test('isolate twice shows all', () => {
  const all = ['a', 'b', 'c'];
  const once = legendToggle(new Set(all), 'a', 'isolate', all);
  expect([...once]).toEqual(['a']);
  expect([...legendToggle(once, 'a', 'isolate', all)].sort()).toEqual(all);
});
test('toggle hides and shows one', () => {
  const all = ['a', 'b'];
  expect([...legendToggle(new Set(all), 'b', 'toggle', all)]).toEqual(['a']);
  expect([...legendToggle(new Set(['a']), 'b', 'toggle', all)].sort()).toEqual(all);
});
test('toggling the last visible series off shows all again (never an empty chart)', () =>
  expect([...legendToggle(new Set(['a']), 'a', 'toggle', ['a', 'b'])].sort()).toEqual(['a', 'b']));
