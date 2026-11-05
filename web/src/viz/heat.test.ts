import { expect, test } from 'bun:test';
import { binCounts, rampStep } from './heat';

test('counts land in bins', () => expect(binCounts([0, 5, 99], 0, 100, 2)).toEqual([2, 1]));
test('outside the window is ignored', () => expect(binCounts([-1, 100, 50], 0, 100, 2)).toEqual([0, 1]));
test('zero stays empty', () => expect(rampStep(0, 10)).toBe(0));
test('max is the darkest step', () => expect(rampStep(10, 10)).toBe(5));
test('one alarm is at least the lightest step', () => expect(rampStep(1, 100)).toBe(1));
