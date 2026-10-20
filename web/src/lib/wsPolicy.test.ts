// bun tests for the reconnect policy (ADR-0003).

import { expect, test } from 'bun:test';
import {
  BACKOFF_MAX_MS, ResyncBuffer, RESYNC_BUF_CAP, backoffMs, closeAction, emptySnapshot,
  supersededBySnapshot,
} from './wsPolicy';
import type { WSEvent } from '../types';

test('closeAction: 4401 renews, 4403 is terminal, the rest retry', () => {
  expect(closeAction(4401)).toBe('renew');
  expect(closeAction(4403)).toBe('forbidden');
  for (const c of [1000, 1001, 1006, 1011, 1012, 1013]) expect(closeAction(c)).toBe('retry');
});

test('backoffMs: grows, is capped, stays inside the jitter band', () => {
  expect(backoffMs(0, () => 0.5)).toBe(500);
  expect(backoffMs(1, () => 0.5)).toBe(1000);
  expect(backoffMs(30, () => 0.5)).toBe(BACKOFF_MAX_MS);
  expect(backoffMs(0, () => 0)).toBe(375);
  expect(backoffMs(0, () => 1)).toBe(625);
});

test('tag events older than the snapshot are dropped, newer replayed', () => {
  const snap = emptySnapshot();
  snap.tags.set('a', Date.parse('2026-01-01T00:00:10Z'));
  const old: WSEvent = { type: 'tag', name: 'a', v: 1, q: 'good', ts: '2026-01-01T00:00:05Z' };
  const fresh: WSEvent = { type: 'tag', name: 'a', v: 2, q: 'good', ts: '2026-01-01T00:00:11Z' };
  const other: WSEvent = { type: 'tag', name: 'b', v: 2, q: 'good', ts: '2026-01-01T00:00:01Z' };
  expect(supersededBySnapshot(old, snap)).toBe(true);
  expect(supersededBySnapshot(fresh, snap)).toBe(false);
  expect(supersededBySnapshot(other, snap)).toBe(false);
});

test('alarm events with an older version than the snapshot are dropped', () => {
  const snap = emptySnapshot();
  snap.alarms.set('7', { id: 7, tag: 't', rule: 'r', severity: 'warning', state: 'cleared', ts: 'x', version: 3 });
  const stale = { type: 'alarm_update', id: 7, state: 'active', version: 2 } as WSEvent;
  const next = { type: 'alarm_update', id: 7, state: 'acked', version: 4 } as WSEvent;
  const unversioned = { type: 'alarm_update', id: 7, state: 'active' } as WSEvent;
  expect(supersededBySnapshot(stale, snap)).toBe(true);
  expect(supersededBySnapshot(next, snap)).toBe(false);
  expect(supersededBySnapshot(unversioned, snap)).toBe(false);
});

test('a non-terminal command event never regresses a terminal snapshot row', () => {
  const snap = emptySnapshot();
  snap.commands.set('c1', { id: 'c1', tag: 't', status: 'done' });
  expect(supersededBySnapshot({ type: 'command', command_id: 'c1', status: 'sent' }, snap)).toBe(true);
  expect(supersededBySnapshot({ type: 'command', command_id: 'c1', status: 'done' }, snap)).toBe(false);
  expect(supersededBySnapshot({ type: 'command', command_id: 'c2', status: 'sent' }, snap)).toBe(false);
});

test('ResyncBuffer: drain filters superseded events in order and empties', () => {
  const snap = emptySnapshot();
  snap.tags.set('a', 100);
  const b = new ResyncBuffer();
  b.push({ type: 'tag', name: 'a', v: 1, q: 'good', ts: new Date(50).toISOString() });
  b.push({ type: 'tag', name: 'a', v: 2, q: 'good', ts: new Date(150).toISOString() });
  b.push({ type: 'health', mqtt: 'up', edge: 'up' });
  const out = b.drain(snap);
  expect(out.map((e) => e.type)).toEqual(['tag', 'health']);
  expect((out[0] as { v: number }).v).toBe(2);
  expect(b.size).toBe(0);
});

test('ResyncBuffer: bounded, keeps the newest', () => {
  const b = new ResyncBuffer();
  for (let i = 0; i < RESYNC_BUF_CAP + 10; i++) {
    b.push({ type: 'tag', name: 'a', v: i, q: 'good', ts: new Date(i).toISOString() });
  }
  expect(b.size).toBe(RESYNC_BUF_CAP);
  const out = b.drain(emptySnapshot());
  expect((out[0] as { v: number }).v).toBe(10);
});
