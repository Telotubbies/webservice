import { describe, expect, test } from 'bun:test';
import { chartPhase } from './chartMount';

describe('chartPhase', () => {
  test('loading wins over data', () => expect(chartPhase({ loading: true, hasData: true })).toBe('loading'));
  test('error before empty', () => expect(chartPhase({ error: true, hasData: false })).toBe('error'));
  test('plot when data and idle', () => expect(chartPhase({ hasData: true })).toBe('plot'));
  test('empty when idle without data', () => expect(chartPhase({ hasData: false })).toBe('empty'));
});
