import { describe, expect, test } from 'bun:test';
import { RETAIN_1M_MS, pickSource } from './source';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const H = 3600e3;
const D = 24 * H;
const at = (spanMs: number, endMs = NOW) => pickSource(endMs - spanMs, endMs, NOW);

describe('pickSource', () => {
  test('up to 8 h is raw samples, exactly 8 h included', () => {
    expect(at(15 * 60e3)).toEqual({ source: 'raw', bucketS: null });
    expect(at(8 * H)).toEqual({ source: 'raw', bucketS: null });
  });

  test('one millisecond past 8 h switches to the minute rollup', () => {
    expect(at(8 * H + 1)).toEqual({ source: '1m', bucketS: 60 });
  });

  test('the minute rollup holds up to 590 h, then the hourly rollup takes over', () => {
    expect(at(24 * H)).toEqual({ source: '1m', bucketS: 180 });
    expect(at(590 * H)).toEqual({ source: '1m', bucketS: 3540 });
    expect(at(590 * H + 1000)).toEqual({ source: '1h', bucketS: 3600 });
    expect(at(30 * D)).toEqual({ source: '1h', bucketS: 7200 });
  });

  test('a window starting exactly at the 1m retention edge still reads 1m', () => {
    const from = NOW - RETAIN_1M_MS;
    expect(pickSource(from, from + D, NOW)).toEqual({ source: '1m', bucketS: 180 });
  });

  test('older than the 1m retention, a minute bucket steps up to an hour', () => {
    const from = NOW - RETAIN_1M_MS - 1;
    expect(pickSource(from, from + D, NOW)).toEqual({ source: '1h', bucketS: 3600 });
  });

  test('every bucketed plan stays under the backend 2000-bucket cap', () => {
    for (const span of [8 * H + 1, 2 * D, 7 * D, 89 * D, 365 * D]) {
      const p = at(span);
      expect(p.bucketS).not.toBeNull();
      expect(span / 1000 / p.bucketS!).toBeLessThanOrEqual(2000);
    }
  });

  test('a bucket is a whole number of the table it names (backend pick_source agrees)', () => {
    for (const span of [9 * H, 3 * D, 40 * D, 400 * D]) {
      const p = at(span);
      expect(p.bucketS! % (p.source === '1h' ? 3600 : 60)).toBe(0);
    }
  });
});
