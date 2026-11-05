import { expect, test } from 'bun:test';
import { rendererFor, RETIRED_KINDS } from './renderers';
import { ALL_VIZ_KINDS } from './model';

test('retired forms map to honest ones', () => {
  expect(rendererFor('gauge')).toBe('meter');
  expect(rendererFor('bargauge')).toBe('bullet');
  expect(rendererFor('pie')).toBe('barlist');
  expect(rendererFor('treemap')).toBe('barlist');
  expect(rendererFor('toplist')).toBe('barlist');
  expect(rendererFor('stateline')).toBe('state');
  expect(rendererFor('value')).toBe('stat');
});
test('every VizKind has a renderer', () => {
  for (const k of ALL_VIZ_KINDS) expect(rendererFor(k)).toBeTruthy();
});
test('retired kinds are exactly the ones the editor stops offering', () =>
  expect([...RETIRED_KINDS].sort()).toEqual(['gauge', 'pie', 'treemap']));
