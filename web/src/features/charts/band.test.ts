import { describe, expect, test } from 'bun:test';
import { bandSegments, rowsToSamples, statsOf, yDomain, type BucketRow } from './shape';
import { fmtAxisTick, placeLabels } from '../trends/viz';
import { pickSource } from './source';

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe('rowsToSamples', () => {
  test('raw: bad quality and non-numbers become bad samples, bool is 0/1, sorted', () => {
    const s = rowsToSamples([
      { ts: '2026-11-05T10:00:02Z', v: true, q: 'good' },
      { ts: '2026-11-05T10:00:00Z', v: 4, q: 'good' },
      { ts: '2026-11-05T10:00:01Z', v: 9, q: 'bad' },
      { ts: '2026-11-05T10:00:03Z', v: 'on' },
    ]);
    expect(s.map((p) => p.v)).toEqual([4, null, 1, null]);
  });
  test('buckets keep the band and count', () => {
    const [p] = rowsToSamples([{ ts: '2026-11-05T10:00:00Z', min: 1, max: 9, avg: 4, n: 60 }]);
    expect(p).toMatchObject({ v: 4, mn: 1, mx: 9, n: 60 });
  });
});

describe('bandSegments', () => {
  const mk = (t: number, v: number | null, mn = 0, mx = 1) => ({ t, v, mn: v == null ? null : mn, mx: v == null ? null : mx });
  test('a bad bucket or a long silence splits the band', () => {
    const segs = bandSegments([mk(0, 1), mk(60, 1), mk(120, null), mk(180, 1), mk(10_000, 1)], 150);
    expect(segs.map((s) => s.length)).toEqual([2, 1, 1]);
  });
  test('raw samples have no band', () => {
    expect(bandSegments([{ t: 0, v: 1 }, { t: 1, v: 2 }], 10)).toEqual([]);
  });
});

describe.each([
  ['7 days', 7, '1m'],
  ['30 days', 30, '1h'],
] as const)('a spike stays visible at %s (F04)', (_name, days, source) => {
  // one 1-second spike of 100 in a flat 50 signal, read from rollup buckets
  const span = days * 24 * H;
  const from = NOW - span;
  const plan = pickSource(from, NOW, NOW);
  const spikeAt = from + span / 2 + 17 * 60e3;
  const bucketMs = plan.bucketS! * 1000;
  const rows: BucketRow[] = [];
  for (let t = Math.ceil(from / bucketMs) * bucketMs; t < NOW; t += bucketMs) {
    const hit = spikeAt >= t && spikeAt < t + bucketMs;
    const n = plan.bucketS!;
    // exact rollup maths: avg = sum / count, min/max kept
    rows.push({ ts: new Date(t).toISOString(), min: 50, max: hit ? 100 : 50, avg: hit ? (50 * (n - 1) + 100) / n : 50, n });
  }
  const samples = rowsToSamples(rows);

  test('reads the rollup, not raw', () => expect(plan.source).toBe(source));
  test('the average line alone would hide the spike', () => {
    expect(Math.max(...samples.map((p) => p.v!))).toBeLessThan(55);
  });
  test('max, band and y domain still carry it', () => {
    expect(statsOf(samples).max).toBe(100);
    expect(bandSegments(samples, bucketMs * 3).flat().some((b) => b.mx === 100)).toBe(true);
    expect(yDomain(samples)![1]).toBeGreaterThan(100);
  });
});

describe('yDomain', () => {
  test('includes limits and pads; flat signal widens; empty is null', () => {
    const [lo, hi] = yDomain([{ t: 0, v: 5 }, { t: 1, v: 10 }], [20])!;
    expect(lo).toBeLessThan(5); expect(hi).toBeGreaterThan(20);
    const [a, b] = yDomain([{ t: 0, v: 3 }])!;
    expect(b - a).toBeGreaterThan(2);
    expect(yDomain([{ t: 0, v: null }])).toBeNull();
  });
});

describe('missing raw values are not zeros (fix 1)', () => {
  test('null, empty string and undefined are bad samples; 0 stays good', () => {
    const rows = [null, '', undefined, 0, '0', '  '].map((v, i) => ({ ts: new Date(NOW + i * 1000).toISOString(), v, q: 'good' }));
    const s = rowsToSamples(rows as never);
    expect(s.map((p) => p.v)).toEqual([null, null, null, 0, 0, null]);
    expect(statsOf(s).min).toBe(0);
    expect(statsOf(rowsToSamples(rows.slice(0, 3) as never)).min).toBeNull();
  });
});

describe('placeLabels (fix 3)', () => {
  test('labels at nearby lines never overlap', () => {
    const tops = placeLabels([100, 108, 400], 12, 0);
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) expect(Math.abs(tops[i] - tops[j])).toBeGreaterThanOrEqual(12);
  });
  test('a lone label sits above its line', () => expect(placeLabels([100], 12, 0)).toEqual([86]));
});

describe('fmtAxisTick (fix 4)', () => {
  const mid = new Date(2026, 10, 5, 0, 0).getTime();
  test('multi-day ranges show the date at midnight and time elsewhere', () => {
    expect(fmtAxisTick(mid, 7 * 86400, 'en')).toBe('5 Nov');
    expect(fmtAxisTick(mid + 12 * H, 7 * 86400, 'en')).toBe('12:00');
  });
  test('short ranges stay times', () => expect(fmtAxisTick(mid, 3600, 'en')).toBe('00:00'));
});
