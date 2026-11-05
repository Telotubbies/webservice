import { describe, expect, test } from 'bun:test';
import { summarize, tableRows } from './summary';

const pts = (vs: number[]) => vs.map((v, i) => ({ t: i * 1000, v }));

describe('summarize', () => {
  test('empty and all-NaN series have no summary', () => {
    expect(summarize([])).toBeNull();
    expect(summarize(pts([NaN, NaN]))).toBeNull();
  });
  test('range, latest and direction', () => {
    expect(summarize(pts([10, 12, 9, 20]))).toEqual({ n: 4, first: 10, last: 20, min: 9, max: 20, trend: 'up' });
    expect(summarize(pts([20, 5]))?.trend).toBe('down');
  });
  test('noise inside the flat band reads as steady', () => {
    expect(summarize(pts([50, 60, 40, 50.5]))?.trend).toBe('flat');
    expect(summarize(pts([7, 7, 7]))?.trend).toBe('flat');
  });
  test('non-finite samples are skipped, not counted', () => {
    expect(summarize(pts([NaN, 1, Infinity, 3]))).toMatchObject({ n: 2, first: 1, last: 3 });
  });
});

describe('tableRows', () => {
  test('short series keep every row', () => {
    expect(tableRows(3)).toEqual([0, 1, 2]);
    expect(tableRows(0)).toEqual([]);
  });
  test('long series are thinned evenly and end on the newest sample', () => {
    const r = tableRows(1000, 60);
    expect(r).toHaveLength(60);
    expect(r[0]).toBe(0);
    expect(r[59]).toBe(999);
  });
});
