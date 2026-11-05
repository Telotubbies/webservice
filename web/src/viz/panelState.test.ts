import { expect, test } from 'bun:test';
import { panelState } from './panelState';

const base = { loading: false, error: false, empty: false, stale: false, hasPrevious: false };
test('first load is a skeleton', () => expect(panelState({ ...base, loading: true })).toBe('skeleton'));
test('refetch keeps the old render', () => expect(panelState({ ...base, loading: true, hasPrevious: true })).toBe('refetch'));
test('error beats empty', () => expect(panelState({ ...base, error: true, empty: true })).toBe('error'));
test('stale data is labelled', () => expect(panelState({ ...base, stale: true })).toBe('stale'));
test('empty window', () => expect(panelState({ ...base, empty: true })).toBe('empty'));
test('ready otherwise', () => expect(panelState(base)).toBe('ready'));
test('an error during refetch still shows the error', () =>
  expect(panelState({ ...base, loading: true, hasPrevious: true, error: true })).toBe('error'));
