// Label culling for the 2D plant plan — pure, so it is unit-tested.

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Which labels to draw: the selected part first, then larger parts, each kept
 *  only if its label box clears every label already kept — clustered small
 *  parts (drum emptiers, weigh hopper…) no longer print on top of each other.
 *  shortcut: label width is estimated from character count (~0.56em), fine
 *  for Plex Sans labels; measure with getBBox if labels get mixed scripts. */
export function pickLabels(cands: { key: string; text: string; area: number; selected: boolean; cx: number; top: number }[], size: number): Set<string> {
  const kept: Box[] = [];
  const out = new Set<string>();
  const order = [...cands].sort((a, b) => Number(b.selected) - Number(a.selected) || b.area - a.area);
  for (const c of order) {
    const half = (c.text.length * size * 0.56) / 2;
    const box = { x0: c.cx - half, x1: c.cx + half, y0: c.top - size * 1.3, y1: c.top };
    if (!c.selected && kept.some((k) => overlaps(k, box))) continue;
    kept.push(box);
    out.add(c.key);
  }
  return out;
}
