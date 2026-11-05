import { expect, test } from 'bun:test';
import { summarizeAlarms } from './alarmSummary';

const NOW = Date.parse('2026-10-20T12:00:00Z');

test('cleared and shelved are not counted', () =>
  expect(summarizeAlarms([
    { state: 'active', severity: 'critical' },
    { state: 'cleared', severity: 'critical' },
    { state: 'active', severity: 'warning', shelved_until: '2026-10-20T13:00:00Z' },
    { state: 'acked', severity: 'warning', acked_at: '2026-10-20T11:00:00Z' },
  ], NOW)).toEqual({ critical: 1, warning: 1, info: 0, unacked: 1 }));

test('an expired shelf counts again', () =>
  expect(summarizeAlarms([{ state: 'active', severity: 'critical', shelved_until: '2026-10-20T11:00:00Z' }], NOW).critical).toBe(1));

test('severity aliases go through normSeverity', () =>
  expect(summarizeAlarms([{ state: 'active', severity: 'hihi' }, { state: 'active', severity: 'high' }], NOW).critical).toBeGreaterThanOrEqual(1));

test('nothing open is all zero', () =>
  expect(summarizeAlarms([], NOW)).toEqual({ critical: 0, warning: 0, info: 0, unacked: 0 }));
