import { expect, test } from 'bun:test';
import { tabNext } from './tabKeys';

test('arrows move one tab and wrap around the ends', () => {
  expect(tabNext('ArrowRight', 0, 3)).toBe(1);
  expect(tabNext('ArrowLeft', 1, 3)).toBe(0);
  expect(tabNext('ArrowRight', 2, 3)).toBe(0);
  expect(tabNext('ArrowLeft', 0, 3)).toBe(2);
});

test('Home and End jump to the first and last tab', () => {
  expect(tabNext('Home', 2, 3)).toBe(0);
  expect(tabNext('End', 0, 3)).toBe(2);
});

test('any other key leaves the tabs alone', () => {
  for (const key of ['Enter', ' ', 'Tab', 'Escape', 'ArrowDown']) expect(tabNext(key, 1, 3)).toBe(-1);
});

test('a single tab stays put, an empty list ignores every key', () => {
  expect(tabNext('ArrowRight', 0, 1)).toBe(0);
  expect(tabNext('Home', 0, 0)).toBe(-1);
});
