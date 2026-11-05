// BarList — horizontal bars, largest first (spec §7.1: downtime by reason,
// top lists, and the honest replacement for pie/donut/treemap). One series
// hue (slot 1); values right-aligned in tabular figures; an optional thin
// cumulative line turns it into a Pareto. Labels and values are text, so the
// chart reads without colour.

import { useTranslation } from 'react-i18next';
import './i18n';

export function BarList({ items, unit, cumulative = false, onPick, max }: {
  items: { label: string; value: number; cumPct?: number }[];
  unit?: string; cumulative?: boolean; onPick?: (label: string) => void; max?: number;
}) {
  const { t, i18n } = useTranslation();
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  const fmt = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const Row = onPick ? 'button' : 'div';
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.label}>
            <Row
              {...(onPick ? { type: 'button' as const, onClick: () => onPick(it.label) } : {})}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-control px-1 text-left ${onPick ? 'hover:bg-panel-2' : ''}`}
            >
              <span className="relative flex h-6 min-w-0 items-center">
                <span aria-hidden className="absolute inset-y-0.5 left-0 rounded-[3px] bg-series-1 opacity-25" style={{ width: `${(it.value / top) * 100}%` }} />
                <span className="relative truncate px-1.5 text-[12px] text-ink">{it.label}</span>
              </span>
              <span className="font-mono text-[12px] tabular-nums text-ink">
                {fmt(it.value)}{unit ? ` ${unit}` : ''}
                {cumulative && it.cumPct != null && <span className="ml-2 text-[11px] text-ink-3">{it.cumPct}%</span>}
              </span>
            </Row>
          </li>
        ))}
      </ul>
      {cumulative && <p className="mt-1 px-1 text-[11px] text-ink-3">{t('viz2.cumulative')}</p>}
    </div>
  );
}
