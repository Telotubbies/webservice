import { expect, test } from 'bun:test';
import { sparkPath, statDelta } from './stat';

const pts = [{ t: 0, v: 10 }, { t: 30_000, v: 11 }, { t: 60_000, v: 12 }];
test('delta vs the window start', () => expect(statDelta(pts, 60_000, 60_000)).toEqual({ delta: 2, pct: 20, dir: 'up' }));
test('no history no delta', () => expect(statDelta([], 0, 60_000)).toBeNull());
test('tiny change is flat', () =>
  expect(statDelta([{ t: 0, v: 1000 }, { t: 60_000, v: 1002 }], 60_000, 60_000)?.dir).toBe('flat'));
test('from zero there is no percentage', () =>
  expect(statDelta([{ t: 0, v: 0 }, { t: 60_000, v: 5 }], 60_000, 60_000)).toEqual({ delta: 5, pct: null, dir: 'up' }));
test('gap breaks the path', () =>
  expect(sparkPath([{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 10, v: 1 }], 100, 20).match(/M/g)?.length).toBe(2));
test('empty input draws nothing', () => expect(sparkPath([], 100, 20)).toBe(''));
