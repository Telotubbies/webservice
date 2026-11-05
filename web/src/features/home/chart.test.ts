import { expect, test } from 'bun:test';
import { aggOf, areaPath, bucketize, deltaPerBucket, bucketTimes, domainOf, linePath, stepsFromLimits, thToken, ticksOf } from './chart';

test('bucketize averages values per bucket and leaves silent buckets null', () => {
  const pts = [{ t: 0, v: 1 }, { t: 5, v: 3 }, { t: 25, v: 10 }];
  expect(bucketize(pts, 0, 30, 3, 'avg')).toEqual([2, null, 10]);
});

test('bucketize sums counts and fills empty buckets with zero', () => {
  expect(bucketize([{ t: 1, v: 1 }, { t: 2, v: 1 }, { t: 21, v: 1 }], 0, 30, 3, 'sum')).toEqual([2, 0, 1]);
});

test('bucketize drops points outside the window', () => {
  expect(bucketize([{ t: -5, v: 9 }, { t: 35, v: 9 }, { t: 10, v: 4 }], 0, 30, 3, 'avg')).toEqual([null, 4, null]);
});

test('bucketTimes returns bucket centres', () => {
  expect(bucketTimes(0, 30, 3)).toEqual([5, 15, 25]);
});

test('domain of bars starts at zero; explicit limits win', () => {
  expect(domainOf([3, 7], null, null, true)[0]).toBe(0);
  expect(domainOf([93, 99], 90, 100, false)).toEqual([90, 100]);
});

test('domain ignores nulls and survives a flat series', () => {
  const d = domainOf([null, 5, 5, null], null, null, false);
  expect(d[0]).toBeLessThan(5);
  expect(d[1]).toBeGreaterThan(5);
});

test('ticks are clean steps inside the domain', () => {
  expect(ticksOf([0, 100])).toEqual([0, 25, 50, 75, 100]);
});

test('a null bucket breaks the line into two segments', () => {
  const d = linePath([1, 2, null, 3, 4], [0, 10], 'linear');
  expect(d.match(/M/g)?.length).toBe(2);
});

test('area fills each segment down to the floor, never across a gap', () => {
  const d = areaPath([1, 2, null, 3, 4], [0, 10], 'linear');
  expect(d.match(/Z/g)?.length).toBe(2);
  expect(areaPath([0, 10], [0, 10], 'linear')).toBe('M0 1000L1000 0L1000 1000L0 1000Z');
});

test('step line moves horizontally then vertically', () => {
  expect(linePath([0, 10], [0, 10], 'step')).toBe('M0 1000H1000V0');
});

test('aggregations over several series', () => {
  expect(aggOf([[1, 2], [3, null]], 'sum')).toBe(6);
  expect(aggOf([[1, 2], [3, 5]], 'avg')).toBe(2.75);
  expect(aggOf([[1, 2], [3, 5]], 'last')).toBe(3.5);
  expect(aggOf([[1, 9], [3, null]], 'max')).toBe(9);
  expect(aggOf([[null]], 'avg')).toBeNull();
});

test('the colour of a value is the highest step it reached', () => {
  const t = { base: 'ok', steps: [{ v: 80, c: 'crit' }, { v: 70, c: 'warn' }] };
  expect(thToken(t, 50)).toBe('ok');
  expect(thToken(t, 70)).toBe('warn');
  expect(thToken(t, 95)).toBe('crit');
});

test('alarm limits become ordered threshold steps', () => {
  expect(stepsFromLimits([{ v: 80, kind: 'hihi' }, { v: 70, kind: 'hi' }])).toEqual({ base: 'ok', steps: [{ v: 70, c: 'warn' }, { v: 80, c: 'crit' }] });
  expect(stepsFromLimits([{ v: 10, kind: 'lolo' }, { v: 20, kind: 'lo' }, { v: 90, kind: 'hi' }])).toEqual({
    base: 'crit', steps: [{ v: 10, c: 'warn' }, { v: 20, c: 'ok' }, { v: 90, c: 'warn' }],
  });
  expect(stepsFromLimits([])).toBeNull();
});

test('counter increases are summed per bucket; a reset is not negative output', () => {
  const pts = [{ t: 0, v: 5 }, { t: 4, v: 6 }, { t: 12, v: 8 }, { t: 15, v: 0 }, { t: 25, v: 1 }];
  expect(deltaPerBucket(pts, 0, 30, 3)).toEqual([1, 2, 1]);
});

test('the first sample of the window only sets the baseline', () => {
  expect(deltaPerBucket([{ t: 2, v: 100 }], 0, 30, 3)).toEqual([0, 0, 0]);
});
