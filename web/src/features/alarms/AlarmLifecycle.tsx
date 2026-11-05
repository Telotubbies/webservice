// F01 — Raised → Acknowledged → Cleared stepper for one alarm. Durations come
// from the timestamps the backend already sends (_v1 acked_at / cleared_at).

import { useTranslation } from 'react-i18next';
import { fmtAge, fmtDuration } from '../../lib/format';
import type { Alarm } from '../../types';
import './i18n';

export function AlarmLifecycle({ alarm, now }: { alarm: Alarm; now: number }) {
  const { t, i18n } = useTranslation();
  const acked = alarm.acked_at ?? null;
  const cleared = alarm.cleared_at ?? null;
  const steps = [
    { key: 'raised', label: t('alarms.tlRaised'), at: alarm.ts, who: null as string | null },
    { key: 'acked', label: t('alarms.tlAcked'), at: acked, who: alarm.acked_by ?? null },
    { key: 'cleared', label: t('alarms.tlCleared'), at: cleared, who: null },
  ];
  // Elapsed time for the segment that ends at each reached step.
  const seg = (i: number): string | null => {
    const from = i === 2 ? acked ?? alarm.ts : alarm.ts;
    const to = i === 1 ? acked : cleared;
    if (!to || i === 0) return null;
    return fmtDuration(from, Date.parse(to));
  };

  return (
    <ol className="alarm-lifecycle flex items-stretch gap-0" aria-label={t('alarms.tlTitle')}>
      {steps.map((s, i) => {
        const done = s.at != null;
        // state says the step happened even when its timestamp is missing
        const reached = !done && ((i === 1 && alarm.state !== 'active' && (alarm.state === 'acked' || !!alarm.acked_by))
          || (i === 2 && alarm.state === 'cleared'));
        const waiting = !done && (i === 1 ? alarm.state === 'active' : alarm.state !== 'cleared');
        return (
          <li key={s.key} className="flex min-w-0 flex-1 flex-col gap-1 border-l-2 border-line px-3 py-1 first:border-l-0 first:pl-0"
            data-step={s.key} data-done={done}>
            <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${done ? 'text-ink' : 'text-ink-46'}`}>
              <span aria-hidden className="text-[10px]">{done ? '●' : '○'}</span>
              {s.label}
            </span>
            {done && (
              <span className="text-[11px] text-ink-68">
                <time className="font-mono tabular-nums" dateTime={s.at as string}>
                  {new Date(s.at as string).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'medium' })}
                </time>
                <span className="ml-1 text-ink-46">({fmtAge(s.at as string, now)})</span>
                {s.who && <span className="block font-medium text-ink">{t('alx.ackedWho', { who: s.who })}</span>}
              </span>
            )}
            {/* reached per state but the timestamp was not sent — say so, never "pending" */}
            {!done && reached && (
              <span className="text-[11px] text-ink-68">
                <span className="text-ink-46">{t('alx.timeUnknown')}</span>
                {s.who && <span className="block font-medium text-ink">{t('alx.ackedWho', { who: s.who })}</span>}
              </span>
            )}
            {!done && !reached && <span className="text-[11px] text-ink-46">{waiting ? `${t('alarms.tlWaiting')} · ${fmtDuration(alarm.ts, now)}` : '—'}</span>}
            {seg(i) && <span className="text-[11px] text-ink-46">{t('alarms.tlStepFor', { dur: seg(i) })}</span>}
          </li>
        );
      })}
    </ol>
  );
}
