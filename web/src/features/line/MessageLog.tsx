// Message log tab and the two dock tabs of the line console (D2). All three
// read the same F05 journal ring that the bell and the activity feed use, so
// the console never invents messages: the tab shows the structured rows, the
// dock shows the flat log (with a level filter) and the alarm events.

import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { EmptyState } from '../../shared/ui/Feedback';
import { atLevel, type LogLevel } from './lineModel';

function useJournal() {
  useStore(() => live.journalRev);
  return live.journal;
}

export function MessageLog() {
  const { t } = useTranslation();
  const now = useNow();
  const rows = useJournal().slice(0, 50);

  if (rows.length === 0) {
    return <div data-message-empty><EmptyState compact title={t('d2.noMessages')} body={t('d2.noMessagesBody')} icon="bell" /></div>;
  }

  return (
    <ul className="divide-y divide-line" aria-live="polite" data-message-log>
      {rows.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-[13px]">
          <span className="w-14 shrink-0 tabular-nums text-ink-46">{new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className="shrink-0 rounded-[3px] bg-neutral-soft px-1.5 text-[11px] font-semibold text-ink-muted">{t(`feed.${ev.kind}`)}</span>
          <span className="min-w-0 flex-1">{t(ev.title, ev.params)}</span>
          {ev.tag && <span className="truncate font-mono text-[11px] text-ink-46">{ev.tag.split('.').slice(-2).join('.')}</span>}
          <span className="shrink-0 text-[11px] text-ink-46">{fmtAge(ev.ts, now)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Flat console log: one line per journal entry, filtered to a minimum level. */
export function LineLog({ level }: { level: LogLevel }) {
  const { t } = useTranslation();
  const rows = useJournal().filter((ev) => atLevel(ev.severity, level)).slice(0, 40);
  if (rows.length === 0) return <p className="text-[13px] text-ink-46">{t('d2.logEmpty')}</p>;
  return (
    <ol className="flex flex-col gap-0.5 font-mono text-[12px]">
      {rows.map((ev) => (
        <li key={ev.id} className="flex gap-2">
          <span className="shrink-0 text-ink-46">{new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className={`shrink-0 ${ev.severity === 'critical' ? 'font-semibold text-[var(--color-danger)]' : ''}`}>{t(`d2.level${levelOfCap(ev.severity)}`)}</span>
          <span className="min-w-0 break-words">{t(ev.title, ev.params)}</span>
        </li>
      ))}
    </ol>
  );
}

/** `critical` → `Error`, `warning` → `Warning`, otherwise `Info` (i18n suffix). */
function levelOfCap(severity: string | undefined): 'Info' | 'Warning' | 'Error' {
  return severity === 'critical' || severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Info';
}

/** Alarm activity only, newest first — the dock's Events tab. */
export function EventLog() {
  const { t } = useTranslation();
  const now = useNow();
  const rows = useJournal().filter((ev) => ev.kind === 'alarm' || ev.kind === 'alarm_update').slice(0, 30);
  if (rows.length === 0) return <p className="text-[13px] text-ink-46">{t('d2.eventsEmpty')}</p>;
  return (
    <ul className="flex flex-col gap-0.5 text-[13px]">
      {rows.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="w-14 shrink-0 tabular-nums text-ink-46">{new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className="min-w-0 flex-1">{t(ev.title, ev.params)}</span>
          <span className="shrink-0 text-[11px] text-ink-46">{fmtAge(ev.ts, now)}</span>
        </li>
      ))}
    </ul>
  );
}
