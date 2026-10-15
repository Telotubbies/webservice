// Events-over-time histogram (dd event explorer "timeseries" strip).
// Each bar stacks abnormal (critical, warning) on top of normal events; every
// bar is a button whose label carries the counts, so colour is never the only
// signal. Clicking a bar narrows the list to that bucket.

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlantEvent } from './model';

export interface HistBucket { from: number; to: number; critical: number; warning: number; other: number }

export const HIST_BUCKETS = 60;

export function bucketEvents(events: PlantEvent[], from: number, to: number): HistBucket[] {
  const step = (to - from) / HIST_BUCKETS;
  const out: HistBucket[] = Array.from({ length: HIST_BUCKETS }, (_, i) => ({
    from: from + i * step, to: from + (i + 1) * step, critical: 0, warning: 0, other: 0,
  }));
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    const b = out[Math.min(HIST_BUCKETS - 1, Math.floor((e.at - from) / step))];
    if (e.severity === 'critical') b.critical++;
    else if (e.severity === 'warning') b.warning++;
    else b.other++;
  }
  return out;
}

export const EventHistogram = memo(function EventHistogram({ events, from, to, picked, onPick }: {
  events: PlantEvent[]; from: number; to: number;
  picked: HistBucket | null; onPick: (b: HistBucket | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const buckets = bucketEvents(events, from, to);
  const max = Math.max(1, ...buckets.map((b) => b.critical + b.warning + b.other));
  const long = to - from > 24 * 3600_000;
  const fmt = (ms: number) => new Date(ms).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB', long
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section className="rounded-[5px] border border-line bg-white px-3 pb-2 pt-2 shadow-card" aria-label={t('evx.histTitle')}>
      <div className="mb-1 flex items-center gap-2 text-[12px]">
        <h2 className="font-semibold text-ink">{t('evx.histTitle')}</h2>
        <span className="flex items-center gap-2 text-[11px] text-ink-68">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[1px] bg-[var(--color-danger-bright)]" aria-hidden />{t('alarms.critical')}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[1px] bg-[var(--color-warn)]" aria-hidden />{t('alarms.warning')}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[1px] bg-[#b9c0cc]" aria-hidden />{t('evx.sevNone')}</span>
        </span>
        <span className="flex-1" />
        {picked && (
          <button type="button" className="text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={() => onPick(null)}>
            {t('evx.histClear')}
          </button>
        )}
      </div>
      <div className="flex h-16 items-end gap-px" role="group" aria-label={t('evx.histTitle')}>
        {buckets.map((b) => {
          const n = b.critical + b.warning + b.other;
          const on = picked?.from === b.from;
          const label = t('evx.histTip', { window: `${fmt(b.from)}–${fmt(b.to)}`, count: n });
          return (
            <button
              key={b.from}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={on}
              disabled={n === 0}
              onClick={() => onPick(on ? null : b)}
              className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-[1px] focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-default ${on ? 'bg-info-soft outline outline-1 outline-blue' : 'hover:bg-subtle'}`}
            >
              {n === 0 ? (
                <span className="block h-px w-full bg-line" />
              ) : (
                <>
                  {b.critical > 0 && <span className="block w-full bg-[var(--color-danger-bright)]" style={{ height: `${(b.critical / max) * 100}%` }} />}
                  {b.warning > 0 && <span className="block w-full bg-[var(--color-warn)]" style={{ height: `${(b.warning / max) * 100}%` }} />}
                  {b.other > 0 && <span className="block w-full bg-[#b9c0cc]" style={{ height: `${(b.other / max) * 100}%` }} />}
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-46">
        <span>{fmt(from)}</span>
        {picked ? <span className="text-blue">{t('evx.histPicked', { window: `${fmt(picked.from)}–${fmt(picked.to)}` })}</span> : null}
        <span>{fmt(to)}</span>
      </div>
    </section>
  );
});
