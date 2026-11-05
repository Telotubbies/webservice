// Floating placement — where a popover/menu/tooltip goes relative to its
// anchor. Pure: flips to the opposite side when the preferred one overflows
// (and the opposite fits), then clamps 8 px inside the viewport.

export type Rect = { x: number; y: number; w: number; h: number };
export type Side = 'top' | 'bottom' | 'left' | 'right';

const EDGE = 8;
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function at(a: Rect, f: { w: number; h: number }, side: Side, gap: number) {
  switch (side) {
    case 'bottom': return { x: a.x + a.w / 2 - f.w / 2, y: a.y + a.h + gap };
    case 'top': return { x: a.x + a.w / 2 - f.w / 2, y: a.y - gap - f.h };
    case 'right': return { x: a.x + a.w + gap, y: a.y + a.h / 2 - f.h / 2 };
    case 'left': return { x: a.x - gap - f.w, y: a.y + a.h / 2 - f.h / 2 };
  }
}

function overflows(p: { x: number; y: number }, f: { w: number; h: number }, vp: { w: number; h: number }, side: Side): boolean {
  if (side === 'bottom') return p.y + f.h > vp.h - EDGE;
  if (side === 'top') return p.y < EDGE;
  if (side === 'right') return p.x + f.w > vp.w - EDGE;
  return p.x < EDGE;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function placeFloating(
  anchor: Rect, float: { w: number; h: number }, viewport: { w: number; h: number }, side: Side, gap = 6,
): { x: number; y: number; side: Side } {
  let s = side;
  let p = at(anchor, float, s, gap);
  if (overflows(p, float, viewport, s)) {
    const alt = at(anchor, float, OPPOSITE[s], gap);
    if (!overflows(alt, float, viewport, OPPOSITE[s])) { s = OPPOSITE[s]; p = alt; }
  }
  return {
    x: clamp(p.x, EDGE, Math.max(EDGE, viewport.w - float.w - EDGE)),
    y: clamp(p.y, EDGE, Math.max(EDGE, viewport.h - float.h - EDGE)),
    side: s,
  };
}
