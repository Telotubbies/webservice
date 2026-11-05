import { describe, expect, test } from 'bun:test';
import { NAV, activeGroup } from './nav';

describe('activeGroup', () => {
  test('longest matching route wins', () => {
    expect(activeGroup('/')).toBe('nav.plantTwin');
    expect(activeGroup('/overview')).toBe('nav.overview');
    expect(activeGroup('/live')).toBe('nav.live');
    expect(activeGroup('/setup/model')).toBe('nav.plantSetup');
    expect(activeGroup('/alarms/quality')).toBe('nav.alarms');
    expect(activeGroup('/vision/cameras')).toBe('nav.vision');
    expect(activeGroup('/connect/gateways/e1')).toBe('nav.connectivity');
    expect(activeGroup('/setup/rules/new')).toBe('nav.plantSetup');
    expect(activeGroup('/admin/users')).toBe('nav.admin');
  });

  test('matches on segment boundaries only', () => {
    expect(activeGroup('/alarmsx')).toBeNull();
    expect(activeGroup('/nowhere')).toBeNull();
  });
});

test('every route belongs to exactly one rail group', () => {
  const owner = new Map<string, string>();
  for (const g of NAV) {
    for (const i of g.items) {
      expect(owner.get(i.to) ?? g.group).toBe(g.group);
      owner.set(i.to, g.group);
    }
  }
});
