import { expect, test } from 'bun:test';
import { segments } from './timeline';

test('constant signal fills the window', () =>
  expect(segments([{ t: 0, v: 1 }], 0, 100_000, [], 1e9)).toEqual([{ from: 0, to: 100_000, state: 'running' }]));
test('silence becomes nodata', () =>
  expect(segments([{ t: 0, v: 1 }, { t: 50_000, v: 1 }], 0, 50_000, [], 15_000).some((s) => s.state === 'nodata')).toBe(true));
test('stop then run', () =>
  expect(segments([{ t: 0, v: 0 }, { t: 10, v: 1 }], 0, 20, [], 1e9).map((s) => s.state)).toEqual(['stopped', 'running']));
test('a fault timestamp turns its segment into fault', () =>
  expect(segments([{ t: 0, v: 1 }, { t: 10, v: 0 }], 0, 20, [5], 1e9).map((s) => s.state)).toEqual(['fault', 'stopped']));
test('before the first sample is nodata', () =>
  expect(segments([{ t: 10, v: 1 }], 0, 20, [], 1e9)).toEqual([{ from: 0, to: 10, state: 'nodata' }, { from: 10, to: 20, state: 'running' }]));
test('no samples at all is one nodata bar', () =>
  expect(segments([], 0, 20, [], 1e9)).toEqual([{ from: 0, to: 20, state: 'nodata' }]));
