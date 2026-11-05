import { expect, test } from 'bun:test';
import { equipmentKey, gatewayLinks, splitGateways } from './mapModel';

test('disabled and never-connected edges are parked', () => {
  const r = splitGateways([
    { id: 'a', status: 'active', last_hb_at: '2026-10-20T00:00:00Z' },
    { id: 'b', status: 'disabled', last_hb_at: null },
    { id: 'c', status: 'active', last_hb_at: null },
  ]);
  expect(r.active.map((e) => e.id)).toEqual(['a']);
  expect(r.parked.map((e) => e.id)).toEqual(['b', 'c']);
});

test('equipment is the tag path minus its signal', () => {
  expect(equipmentKey('batch.mixer.motor.current')).toBe('batch.mixer.motor');
  expect(equipmentKey('solo')).toBe('solo');
});

test('UNS slash paths group by device too', () => {
  expect(equipmentKey('batch/agg/belt1/running')).toBe('batch/agg/belt1');
  expect(equipmentKey('batch/agg/belt1/speed_mps')).toBe('batch/agg/belt1');
});

test('a gateway links only to equipment its own sources read', () => {
  const links = gatewayLinks(new Map([
    ['gw1', ['batch.mixer.motor.current', 'batch.mixer.motor.run']],
    ['gw2', ['sort.belt.speed']],
  ]));
  expect([...links].sort()).toEqual(['gw1|batch.mixer.motor', 'gw2|sort.belt']);
});
