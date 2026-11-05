import { expect, test } from 'bun:test';
import { pickLabels } from './planLabels';

const c = (key: string, cx: number, top: number, area: number, selected = false) =>
  ({ key, text: 'Drum emptier', area, selected, cx, top });

test('overlapping labels: the larger part keeps its label', () => {
  const got = pickLabels([c('small', 50, 100, 4), c('big', 52, 101, 40)], 10);
  expect([...got]).toEqual(['big']);
});

test('the selected part always keeps its label', () => {
  const got = pickLabels([c('big', 50, 100, 40), c('sel', 52, 101, 4, true)], 10);
  expect(got.has('sel')).toBe(true);
  expect(got.has('big')).toBe(false);
});

test('labels that do not touch are all kept', () => {
  const got = pickLabels([c('a', 0, 100, 4), c('b', 500, 100, 4), c('c', 0, 400, 4)], 10);
  expect(got.size).toBe(3);
});
