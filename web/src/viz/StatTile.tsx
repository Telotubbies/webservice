// StatTile — one current value (spec §7.1): value + unit, delta vs the
// window start, a sparkline with its limits, freshness. Proportional figures
// for the hero value (dataviz rule); the delta is ink — direction is a fact,
// not a verdict. A crossed limit adds an outline and the severity glyph.
// M1: when the value moves beyond the deadband the number gets a 200 ms
// underline flash; noise inside the deadband never blinks.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { beyondDeadband } from '../theme/motion';
import { fmtAge } from '../lib/format';
import { useNow } from '../lib/hooks';
import { QualityMark } from '../shared/ui/Status';
import { DemoBadge } from '../shared/ui/Feedback';
import type { Quality } from '../types';
import { Sparkline } from './Sparkline';
import { statDelta, type Pt } from './stat';
import './i18n';

type Limit = { v: number; severity: 'critical' | 'warning'; kind?: 'hi' | 'lo' };
const SIZE = { md: 'text-[28px]', hero: 'text-[40px]', wall: 'text-[64px]' } as const;

function breached(v: number | null | undefined, limits: Limit[]): Limit | null {
  if (v == null) return null;
  const hit = limits.filter((l) => (l.kind === 'lo' ? v <= l.v : v >= l.v));
  return hit.find((l) => l.severity === 'critical') ?? hit[0] ?? null;
}

export function StatTile({ label, value, unit, decimals = 1, pts = [], limits = [], ts, quality, sim, size = 'md', windowMs = 3600_000, windowLabel = '1h' }: {
  label: string; value: number | null | undefined; unit?: string; decimals?: number; pts?: Pt[];
  limits?: Limit[]; ts?: string; quality?: Quality; sim?: boolean; size?: keyof typeof SIZE;
  windowMs?: number; windowLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow(5000);
  const delta = statDelta(pts, now, windowMs);
  const hit = breached(value, limits);
  const stale = !!ts && now - Date.parse(ts) > 15_000;

  // M1 flash only past the deadband (0.5 % of the observed span)
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (value == null) return;
    let lo = value, hi = value;
    for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (prev.current != null && beyondDeadband(prev.current, value, hi - lo)) setFlash((f) => f + 1);
    prev.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fmt = (v: number) => v.toLocaleString(i18n.language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-panel border bg-panel p-3 ${hit ? (hit.severity === 'critical' ? 'border-crit' : 'border-warn-ink') : 'border-line'}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[12px] font-semibold text-ink-2">{label}</span>
        {sim && <DemoBadge />}
        {hit && (
          <span className={`ml-auto shrink-0 text-[11px] font-semibold ${hit.severity === 'critical' ? 'text-crit' : 'text-warn-ink'}`}>
            <span aria-hidden>{hit.severity === 'critical' ? '▲' : '◆'} </span>{hit.kind === 'lo' ? '≤' : '≥'} {fmt(hit.v)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-baseline gap-1">
        <span className={`relative font-semibold leading-none text-ink ${SIZE[size]} ${stale ? 'text-ink-3' : ''}`}>
          {value == null ? '—' : fmt(value)}
          {flash > 0 && (
            <motion.span key={flash} aria-hidden className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-accent"
              initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.2, delay: 0.15 }} />
          )}
        </span>
        {unit && <span className="text-[13px] text-ink-3">{unit}</span>}
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-2">
          {delta && (
            <span className="tabular-nums">
              <span aria-hidden>{delta.dir === 'up' ? '↑' : delta.dir === 'down' ? '↓' : '→'} </span>
              {delta.dir === 'flat' ? t('viz2.flat') : `${delta.delta > 0 ? '+' : ''}${fmt(delta.delta)}${delta.pct != null ? ` (${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%)` : ''}`}
              {' '}{t('viz2.deltaVs', { w: windowLabel })}
            </span>
          )}
          <span className="flex items-center gap-1 text-ink-3">
            <QualityMark q={quality} stale={stale} />
            {ts && fmtAge(ts, now)}
          </span>
        </span>
        <Sparkline pts={pts} limits={limits} w={size === 'md' ? 96 : 140} h={size === 'wall' ? 48 : 28} />
      </div>
    </div>
  );
}
