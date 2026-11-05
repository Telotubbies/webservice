import { expect, test } from 'bun:test';
import {
  defaultHome, duplicatePanel, findPanel, legendClick, loadHome, movePanel, P, removePanel, resizePanel,
  saveHome, shiftPanel, toggleSource, type Section,
} from './model';

const ids = (l: Section[], gid: string) => l.flatMap((s) => s.groups).find((g) => g.id === gid)!.panels.map((p) => p.id);

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test('dropping a panel on another inserts it before that panel', () => {
  const l = movePanel(defaultHome(), 'alarms', 'output', null);
  expect(ids(l, 'g-prod')).toEqual(['alarms', 'output']);
});

test('dropping on a group appends the panel to it, across sections', () => {
  const l = movePanel(defaultHome(), 'output', null, 'g-alarms');
  expect(ids(l, 'g-prod')).toEqual(['alarms']);
  expect(ids(l, 'g-alarms').at(-1)).toBe('output');
});

test('moving earlier at the start does nothing', () => {
  const l = defaultHome();
  expect(ids(shiftPanel(l, 'output', -1), 'g-prod')).toEqual(ids(l, 'g-prod'));
  expect(ids(shiftPanel(l, 'output', 1), 'g-prod')).toEqual(['alarms', 'output']);
});

test('resize steps through the allowed widths and stops at the ends', () => {
  let l = defaultHome();
  l = resizePanel(l, 'output', 1);
  expect(findPanel(l, 'output')!.cols).toBe(8);
  l = resizePanel(resizePanel(resizePanel(l, 'output', 1), 'output', 1), 'output', 1);
  expect(findPanel(l, 'output')!.cols).toBe(12);
});

test('duplicate lands right after the original with a new id', () => {
  const l = duplicatePanel(defaultHome(), 'output', 'copy1');
  expect(ids(l, 'g-prod')).toEqual(['output', 'copy1', 'alarms']);
  expect(findPanel(l, 'copy1')!.series).toEqual(findPanel(l, 'output')!.series);
});

test('remove takes the panel out', () => {
  expect(findPanel(removePanel(defaultHome(), 'output'), 'output')).toBeNull();
});

test('a new signal takes the first free colour slot; removing one keeps the others', () => {
  const unit = () => 'm/s';
  let p = P({ id: 'x', series: [{ src: 'tag:a', color: 's0' }, { src: 'tag:b', color: 's2' }] });
  p = { ...p, ...toggleSource(p, 'tag:c', unit) };
  expect(p.series.map((s) => s.color)).toEqual(['s0', 's2', 's1']);
  p = { ...p, ...toggleSource(p, 'tag:a', unit) };
  expect(p.series.map((s) => [s.src, s.color])).toEqual([['tag:b', 's2'], ['tag:c', 's1']]);
});

test('a big number holds one signal; picking another replaces it and keeps the colour', () => {
  const p = P({ id: 'x', viz: 'stat', series: [{ src: 'tag:a', color: 's3' }] });
  expect(toggleSource(p, 'tag:b', () => '%').series).toEqual([{ src: 'tag:b', color: 's3' }]);
});

test('legend click isolates; clicking the isolated one again shows all; ctrl toggles one', () => {
  const p = P({ id: 'x', series: [{ src: 'a', color: 's0' }, { src: 'b', color: 's1' }, { src: 'c', color: 's2' }] });
  const once = { ...p, ...legendClick(p, 'b', false) };
  expect(once.series.map((s) => !!s.hidden)).toEqual([true, false, true]);
  expect({ ...once, ...legendClick(once, 'b', false) }.series.every((s) => !s.hidden)).toBe(true);
  expect(legendClick(p, 'c', true).series.map((s) => !!s.hidden)).toEqual([false, false, true]);
});

test('saved layout round-trips per org', () => {
  const st = memStore();
  const l = removePanel(defaultHome(), 'output');
  saveHome(st, 'org1', { layout: l, theme: 'dark' });
  expect(loadHome(st, 'org1').theme).toBe('dark');
  expect(findPanel(loadHome(st, 'org1').layout, 'output')).toBeNull();
  expect(findPanel(loadHome(st, 'org2').layout, 'output')).not.toBeNull();
});

test('corrupt or blocked storage falls back to the default home', () => {
  expect(findPanel(loadHome(memStore({ 'wds.home.v2:o': '{nope' }), 'o').layout, 'output')).not.toBeNull();
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  expect(loadHome(blocked, 'o').theme).toBe('light');
  expect(saveHome(blocked, 'o', { layout: defaultHome(), theme: 'light' })).toBe(false);
});

test('the default home reads only concrete-plant sources', () => {
  const srcs = defaultHome().flatMap((s) => s.groups).flatMap((g) => g.panels).flatMap((p) => p.series.map((x) => x.src));
  expect(srcs.length).toBeGreaterThan(10);
  for (const s of srcs) expect(s).toMatch(/^(tag:plant1\.batch\.|delta:plant1\.batch\.|alarms:)/);
});

test('every built-in panel has a unique id', () => {
  const ids = defaultHome().flatMap((s) => s.groups).flatMap((g) => g.panels).map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
});
