// F02 — alarm density strip: 48 × 5-minute buckets over the trailing 4h.
// Colour carries the worst severity, but every bucket also has a text label
// (aria-label / title) with the count, so colour is never the only signal.

import { useTranslation } from 'react-i18next';
import { normSeverity, type Severity } from '../../shared/ui/Status';
import type { Alarm } from '../../types';

export const DENSITY_BUCKETS = 48;
const BUCKET_MS = 5 * 60_000;

export interface Bucket { from: number; to: number; count: number; worst: Severity | null }

export function bucketAlarms(alarms: Alarm[], now: number): Bucket[] {
  const start = now - DENSITY_BUCKETS * BUCKET_MS;
  const buckets: Bucket[] = Array.from({ length: DENSITY_BUCKETS }, (_, i) => ({
    from: start + i * BUCKET_MS, to: start + (i + 1) * BUCKET_MS, count: 0, worst: null,
  }));
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  for (const a of alarms) {
    const t = Date.parse(a.ts);
    if (Number.isNaN(t) || t < start || t >= now) continue;
    const b = buckets[Math.floor((t - start) / BUCKET_MS)];
    const sev = normSeverity(a.severity);
    b.count += 1;
    if (!b.worst || rank[sev] < rank[b.worst]) b.worst = sev;
  }
  return buckets;
}

const FILL: Record<Severity, string> = {
  critical: 'bg-[var(--color-danger-bright)]', warning: 'bg-[var(--color-warn)]', info: 'bg-[var(--color-muted-pill)]',
};

export function AlarmDensity({ alarms, now, picked, onPick }: {
  alarms: Alarm[]; now: number; picked: Bucket | null; onPick: (b: Bucket | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const buckets = bucketAlarms(alarms, now);
  const total = buckets.reduce((n, b) => n + b.count, 0);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="mb-3 rounded-[5px] border border-line bg-white px-3 py-2 shadow-card" aria-label={t('alarms.density')}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-68">
        <span className="font-semibold">{t('alarms.density')}</span>
        <span className="text-ink-46">{total === 0 ? t('alarms.densityQuiet') : t('alarms.shown', { count: total })}</span>
        <span className="flex-1" />
        {picked && (
          <button type="button" className="text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={() => onPick(null)}>
            {t('alarms.densityClear')}
          </button>
        )}
      </div>
      <div className="flex h-5 gap-px" role="group">
        {buckets.map((b, i) => {
          const on = picked?.from === b.from;
          const label = t('alarms.densityTip', { window: `${clock(b.from)}–${clock(b.to)}`, count: b.count });
          return (
            <button
              key={i}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={on}
              onClick={() => onPick(on ? null : b)}
              disabled={b.count === 0}
              className={`min-w-0 flex-1 rounded-[1px] focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-default ${
                b.worst ? FILL[b.worst] : 'bg-line'
              } ${on ? 'outline outline-2 outline-blue' : ''}`}
              style={b.count ? { opacity: Math.min(1, 0.4 + b.count * 0.15) } : undefined}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-46">
        <span>{clock(now - DENSITY_BUCKETS * BUCKET_MS)}</span>
        <span>{clock(now)}</span>
      </div>
    </section>
  );
}
