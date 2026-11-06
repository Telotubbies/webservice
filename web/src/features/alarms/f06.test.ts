import { describe, expect, test } from 'bun:test';
import { isShelved, matchAlarmQuery, needsAck, sortAlarms } from './alarms';
import { bucketAlarms, peakPer10Min } from './AlarmDensity';
import type { Alarm } from '../../types';

const al = (id: number, state: string, over: Partial<Alarm> = {}): Alarm => ({
  id, tag: 't', rule: `r${id}`, severity: 'warning', state, ts: new Date(1_000_000 + id).toISOString(), ...over,
});

describe('returned-to-normal-unacknowledged', () => {
  test('needs an ack like an active alarm, but a cleared or acked one does not', () => {
    expect(needsAck(al(1, 'active'))).toBe(true);
    expect(needsAck(al(2, 'rtn_unack'))).toBe(true);
    expect(needsAck(al(3, 'acked'))).toBe(false);
    expect(needsAck(al(4, 'cleared'))).toBe(false);
  });

  test('sorts after active and before acknowledged', () => {
    const order = sortAlarms([al(1, 'cleared'), al(2, 'acked'), al(3, 'rtn_unack'), al(4, 'active')]).map((a) => a.state);
    expect(order).toEqual(['active', 'rtn_unack', 'acked', 'cleared']);
  });

  test('state:rtn finds it', () => {
    expect(matchAlarmQuery(al(1, 'rtn_unack'), 'state:rtn', () => '')).toBe(true);
    expect(matchAlarmQuery(al(1, 'active'), 'state:rtn', () => '')).toBe(false);
  });
});

describe('shelf', () => {
  test('a shelf in the past is not a shelf', () => {
    expect(isShelved({ shelved_until: new Date(2000).toISOString() }, 1000)).toBe(true);
    expect(isShelved({ shelved_until: new Date(500).toISOString() }, 1000)).toBe(false);
    expect(isShelved({ shelved_until: null }, 1000)).toBe(false);
  });
});

describe('flood readout', () => {
  const now = 10 * 3600_000;
  test('peak is the busiest two neighbouring 5-minute buckets', () => {
    const at = (minAgo: number) => al(Math.round(minAgo * 10), 'active', { ts: new Date(now - minAgo * 60_000).toISOString() });
    const list = [...Array(6).fill(0).map((_, i) => at(12 + i * 0.1)), ...Array(5).fill(0).map((_, i) => at(8 + i * 0.1)), at(100)];
    expect(peakPer10Min(bucketAlarms(list, now))).toBe(11);
  });
  test('a quiet window peaks at zero', () => {
    expect(peakPer10Min(bucketAlarms([], now))).toBe(0);
  });
});
