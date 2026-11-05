import { describe, expect, test } from 'bun:test';
import { START_PATHS, autoOpenAllowed, pathFor } from './start';

describe('pathFor', () => {
  test('admins and owners start on workspace setup', () => {
    expect(pathFor('admin')).toBe('admin');
    expect(pathFor('owner')).toBe('admin');
  });
  test('everyone else starts by watching the plant', () => {
    for (const r of ['operator', 'viewer', 'custom', 'none']) expect(pathFor(r)).toBe('operator');
  });
});

describe('START_PATHS', () => {
  test('every path offers exactly three first pages, each unique', () => {
    for (const steps of Object.values(START_PATHS)) {
      expect(steps).toHaveLength(3);
      expect(new Set(steps.map((s) => s.to)).size).toBe(3);
    }
  });
});

describe('autoOpenAllowed', () => {
  test('never pops over the unattended wall display or the guide', () => {
    expect(autoOpenAllowed('/wall')).toBe(false);
    expect(autoOpenAllowed('/guide')).toBe(false);
    expect(autoOpenAllowed('/')).toBe(true);
    expect(autoOpenAllowed('/overview')).toBe(true);
  });
});
