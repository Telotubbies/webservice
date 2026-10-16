// Pure canvas helpers for the model-test overlay (plan M1-05 T5).
// Coordinates are normalized [0..1] against the image's natural size.

import type { Detection } from './api';

export function visibleDetections(dets: Detection[], threshold: number): Detection[] {
  return dets.filter((d) => Number.isFinite(d.score) && d.score >= threshold);
}

/** normalized [x,y,w,h] -> CSS-space rect within a `width`x`height` box. */
export function bboxRect(bbox: [number, number, number, number], width: number, height: number) {
  const [x, y, w, h] = bbox;
  return { x: x * width, y: y * height, width: w * width, height: h * height };
}

/** normalized polygon -> CSS-space points within a `width`x`height` box. */
export function polygonPoints(poly: [number, number][], width: number, height: number): [number, number][] {
  return poly.map(([x, y]) => [x * width, y * height]);
}
