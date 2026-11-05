// BulletBar geometry, pure: value, target and qualitative bands as 0–100 %
// of the scale (clamped, so an over-target value pins to the end).

const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export function bulletScale(o: { value: number; target?: number; max: number; bands?: number[] }): { valuePct: number; targetPct: number | null; bandPcts: number[] } {
  return {
    valuePct: pct(o.value, o.max),
    targetPct: o.target == null ? null : pct(o.target, o.max),
    bandPcts: (o.bands ?? []).map((b) => pct(b, o.max)),
  };
}
