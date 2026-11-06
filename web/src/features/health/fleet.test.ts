import { expect, test } from 'bun:test';
import { edgeState } from './fleet';

test('a gateway with no heartbeat is "never", whatever its inventory status says', () => {
  expect(edgeState({ status: 'active', lastHb: null }, Date.now())).toBe('never');
});

test('heartbeat age picks online, stale, offline', () => {
  const now = Date.now();
  const at = (s: number) => new Date(now - s * 1000).toISOString();
  expect(edgeState({ status: 'active', lastHb: at(5) }, now)).toBe('online');
  expect(edgeState({ status: 'active', lastHb: at(60) }, now)).toBe('stale');
  expect(edgeState({ status: 'active', lastHb: at(600) }, now)).toBe('offline');
});
