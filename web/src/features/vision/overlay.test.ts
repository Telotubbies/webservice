// Pure overlay helpers — threshold semantics + normalized->pixel mapping.

import { describe, expect, test } from 'bun:test';
import { bboxRect, polygonPoints, visibleDetections } from './overlay';
import type { Detection } from './api';

const det = (score: number, extra: Partial<Detection> = {}): Detection => ({
  class_id: 0, class: 'person', score, bbox: [0.1, 0.2, 0.3, 0.4], ...extra,
});

describe('visibleDetections', () => {
  test('threshold is inclusive', () => {
    const dets = [det(0.24), det(0.25), det(0.9)];
    expect(visibleDetections(dets, 0.25).map((d) => d.score)).toEqual([0.25, 0.9]);
  });
  test('non-finite scores removed, input untouched', () => {
    const dets = [det(NaN), det(0.5)];
    expect(visibleDetections(dets, 0.05)).toHaveLength(1);
    expect(dets).toHaveLength(2);                       // no mutation
  });
});

describe('bboxRect', () => {
  test('normalized -> pixel space of the natural image', () => {
    const r = bboxRect([0.1, 0.2, 0.3, 0.4], 1000, 500);
    expect(r).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });
});

describe('polygonPoints', () => {
  test('scales each vertex, returns a new array', () => {
    const poly: [number, number][] = [[0.5, 0.1], [0.9, 0.9], [0.1, 0.9]];
    const pts = polygonPoints(poly, 1000, 500);
    expect(pts).toEqual([[500, 50], [900, 450], [100, 450]]);
    expect(pts).not.toBe(poly);                         // input immutable
  });
});
