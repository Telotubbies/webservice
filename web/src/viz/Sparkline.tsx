// Sparkline v2 — a quiet line (ink-3, not a series hue) over a fixed box;
// silence breaks the line (sparkPath). Limit lines are the only dashes and
// carry the severity colour. Decorative unless given a label.

import { sparkPath, type Pt } from './stat';

export function Sparkline({ pts, w = 120, h = 28, limits = [], label }: {
  pts: Pt[]; w?: number; h?: number;
  limits?: { v: number; severity: 'critical' | 'warning' }[];
  /** set when the shape carries information not restated nearby */
  label?: string;
}) {
  if (pts.length < 2) return <svg width={w} height={h} aria-hidden />;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  for (const l of limits) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); }
  const pad = (hi - lo) * 0.08 || 1;
  const dom: [number, number] = [lo - pad, hi + pad];
  const y = (v: number) => h - ((v - dom[0]) / (dom[1] - dom[0])) * h;
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block overflow-visible" {...a11y}>
      {limits.map((l, i) => (
        <line key={i} x1={0} x2={w} y1={y(l.v)} y2={y(l.v)} strokeWidth={1} strokeDasharray="3 2"
          stroke={l.severity === 'critical' ? 'var(--color-crit)' : 'var(--color-warn-ink)'} />
      ))}
      <path d={sparkPath(pts, w, h, dom)} fill="none" stroke="var(--color-ink-3)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
