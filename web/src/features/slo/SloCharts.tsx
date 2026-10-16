// Error-budget burndown + burn-rate charts for the SLO detail panel.
// Plain SVG (no chart dep): the series are small and the shapes are simple —
// step line, dashed "out of budget" line at 0, correction bands, and a grey
// zone where the window predates retained history. All values come from
// buildBurndown()/burnRates() over real tag history — nothing invented.

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Burndown, BurnBucket } from './slo';
import type { SloCorrection } from '../../lib/api';

const W = 640;
const H = 190;
const ML = 40; // y labels
const MR = 8;
const MT = 10;
const MB = 22; // x labels
const IW = W - ML - MR;
const IH = H - MT - MB;

interface Span { a: number; b: number }

function fmtTick(t: number, spanMs: number, lang: string): string {
  const d = new Date(t);
  if (spanMs > 2 * 86400e3) return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function xTicks(from: number, to: number, lang: string) {
  const span = to - from;
  const n = 4;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + (span * i) / n;
    return { t, x: ML + (IW * i) / n, label: fmtTick(t, span, lang) };
  });
}

function Corrections({ spans, sx, hatchId }: { spans: Span[]; sx: (t: number) => number; hatchId: string }) {
  return (
    <>
      {spans.map((c, i) => (
        <rect key={i} x={sx(c.a)} y={MT} width={Math.max(1, sx(c.b) - sx(c.a))} height={IH}
          fill={`url(#${hatchId})`} stroke="var(--color-line)" strokeDasharray="3 2" />
      ))}
    </>
  );
}

function corrSpans(corrections: SloCorrection[], from: number, to: number): Span[] {
  return corrections
    .map((c) => ({ a: Date.parse(c.starts_at), b: Date.parse(c.ends_at) }))
    .filter((c) => Number.isFinite(c.a) && Number.isFinite(c.b) && c.b > from && c.a < to)
    .map((c) => ({ a: Math.max(c.a, from), b: Math.min(c.b, to) }));
}

function Frame({ from, to, corrections, gapTo, children }: {
  from: number; to: number; corrections: SloCorrection[];
  /** everything left of this ts has no retained history — shaded */
  gapTo?: number | null;
  children: (ctx: { sx: (t: number) => number; corr: Span[]; hatchId: string }) => React.ReactNode;
}) {
  const { i18n } = useTranslation();
  const hatchId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const sx = (t: number) => ML + (IW * (t - from)) / Math.max(1, to - from);
  const corr = corrSpans(corrections, from, to);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img">
      <defs>
        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--color-neutral-soft)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-line)" strokeWidth="1" />
        </pattern>
      </defs>
      {/* grid + axes */}
      <line x1={ML} y1={MT} x2={ML} y2={MT + IH} stroke="var(--color-line)" />
      <line x1={ML} y1={MT + IH} x2={ML + IW} y2={MT + IH} stroke="var(--color-line)" />
      {gapTo != null && gapTo > from && (
        <g>
          <rect x={ML} y={MT} width={Math.max(0, sx(Math.min(gapTo, to)) - ML)} height={IH}
            fill="var(--color-subtle)" />
          <line x1={sx(Math.min(gapTo, to))} y1={MT} x2={sx(Math.min(gapTo, to))} y2={MT + IH}
            stroke="var(--color-line-hard)" strokeDasharray="4 3" />
        </g>
      )}
      {xTicks(from, to, i18n.language).map((tk, i) => (
        <text key={i} x={tk.x} y={H - 6} fontSize="10" fill="var(--color-ink-46)"
          textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{tk.label}</text>
      ))}
      {children({ sx, corr, hatchId })}
    </svg>
  );
}

/** Error budget burndown — step line of remaining budget %; a dashed line
 *  at 0 marks "out of budget" and the area below it is tinted. */
export function BurndownChart({ from, to, bd, corrections }: {
  from: number; to: number; bd: Burndown; corrections: SloCorrection[];
}) {
  const { t } = useTranslation();
  const yMin = Math.min(-10, Math.floor(Math.min(...bd.line.map((p) => p.pct), 0) * 1.15));
  const sy = (v: number) => MT + IH * (1 - (v - yMin) / (100 - yMin));
  const y0 = sy(0);
  return (
    <Frame from={from} to={to} corrections={corrections} gapTo={bd.coveredFrom}>
      {({ sx, corr, hatchId }) => (
        <>
          {/* y labels */}
          {[100, 0, yMin].map((v) => (
            <text key={v} x={ML - 6} y={sy(v) + 3} fontSize="10" fill="var(--color-ink-46)" textAnchor="end">
              {v === yMin ? `${Math.round(v)}%` : `${v}%`}
            </text>
          ))}
          <line x1={ML} y1={sy(100)} x2={ML + IW} y2={sy(100)} stroke="var(--color-line)" />
          {/* out-of-budget line */}
          <line x1={ML} y1={y0} x2={ML + IW} y2={y0} stroke="var(--color-danger-bright)" strokeDasharray="5 3" />
          <text x={ML + 4} y={y0 - 4} fontSize="10" fill="var(--color-danger)">{t('slos.panel.outOfBudget')}</text>
          <Corrections spans={corr} sx={sx} hatchId={hatchId} />
          {/* below-zero fill between the line and y=0 */}
          <path
            d={belowZeroPath(bd.line, sx, sy, y0)}
            fill="var(--color-danger-soft)" stroke="none" opacity={0.9}
          />
          {/* step line */}
          <path
            d={stepPath(bd.line, sx, sy)}
            fill="none" stroke="var(--color-blue)" strokeWidth="1.6" strokeLinejoin="round"
          />
        </>
      )}
    </Frame>
  );
}

function stepPath(pts: { t: number; pct: number }[], sx: (t: number) => number, sy: (v: number) => number): string {
  if (!pts.length) return '';
  let d = `M ${sx(pts[0].t)} ${sy(100)}`;
  for (const p of pts) {
    d += ` H ${sx(p.t)} V ${sy(Math.max(p.pct, -9000))}`;
  }
  return d;
}

/** Fill between the step line and y=0 wherever the line dips below. Each
 *  below-zero run becomes a polygon bounded by the interpolated crossings. */
function belowZeroPath(pts: { t: number; pct: number }[], sx: (t: number) => number, sy: (v: number) => number, y0: number): string {
  // polyline in screen space with y=0 crossings inserted between points
  const seq: { x: number; y: number; neg: boolean }[] = [];
  let prevT = 0;
  let prevV = 100;
  for (const p of pts) {
    const neg = p.pct < 0;
    if (prevT !== 0 && (prevV < 0) !== neg) {
      const tc = prevT + ((p.t - prevT) * (0 - prevV)) / (p.pct - prevV);
      seq.push({ x: sx(tc), y: y0, neg: false });
    }
    seq.push({ x: sx(p.t), y: sy(p.pct), neg });
    prevT = p.t;
    prevV = p.pct;
  }
  let d = '';
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) d += `M ${run[0].x} ${y0} ` + run.map((p) => `L ${p.x} ${p.y} `).join('') + `L ${run[run.length - 1].x} ${y0} Z `;
    run = [];
  };
  for (const p of seq) {
    if (p.neg) { run.push(p); continue; }
    if (p.y === y0) {
      // y=0 crossing: closes the open run and can open the next one
      if (run.length) { run.push(p); flush(); }
      run.push(p);
      continue;
    }
    flush();
  }
  flush();
  return d;
}

/** Burn rate per bucket — bad share ÷ allowed share. Bars over the dashed
 *  "target pace" line at 1.0 are burning faster than the budget allows. */
export function BurnRateChart({ from, to, buckets, rates, corrections }: {
  from: number; to: number; buckets: BurnBucket[]; rates: (number | null)[]; corrections: SloCorrection[];
}) {
  const { t } = useTranslation();
  const rMax = Math.max(1.5, ...rates.map((r) => (r == null || !Number.isFinite(r) ? 0 : Math.min(r, 20))));
  const sy = (v: number) => MT + IH * (1 - v / (rMax * 1.15));
  return (
    <Frame from={from} to={to} corrections={corrections} gapTo={firstBucket(buckets)}>
      {({ sx, corr, hatchId }) => (
        <>
          {[0, 1, rMax].map((v) => (
            <text key={v} x={ML - 6} y={sy(v) + 3} fontSize="10" fill="var(--color-ink-46)" textAnchor="end">
              {v === 1 ? '1×' : v === 0 ? '0' : `${rMax.toFixed(rMax >= 10 ? 0 : 1)}×`}
            </text>
          ))}
          <line x1={ML} y1={sy(1)} x2={ML + IW} y2={sy(1)} stroke="var(--color-danger-bright)" strokeDasharray="5 3" />
          <text x={ML + 4} y={sy(1) - 4} fontSize="10" fill="var(--color-danger)">{t('slos.panel.burnPace')}</text>
          <Corrections spans={corr} sx={sx} hatchId={hatchId} />
          {buckets.map((b, i) => {
            const r = rates[i];
            if (r == null || !Number.isFinite(r) || r <= 0) return null;
            const x = sx(b.t0);
            const w = Math.max(1.5, sx(b.t1) - sx(b.t0) - 1);
            return (
              <rect key={i} x={x} y={sy(r)} width={w} height={MT + IH - sy(r)}
                fill={r > 1 ? 'var(--color-caution)' : 'var(--color-muted-pill)'}>
                <title>{`${new Date(b.t0).toLocaleString()} — ${r.toFixed(2)}×`}</title>
              </rect>
            );
          })}
        </>
      )}
    </Frame>
  );
}

function firstBucket(buckets: BurnBucket[]): number | null {
  const b = buckets.find((x) => x.samples > 0);
  return b ? b.t0 : null;
}
