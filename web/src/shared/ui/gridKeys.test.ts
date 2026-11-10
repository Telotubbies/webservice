import { expect, test } from 'bun:test';
import { gridKey } from './gridKeys';

const base = { index: 1, count: 4, editing: false };

test('arrow keys move one row and stop at the edges', () => {
  expect(gridKey('ArrowDown', base)).toEqual({ type: 'select', index: 2 });
  expect(gridKey('ArrowUp', base)).toEqual({ type: 'select', index: 0 });
  expect(gridKey('ArrowDown', { ...base, index: 3 })).toEqual({ type: 'select', index: 3 });
  expect(gridKey('ArrowUp', { ...base, index: 0 })).toEqual({ type: 'select', index: 0 });
});

test('Home and End jump to the first and last row', () => {
  expect(gridKey('Home', base)).toEqual({ type: 'select', index: 0 });
  expect(gridKey('End', base)).toEqual({ type: 'select', index: 3 });
});

test('Enter opens the inspector row', () => expect(gridKey('Enter', base)).toEqual({ type: 'open' }));

test('Esc cancels an inline edit, and does nothing outside one', () => {
  expect(gridKey('Escape', { ...base, editing: true })).toEqual({ type: 'cancel' });
  expect(gridKey('Escape', base)).toEqual({ type: 'none' });
});

test('while a cell is being edited the arrows and Enter belong to the input', () => {
  const editing = { ...base, editing: true };
  expect(gridKey('ArrowDown', editing)).toEqual({ type: 'none' });
  expect(gridKey('Enter', editing)).toEqual({ type: 'none' });
});

test('an empty grid ignores every key', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape']) {
    expect(gridKey(key, { index: 0, count: 0, editing: false })).toEqual({ type: 'none' });
  }
});
