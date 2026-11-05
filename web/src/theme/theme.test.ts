import { describe, expect, test } from 'bun:test';
import { applyTheme, readThemePref, resolveTheme, writeThemePref } from './theme';

describe('resolveTheme', () => {
  test('system follows the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  test('explicit pref wins', () => expect(resolveTheme('light', true)).toBe('light'));
});

describe('readThemePref', () => {
  test('throwing storage falls back to system', () =>
    expect(readThemePref({ getItem: () => { throw new Error('denied'); } })).toBe('system'));
  test('garbage value falls back to system', () =>
    expect(readThemePref({ getItem: () => 'neon' })).toBe('system'));
  test('a stored choice is read back', () =>
    expect(readThemePref({ getItem: (k) => (k === 'wds.theme' ? 'dark' : null) })).toBe('dark'));
});

describe('writeThemePref', () => {
  test('a throwing storage is swallowed', () =>
    expect(() => writeThemePref('dark', { setItem: () => { throw new Error('quota'); } })).not.toThrow());
});

describe('applyTheme', () => {
  test('sets data-theme and color-scheme on the root', () => {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const doc = { documentElement: root } as unknown as Document;
    expect(applyTheme('dark', doc, false)).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(applyTheme('system', doc, false)).toBe('light');
  });
});
