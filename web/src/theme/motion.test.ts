import { expect, test } from 'bun:test';
import { DUR, beyondDeadband, exitOf, readMotionPref, writeMotionPref } from './motion';

test('tiny wiggle stays inside the deadband', () => expect(beyondDeadband(50, 50.3, 100)).toBe(false));
test('a real change leaves it', () => expect(beyondDeadband(50, 51, 100)).toBe(true));
test('first value always counts', () => expect(beyondDeadband(null, 3, 100)).toBe(true));
test('zero span never divides by zero', () => expect(beyondDeadband(1, 2, 0)).toBe(true));
test('exit is faster than enter', () => expect(exitOf(DUR.base)).toBeCloseTo(0.154, 3));
test('bad motion pref falls back to full', () => expect(readMotionPref({ getItem: () => 'wild' })).toBe('full'));
test('throwing storage falls back to full', () =>
  expect(readMotionPref({ getItem: () => { throw new Error('denied'); } })).toBe('full'));
test('calm is read back', () => expect(readMotionPref({ getItem: () => 'calm' })).toBe('calm'));
test('a throwing write is swallowed', () =>
  expect(() => writeMotionPref('calm', { setItem: () => { throw new Error('quota'); } })).not.toThrow());
