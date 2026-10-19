import { expect, test } from 'bun:test';
import { AGG_AFTER_MS, bucketFor, pathOf } from './agg';

const H = 3600e3;
const D = 24 * H;

test('bucketFor aims for ~600 points: whole minutes below an hour, whole hours above', () => {
  expect(bucketFor(9 * H)).toBe(60);       // never finer than the 1-minute rollup
  expect(bucketFor(D)).toBe(180);          // 144 s -> next whole minute
  expect(bucketFor(7 * D)).toBe(1020);     // 1008 s -> 17 min
  expect(bucketFor(30 * D)).toBe(7200);    // 4320 s -> 2 h (hourly rollup)
  expect(bucketFor(365 * D)).toBe(54000);  // 52560 s -> 15 h
});

test('bucketFor always lands on a size the backend can serve from a rollup', () => {
  for (const span of [9 * H, 12 * H, D, 3 * D, 7 * D, 30 * D, 90 * D, 365 * D]) {
    const b = bucketFor(span);
    expect(b % 60).toBe(0);
    expect(span / 1000 / b).toBeLessThanOrEqual(600);
  }
});

test('windows up to the raw-history limit stay raw', () => {
  expect(AGG_AFTER_MS).toBe(8 * H);
});

test('pathOf drops the site code and turns dots into slashes', () => {
  expect(pathOf('plant1.sort.line1.motor1.running')).toBe('sort/line1/motor1/running');
  expect(pathOf('b_site.e2e.line1.sensor.temp')).toBe('e2e/line1/sensor/temp');
});
