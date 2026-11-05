import { expect, test } from 'bun:test';
import { LEGACY, resolveLegacy } from './redirects';

test('params survive', () => expect(resolveLegacy('/infrastructure/sources/abc', '?source=s1')).toBe('/connect/gateways/abc?source=s1'));
test('plain move', () => expect(resolveLegacy('/oee', '')).toBe('/production/oee'));
test('query is kept', () => expect(resolveLegacy('/tags', '?q=belt')).toBe('/setup/tags?q=belt'));
test('ack links are untouched', () => expect(resolveLegacy('/ack/tok123', '')).toBeNull());
test('status page is untouched', () => expect(resolveLegacy('/status', '')).toBeNull());
test('a new path is not legacy', () => expect(resolveLegacy('/setup/tags', '')).toBeNull());
test('a prefix alone does not match a longer path', () => expect(resolveLegacy('/infrastructure/unknown/x', '')).toBeNull());
test('trailing slash still matches', () => expect(resolveLegacy('/oee/', '')).toBe('/production/oee'));
test('every source is unique', () => {
  const from = LEGACY.map(([f]) => f);
  expect(new Set(from).size).toBe(from.length);
});
test('no target is itself legacy (no redirect chains or loops)', () => {
  for (const [, to] of LEGACY) expect(resolveLegacy(to.replace(/:\w+/g, 'x'), '')).toBeNull();
});
