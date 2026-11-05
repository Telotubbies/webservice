import { expect, test } from 'bun:test';
import { clampStep, filterOptions, parseNumberField } from './fields';

test('blank is empty, not zero', () => expect(parseNumberField('  ', {})).toEqual({ ok: false, reason: 'empty' }));
test('range enforced', () => expect(parseNumberField('61', { max: 60 })).toEqual({ ok: false, reason: 'max' }));
test('below min', () => expect(parseNumberField('-1', { min: 0 })).toEqual({ ok: false, reason: 'min' }));
test('accepts decimals', () => expect(parseNumberField('45.5', { min: 0, max: 60 })).toEqual({ ok: true, value: 45.5 }));
test('spaces inside are dropped', () => expect(parseNumberField(' 1 200 ', {})).toEqual({ ok: true, value: 1200 }));
test('letters are not a number', () => expect(parseNumberField('12a', {})).toEqual({ ok: false, reason: 'nan' }));
test('step snaps and clamps', () => expect(clampStep(7.3, 0.5, 0, 7)).toBe(7));
test('step snaps without float noise', () => expect(clampStep(0.30000000000000004, 0.1)).toBe(0.3));
test('combobox filter is case-insensitive', () =>
  expect(filterOptions([{ value: 'a', label: 'Cement Silo 3' }], 'silo', 'en')).toHaveLength(1));
test('combobox filter keeps Thai tone marks intact', () =>
  expect(filterOptions([{ value: 'a', label: 'ไซโลปูน 3' }, { value: 'b', label: 'สายพาน' }], 'ปูน', 'th').map((o) => o.value)).toEqual(['a']));
test('hint text is searched too', () =>
  expect(filterOptions([{ value: 'a', label: 'Belt 1', hint: 'agg/belt1' }], 'agg/', 'en')).toHaveLength(1));
