import { expect, test } from 'bun:test';
import { formatRange, parseRange } from './range';

const now = 1_000_000_000_000;
test('preset is live', () => expect(parseRange('?range=4h', now)).toEqual({ from: now - 4 * 3600_000, to: now, live: true, preset: '4h' }));
test('absolute round-trips', () => {
  const r = parseRange('?from=1&to=2', now);
  expect(r.live).toBe(false);
  expect(parseRange(formatRange(r), now)).toEqual(r);
});
test('garbage falls back to 1h', () => expect(parseRange('?range=abc', now).preset).toBe('1h'));
test('nothing given is 1h live', () => expect(parseRange('', now)).toEqual({ from: now - 3600_000, to: now, live: true, preset: '1h' }));
test('the legacy w= window still works', () => expect(parseRange('?w=8h', now).preset).toBe('8h'));
test('a reversed absolute range is rejected', () => expect(parseRange('?from=5&to=2', now).preset).toBe('1h'));
test('preset formats as range=', () => expect(formatRange(parseRange('?range=7d', now))).toBe('range=7d'));
