import { describe, expect, test } from 'bun:test';
import { findGaps, statsOf, withBreaks, type Sample } from './shape';

const s = (t: number, v: number | null, extra: Partial<Sample> = {}): Sample => ({ t, v, ...extra });

describe('findGaps', () => {
  test('a regular series has no gaps', () => {
    expect(findGaps([s(0, 1), s(1000, 2), s(2000, 3)], [0, 2000], 1000)).toEqual([]);
  });

  test('silence longer than the max gap is missing data, starting one step after the last sample', () => {
    const g = findGaps([s(0, 1), s(1000, 1), s(10_000, 1), s(11_000, 1)], [0, 11_000], 1000);
    expect(g).toEqual([{ from: 2000, to: 10_000, kind: 'missing' }]);
  });

  test('silence exactly at the max gap is not a gap', () => {
    expect(findGaps([s(0, 1), s(3000, 1)], [0, 3000], 1000, 3000)).toEqual([]);
    expect(findGaps([s(0, 1), s(3001, 1)], [0, 3001], 1000, 3000)).toHaveLength(1);
  });

  test('a run of bad samples is one bad span ending at the next good sample', () => {
    const g = findGaps([s(0, 1), s(1000, null), s(2000, null), s(3000, 4)], [0, 3000], 1000);
    expect(g).toEqual([{ from: 1000, to: 3000, kind: 'bad' }]);
  });

  test('a bad run at the end closes one step after the last sample, clipped to the window', () => {
    expect(findGaps([s(0, 1), s(1000, null)], [0, 1500], 1000)).toEqual([{ from: 1000, to: 1500, kind: 'bad' }]);
  });

  test('silence before the first and after the last sample is missing', () => {
    const g = findGaps([s(10_000, 1), s(11_000, 1)], [0, 20_000], 1000);
    expect(g).toEqual([
      { from: 0, to: 10_000, kind: 'missing' },
      { from: 12_000, to: 20_000, kind: 'missing' },
    ]);
  });

  test('no samples: the whole window is missing', () => {
    expect(findGaps([], [5, 50], 1)).toEqual([{ from: 5, to: 50, kind: 'missing' }]);
  });

  test('a missing bucket among hourly rollup rows is a gap (max gap 1.5 buckets)', () => {
    const h = 3600e3;
    const g = findGaps([s(0, 1), s(h, 1), s(3 * h, 1)], [0, 4 * h], h, 1.5 * h);
    expect(g).toEqual([{ from: 2 * h, to: 3 * h, kind: 'missing' }]);
  });
});

describe('withBreaks', () => {
  test('puts a null at the start of each missing span so the line never bridges it', () => {
    const pts = [s(0, 1), s(1000, 1), s(10_000, 1)];
    const out = withBreaks(pts, findGaps(pts, [0, 10_000], 1000));
    expect(out.map((p) => [p.t, p.v])).toEqual([[0, 1], [1000, 1], [2000, null], [10_000, 1]]);
  });

  test('leaves the samples alone when there is no gap', () => {
    const pts = [s(0, 1), s(1000, 2)];
    expect(withBreaks(pts, [])).toBe(pts);
  });
});

describe('statsOf', () => {
  test('empty input has no stats', () => {
    expect(statsOf([])).toEqual({ last: null, lastT: null, min: null, max: null, avg: null });
  });

  test('raw samples: last / min / avg / max, bad samples ignored', () => {
    expect(statsOf([s(0, 2), s(1, null), s(2, 6), s(3, 4)])).toEqual({ last: 4, lastT: 3, min: 2, max: 6, avg: 4 });
  });

  test('rollup buckets: min/max come from the band, avg is weighted by sample count', () => {
    const rows = [s(0, 10, { mn: 9, mx: 11, n: 60 }), s(60, 20, { mn: 5, mx: 95, n: 20 })];
    expect(statsOf(rows)).toEqual({ last: 20, lastT: 60, min: 5, max: 95, avg: 12.5 });
  });

  test('a spike that only lives in the max band still sets max', () => {
    const rows = Array.from({ length: 100 }, (_, i) => s(i, 50, { mn: 49, mx: i === 42 ? 400 : 51, n: 60 }));
    expect(statsOf(rows).max).toBe(400);
  });
});
