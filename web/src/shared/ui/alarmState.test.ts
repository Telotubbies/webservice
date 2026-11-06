import { describe, expect, test } from 'bun:test';
import { normAlarmState } from './Status';

describe('normAlarmState', () => {
  test('rtn_unack is its own state, not Active', () => {
    expect(normAlarmState('rtn_unack')).toBe('rtn_unack');
    expect(normAlarmState('active')).toBe('active');
    expect(normAlarmState('acked')).toBe('acked');
    expect(normAlarmState('cleared')).toBe('cleared');
  });
});
