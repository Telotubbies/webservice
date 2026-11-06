// Alarm row pieces shared by the Alarms page and the topbar alarm drawer:
// the ack button (role-gated, busy + error in place), the shelved mark, the
// state cell (who/when in text) and the compact card used on phones and in
// the drawer. Moved out of AlarmsPage unchanged.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SIGNALS } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { canOperate, useRole } from '../../app/session';
import { ackAlarm, errText } from './ackAlarm';
import { SeverityBadge } from '../../shared/ui/Status';
import { AlarmStateChip } from './AlarmStateChip';
import { needsAck } from './alarms';
import { Icon } from '../../shared/ui/Icon';
import type { Alarm } from '../../types';
import './i18n';

// ── Row pieces ───────────────────────────────────────────────────────────────

export function AckButton({ alarm }: { alarm: Alarm }) {
  const { t } = useTranslation();
  const role = useRole();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // viewers get one "view only" note in the toolbar, not a line per row
  if (!needsAck(alarm) || !canOperate(role)) return null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        className="btn btn-sm btn-ghost btn-ack whitespace-nowrap max-md:min-h-11 max-md:min-w-[5.5rem] max-md:px-4 max-md:text-[13px]"
        disabled={busy}
        aria-label={`${t('alarms.ack')}: ${alarm.rule}`}
        onClick={() => {
          setBusy(true);
          setErr('');
          ackAlarm(alarm)
            .catch((e) => setErr(t('alx.ackFailed', { reason: errText(e, t) })))
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="check" size={13} /> {busy ? t('alx.ackBusy') : t('alarms.ack')}
      </button>
      {err && <span className="max-w-48 text-[11px] text-[var(--color-danger)]" role="alert">{err}</span>}
    </span>
  );
}

/** "Shelved until …" pill — notifications are muted while it shows. */
export function ShelvedMark({ alarm, now }: { alarm: Alarm; now: number }) {
  const { t } = useTranslation();
  if (!alarm.shelved_until || Date.parse(alarm.shelved_until) <= now) return null;
  return (
    <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-68"
      title={t('al.shelvedBadge', { at: new Date(alarm.shelved_until).toLocaleString() })}>
      {t('shelve.mark')}
    </span>
  );
}

/** State badge + who/when, in text — ownership readable without hovering. */
export function StateCell({ alarm, now }: { alarm: Alarm; now: number }) {
  const { t } = useTranslation();
  const s = alarm.state;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="flex items-center gap-1.5">
        <AlarmStateChip state={s} ackedBy={alarm.acked_by} />
        <ShelvedMark alarm={alarm} now={now} />
      </span>
      {s === 'acked' && (
        <span className="alarm-acked-label text-[11px] text-ink-68">
          {alarm.acked_by
            ? alarm.acked_at
              ? t('alx.ackedWhoWhen', { who: alarm.acked_by, age: fmtAge(alarm.acked_at, now) })
              : t('alx.ackedWho', { who: alarm.acked_by })
            : t('alx.ackedUnknownWho')}
        </span>
      )}
      {s === 'rtn_unack' && (
        <span className="alarm-rtn-label text-[11px] text-ink-68">
          {alarm.cleared_at ? t('alx.rtnSince', { age: fmtAge(alarm.cleared_at, now) }) : t('alx.rtnNeedsAck')}
        </span>
      )}
      {s === 'cleared' && (
        <span className="alarm-cleared-label text-[11px] text-ink-46">
          {alarm.acked_by ? t('alx.ackedWho', { who: alarm.acked_by }) : alarm.cleared_at ? fmtAge(alarm.cleared_at, now) : ''}
        </span>
      )}
    </span>
  );
}

/** One alarm as a compact card: priority, name, signal, state and age, and
 *  the ack button. The whole card opens the alarm; ack and select stop the
 *  click from bubbling. */
export function AlarmCard({ alarm: a, now, onOpen, select }: {
  alarm: Alarm; now: number; onOpen: () => void;
  select?: { checked: boolean; onToggle: () => void };
}) {
  const { t } = useTranslation();
  const label = SIGNALS[a.tag] ? t(SIGNALS[a.tag].labelKey) : null;
  return (
    <div
      className="flex items-start gap-2 px-3 py-2.5"
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      {select && (
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0"
          checked={select.checked} onChange={select.onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('alarms.select', { name: a.rule })} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <SeverityBadge severity={a.severity} />
          <ShelvedMark alarm={a} now={now} />
          <span className="truncate text-[13px] font-semibold">{a.rule}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-46">
          {label && <span>{label}</span>}
          <span className="font-mono">{a.tag}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-68">
          <StateCell alarm={a} now={now} />
          <span className="tabular-nums">{fmtAge(a.ts, now)}</span>
        </span>
      </span>
      <span onClick={(e) => e.stopPropagation()} className="shrink-0">
        {needsAck(a) ? <AckButton alarm={a} /> : null}
      </span>
    </div>
  );
}
