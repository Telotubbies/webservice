import { expect, test } from 'bun:test';
import { commandKind } from './commandKind';

test('the F05 aliases map onto the v6 chip types', () => {
  expect(commandKind('START')).toBe('home');
  expect(commandKind('HOME')).toBe('home');
  expect(commandKind('MOVE')).toBe('move');
  expect(commandKind('SET OUT')).toBe('set');
  expect(commandKind('setpoint')).toBe('set');
  expect(commandKind('OPEN')).toBe('set');
  expect(commandKind('WAIT')).toBe('wait');
  expect(commandKind('LOOP')).toBe('loop');
  expect(commandKind('END')).toBe('end');
});

test('a command with no type of its own reads as other, never as a status', () => {
  expect(commandKind('STOP')).toBe('other');
  expect(commandKind('abort')).toBe('other');
  expect(commandKind('')).toBe('other');
});

test('matching ignores case and surrounding space', () => {
  expect(commandKind('  move ')).toBe('move');
});
