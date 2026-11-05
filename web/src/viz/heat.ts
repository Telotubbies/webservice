// HeatStrip maths, pure: event times into equal bins over [from, to), and a
// count onto a 1..steps sequential ramp (0 stays empty — an empty bin must
// look empty, not "low").

export function binCounts(ts: number[], from: number, to: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  const w = (to - from) / bins;
  if (!(w > 0)) return out;
  for (const t of ts) {
    if (t < from || t >= to) continue;
    out[Math.min(bins - 1, Math.floor((t - from) / w))]++;
  }
  return out;
}

export function rampStep(count: number, max: number, steps = 5): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(steps, Math.ceil((count / max) * steps)));
}
