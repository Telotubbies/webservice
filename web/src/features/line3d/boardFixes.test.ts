import { describe, expect, test } from 'bun:test';
import { setScope } from '../../lib/scope';
import { capKey } from './boardApi';
import { partVisible } from './boardLayout';

describe('F07 review fixes', () => {
  test('capture cache key differs per org and site for the same model sha', () => {
    setScope({ orgId: 'o1', siteId: 's1', orgName: 'A', role: 'admin' });
    const a = capKey('sha');
    setScope({ orgId: 'o2', siteId: 's1', orgName: 'B', role: 'admin' });
    const b = capKey('sha');
    setScope({ orgId: 'o2', siteId: 's2', orgName: 'B', role: 'admin' });
    expect(new Set([a, b, capKey('sha')]).size).toBe(3);
  });
  test('a hidden part stays visible while it is in alarm', () => {
    expect(partVisible(true, false, null)).toBe(false);
    expect(partVisible(true, false, 'warning')).toBe(true);
    expect(partVisible(true, true, null)).toBe(true);
    expect(partVisible(false, false, null)).toBe(true);
  });
});
