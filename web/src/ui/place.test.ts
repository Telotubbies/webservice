import { expect, test } from 'bun:test';
import { placeFloating } from './place';

const vp = { w: 1000, h: 800 };
test('bottom by default', () =>
  expect(placeFloating({ x: 100, y: 100, w: 40, h: 20 }, { w: 120, h: 60 }, vp, 'bottom')).toEqual({ x: 60, y: 126, side: 'bottom' }));
test('flips to top near the bottom edge', () =>
  expect(placeFloating({ x: 100, y: 760, w: 40, h: 20 }, { w: 120, h: 60 }, vp, 'bottom').side).toBe('top'));
test('clamps inside the viewport', () =>
  expect(placeFloating({ x: 990, y: 100, w: 10, h: 20 }, { w: 120, h: 60 }, vp, 'bottom').x).toBe(872));
test('right flips to left at the right edge', () =>
  expect(placeFloating({ x: 950, y: 100, w: 40, h: 20 }, { w: 120, h: 60 }, vp, 'right').side).toBe('left'));
test('stays put when neither side fits', () =>
  expect(placeFloating({ x: 100, y: 20, w: 40, h: 760 }, { w: 120, h: 60 }, vp, 'bottom').side).toBe('bottom'));
