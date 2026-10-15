// Value trend around one alarm: history from shortly before the alarm was
// raised up to now (hot table keeps 8 h), the rule limit as a dashed line in
// the alarm's severity colour (+ text label), and a "Raised" marker.
// Single series → no legend box; the card title names it. Gaps > 30 s break
// the line so missing data never looks like a flat, healthy value.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Skeleton } from '../../shared/ui/Feedback';
import { normSeverity } from '../../shared/ui/Status';
import './i18n';

const H = 170;
const PAD = { l: 44, r: 12, t: 12, b: 22 };
const GAP_MS = 30_000;
const LEAD_MS = 10 * 60_000;
const MAX_MS = 8 * 3600_000;

const LIMIT_STROKE = {
  critical: 'var(--color-danger-bright)', warning: 'var(--color-caution)', info: 'var(--color-muted-pill)',
} as const;

export function AlarmTrend({ tag, raisedAt, limit, unit, decimals = 1, severity }: {
  tag: string; raisedAt: string; limit?: number | null; unit?: string; decimals?: number; severity: string;
}) {
  const { t, i18n } = useTranslation();
  const raised = Date.parse(raisedAt);
  const q = useQuery({
    queryKey: ['alarm-trend', tag, raisedAt],
    queryFn: () => {
      const now = Date.now();
      const from = Math.max(raised - LEAD_MS, now - MAX_MS);
      return api.history(tag, { from: new Date(from).toISOString(), to: new Date(now).toISOString(), limit: 5000 });
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const pts = useMemo(() => (q.data ?? [])
    .map((p) => ({ t: Date.parse(p.ts), v: typeof p.v === 'boolean' ? (p.v ? 1 : 0) : p.v }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t), [q.data]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // draw at the real pixel width so labels keep their size on any screen
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [q.isSuccess]);

  if (q.isPending) return <div role="status" aria-label={t('alx.trendLoading')}><Skeleton h={H} /></div>;
  if (q.isError) return <p className="py-6 text-center text-[12px] text-ink-46" role="alert">{t('alx.trendError')}</p>;
  if (pts.length < 2) return <p className="py-6 text-center text-[12px] text-ink-46">{t('alx.trendEmpty')}</p>;

  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  if (limit != null && Number.isFinite(limit)) {
    // only stretch the axis for a limit that is near the data — a test rule
    // at 99999 must not flatten the real signal into one line
    const span = hi - lo || Math.abs(hi) || 1;
    if (limit >= lo - span && limit <= hi + span) { lo = Math.min(lo, limit); hi = Math.max(hi, limit); }
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  // split into segments at gaps
  const segs: string[] = [];
  let cur: string[] = [];
  pts.forEach((p, i) => {
    if (i > 0 && p.t - pts[i - 1].t > GAP_MS && cur.length) { segs.push(cur.join(' ')); cur = []; }
    cur.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur.join(' '));

  const fmtV = (v: number) => `${v.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
  const limitIn = limit != null && limit >= lo && limit <= hi;
  const sev = normSeverity(severity);
  const raisedIn = raised >= t0 && raised <= t1;
  const hp = hover != null ? pts[hover] : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const ms = t0 + ((((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - ms) < Math.abs(pts[best].t - ms)) best = i;
    setHover(best);
  };

  const last = pts[pts.length - 1];
  return (
    <figure className="m-0">
      <div className="relative" ref={boxRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block max-w-full touch-none"
          role="img"
          aria-label={`${t('alx.trend')}: ${fmtV(pts[0].v)} → ${fmtV(last.v)}${limit != null ? `, ${t('alx.trendLimit', { v: fmtV(limit) })}` : ''}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* recessive frame: two value ticks + baseline */}
          {[...new Set([hi - pad, lo + pad])].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-46)" className="font-mono">{v.toFixed(decimals)}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize={10} fill="var(--color-ink-46)" className="font-mono">{clock(t0)}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize={10} fill="var(--color-ink-46)" className="font-mono">{clock(t1)}</text>
          {raisedIn && (
            <g>
              <line x1={x(raised)} x2={x(raised)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-46)" strokeDasharray="2 3" strokeWidth={1} />
              <text x={x(raised) + 4} y={PAD.t + 9} fontSize={10} fill="var(--color-ink-68)">{t('alx.trendRaised')}</text>
            </g>
          )}
          {limitIn && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(limit!)} y2={y(limit!)} stroke={LIMIT_STROKE[sev]} strokeDasharray="6 4" strokeWidth={1.5} />
              <text x={W - PAD.r - 2} y={y(limit!) - 4} textAnchor="end" fontSize={10} fill="var(--color-ink-68)">{t('alx.trendLimit', { v: fmtV(limit!) })}</text>
            </g>
          )}
          {segs.map((s, i) => (
            <polyline key={i} points={s} fill="none" stroke="var(--color-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hp && (
            <g>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-35)" strokeWidth={1} />
              <circle cx={x(hp.t)} cy={y(hp.v)} r={4} fill="var(--color-blue)" stroke="var(--color-paper)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute top-1 rounded border border-line bg-white px-2 py-1 text-[11px] shadow-card"
            style={{ left: `${Math.min(80, Math.max(0, (x(hp.t) / W) * 100 - 10))}%` }}
          >
            <span className="font-mono font-semibold tabular-nums">{fmtV(hp.v)}</span>
            <span className="ml-1 text-ink-46">{new Date(hp.t).toLocaleTimeString(i18n.language, { hour12: false })}</span>
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-[11px] text-ink-46">
        {!raisedIn && raised < t0 && <span className="mr-1">{t('alx.trendBefore', { time: new Date(raised).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short', hour12: false }) })}</span>}
        {t('alx.trendNote')}
      </figcaption>
    </figure>
  );
}
