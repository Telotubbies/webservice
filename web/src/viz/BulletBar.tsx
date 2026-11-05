// BulletBar (value vs target, spec §7.1) and Meter (a single ratio — the
// honest replacement for a gauge). Grey bands, an ink value bar, a 3 px
// target tick. Off-target beyond `tolerance` adds ◆ and the deviation in
// words; colour alone never carries it.

import { useTranslation } from 'react-i18next';
import { bulletScale } from './bullet';
import './i18n';

export function BulletBar({ label, value, unit, target, max, bands, tolerance }: {
  label: string; value: number; unit?: string; target?: number; max: number; bands?: number[]; tolerance?: number;
}) {
  const { t, i18n } = useTranslation();
  const s = bulletScale({ value, target, max, bands });
  const fmt = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const dev = target != null && target !== 0 ? (value - target) / target : null;
  const off = dev != null && tolerance != null && Math.abs(dev) > tolerance;
  const shades = ['bg-panel-2', 'bg-[color-mix(in_oklch,var(--color-line-strong),var(--color-panel)_40%)]', 'bg-line-strong'];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink-2">{label}</span>
        <span className="font-mono tabular-nums text-ink">{fmt(value)}{unit ? ` ${unit}` : ''}</span>
        {target != null && <span className="text-ink-3">{t('viz2.target', { v: `${fmt(target)}${unit ? ` ${unit}` : ''}` })}</span>}
      </div>
      <div className="relative h-3 overflow-hidden rounded-[3px] bg-panel-2" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        {[...s.bandPcts].reverse().map((b, i) => (
          <span key={i} aria-hidden className={`absolute inset-y-0 left-0 ${shades[Math.min(i, shades.length - 1)]}`} style={{ width: `${b}%` }} />
        ))}
        <span aria-hidden className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-r-[2px] bg-ink" style={{ width: `${s.valuePct}%` }} />
        {s.targetPct != null && <span aria-hidden className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-ink-2" style={{ left: `${s.targetPct}%` }} />}
      </div>
      {off && dev != null && (
        <span className="flex items-center gap-1 text-[11px] text-ink"><span aria-hidden className="text-warn-ink">◆</span>{t('viz2.deviation', { pct: (dev * 100).toFixed(1) })}</span>
      )}
    </div>
  );
}

export function Meter({ value, max, label, unit }: { value: number; max: number; label: string; unit?: string }) {
  const { i18n } = useTranslation();
  const s = bulletScale({ value, max });
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink-2">{label}</span>
        <span className="font-mono tabular-nums text-ink">{value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}{unit ? ` ${unit}` : ''}</span>
        <span className="font-mono text-[11px] text-ink-3">/ {max.toLocaleString(i18n.language)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <span aria-hidden className="block h-full rounded-full bg-ink-2" style={{ width: `${s.valuePct}%` }} />
      </div>
    </div>
  );
}
