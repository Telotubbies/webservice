// Rolling sparkline from the live ring buffer. Optional limit line drawn in
// the reserved alarm colour only when a configured alarm limit is in range.

import { live } from '../../lib/live';

const N = 90;
const W = 200;
const H = 40;

export function Sparkline({ tag, limit, scale = 1, label }: {
  tag: string; limit?: number; scale?: number;
  /** pass a short localized label when the sparkline carries information
   *  that isn't restated next to it in text — otherwise it stays aria-hidden */
  label?: string;
}) {
  const buf = live.buffers.get(tag);
  const pts = buf && buf.length > 1 ? buf.slice(-N) : null;
  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };
  if (!pts) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" {...a11y} />;
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) { min = Math.min(min, p.v * scale); max = Math.max(max, p.v * scale); }
  if (limit !== undefined) { min = Math.min(min, limit); max = Math.max(max, limit); }
  const span = max - min || 1;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const step = W / (pts.length - 1);
  const line = pts.map((p, i) => `${(i * step).toFixed(1)},${y(p.v * scale).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" {...a11y}>
      <polygon className="spark-fill" points={`0,${H} ${line} ${W},${H}`} />
      {limit !== undefined && <line className="spark-limit" x1="0" x2={W} y1={y(limit)} y2={y(limit)} />}
      <polyline className="spark-line" points={line} />
    </svg>
  );
}
