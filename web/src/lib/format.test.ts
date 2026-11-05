import { expect, test } from 'bun:test';

// format.ts pulls in the i18n runtime, which reads browser globals at import.
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage ??= { getItem: () => 'en', setItem: () => {} };
g.document ??= { documentElement: {} };
g.navigator ??= { language: 'en' };
const { fmtAge, fmtDateTime } = await import('./format');

const now = Date.parse('2026-10-26T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

test('fmtAge steps from hours to days after 48 h', () => {
  expect(fmtAge(ago(47 * 3600_000), now)).toContain('47');
  expect(fmtAge(ago(150 * 24 * 3600_000), now)).toContain('150');
  expect(fmtAge(ago(150 * 24 * 3600_000), now)).not.toContain('3600');
});

test('fmtDateTime uses a 24-hour clock', () => {
  expect(fmtDateTime('2026-10-25T16:38:00Z')).not.toMatch(/AM|PM/);
});
