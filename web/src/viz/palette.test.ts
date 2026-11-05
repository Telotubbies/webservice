import { expect, test } from 'bun:test';
import { SERIES, assignSeriesColors, chartTheme, chartThemeKey } from './palette';

test('palette constants are the validated ones', () => {
  expect(SERIES.light).toEqual(['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#9b4fc4']);
  expect(SERIES.dark).toEqual(['#3987e5', '#d55181', '#9085e9', '#13a0a0', '#b06fd8']);
});
test('existing keys keep their slot', () => {
  const prior = new Map([['b', 1], ['c', 2]]);
  expect([...assignSeriesColors(['c', 'a', 'b'], prior)]).toEqual([['c', 2], ['a', 0], ['b', 1]]);
});
test('a hidden-then-restored series gets its old slot back', () => {
  const first = assignSeriesColors(['a', 'b', 'c'], new Map());
  const without = assignSeriesColors(['a', 'c'], first);
  expect(assignSeriesColors(['a', 'b', 'c'], new Map([...first, ...without])).get('b')).toBe(first.get('b'));
});
test('sixth series gets no colour', () =>
  expect(assignSeriesColors(['a', 'b', 'c', 'd', 'e', 'f'], new Map()).get('f')).toBe(-1));
test('theme key changes with theme', () => {
  const css = (n: string) => n;
  expect(chartThemeKey(chartTheme('light', css))).not.toBe(chartThemeKey(chartTheme('dark', css)));
});
test('chart theme reads the tokens', () => {
  const t = chartTheme('dark', (n) => `v(${n})`);
  expect(t.grid).toBe('v(--color-line)');
  expect(t.crit).toBe('v(--color-crit)');
  expect(t.series).toEqual(SERIES.dark);
});
