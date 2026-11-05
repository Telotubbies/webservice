import { expect, test } from 'bun:test';
import { paletteCommands, type PaletteCtx } from './paletteCommands';
import type { NavGroup } from './nav';
import type { Alarm } from '../types';

const NAV: NavGroup[] = [
  { cluster: 'plant', group: 'nav.alarms', icon: 'attention-circled', items: [{ to: '/alarms', key: 'nav.alarms', icon: 'attention-circled' }] },
  { cluster: 'admin', group: 'nav.admin', icon: 'lock', gated: true, items: [{ to: '/admin', key: 'nav.adminOrg', icon: 'organization' }] },
];
const calls: string[] = [];
const base: PaletteCtx = {
  nav: NAV, role: 'viewer', showAdmin: false, alarms: [],
  equipment: [{ id: '3', label: 'Cement silo 3', tags: ['site.batch.cem.silo3_level'] }],
  navigate: (to) => calls.push(`nav:${to}`), selectEquipment: (id) => calls.push(`sel:${id}`),
  ackVisible: () => calls.push('ack'), setTheme: (p) => calls.push(`theme:${p}`), t: (k) => k,
};
const unacked = { id: 1, state: 'active', severity: 'critical', tag: 'x', rule: 'r', ts: '' } as Alarm;

test('viewer cannot ack', () => expect(paletteCommands(base).find((c) => c.id === 'ack-visible')?.enabled).toBe(false));
test('operator can ack only when something is unacknowledged', () => {
  expect(paletteCommands({ ...base, role: 'operator' }).find((c) => c.id === 'ack-visible')?.enabled).toBe(false);
  expect(paletteCommands({ ...base, role: 'operator', alarms: [unacked] }).find((c) => c.id === 'ack-visible')?.enabled).toBe(true);
});
test('equipment gets open and trend', () =>
  expect(paletteCommands(base).filter((c) => c.group === 'equipment').map((c) => c.id)).toEqual(['open:Cement silo 3', 'trend:Cement silo 3']));
test('trend opens Trends on the equipment’s own signals', () => {
  calls.length = 0;
  paletteCommands(base).find((c) => c.id === 'trend:Cement silo 3')!.run();
  expect(calls).toEqual(['nav:/trends?tags=site.batch.cem.silo3_level']);
});
test('open narrows the console to the equipment, then shows the plant', () => {
  calls.length = 0;
  paletteCommands(base).find((c) => c.id === 'open:Cement silo 3')!.run();
  expect(calls).toEqual(['sel:3', 'nav:/']);
});
test('theme commands for all three choices', () =>
  expect(paletteCommands(base).filter((c) => c.id.startsWith('theme:')).map((c) => c.id)).toEqual(['theme:light', 'theme:dark', 'theme:system']));
test('gated nav groups stay hidden without admin rights', () =>
  expect(paletteCommands(base).some((c) => c.id === 'nav:/admin')).toBe(false));
