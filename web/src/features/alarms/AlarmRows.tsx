// Alarm rows — table on wide screens, stacked cards on narrow ones (07 §7).
// Text is ≥ body size for alarms (07 typography rule).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow } from '../../lib/hooks';
import { fmtDuration } from '../../lib/format';
import { SIGNALS, shortName } from '../../lib/plant';
import { canOperate, useRole } from '../../app/session';
import { Notice } from '../../shared/ui/Feedback';
import { SeverityBadge, normSeverity } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';
import type { Alarm } from '../../types';
import './alarms.css';

export function useSignalLabel() {
  const { t } = useTranslation();
  return (name: string) => (SIGNALS[name] ? t(SIGNALS[name].labelKey) : shortName(name));
}

function StateCell({ a }: { a: Alarm }) {
  const { t } = useTranslation();
  if (a.state === 'active') return <span className="alarm-state is-active">{t('alarms.active')}</span>;
  if (a.state === 'acked') {
    return (
      <span className="alarm-state is-acked alarm-acked-label" title={a.acked_by ? t('alarms.ackedBy', { who: a.acked_by }) : undefined}>
        {t('alarms.acked')}
      </span>
    );
  }
  return <span className="alarm-state is-cleared alarm-cleared-label">{t('alarms.cleared')}</span>;
}

export function AlarmRows({ alarms, compact = false }: { alarms: Alarm[]; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const now = useNow(1000);
  const role = useRole();
  const label = useSignalLabel();
  const { openFaceplate } = useFaceplate();
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const canAck = canOperate(role);
  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleTimeString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { hour12: false });

  const ack = async (a: Alarm) => {
    setErr('');
    setBusyId(String(a.id));
    try {
      const updated = await api.ackAlarm(a.id) as Alarm;
      live.upsertAlarm(updated?.id ? updated : { ...a, state: 'acked' });
    } catch (e) {
      setErr(t('alarms.ackFailed', { reason: e instanceof Error ? e.message : '?' }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {err && <Notice tone="error">{err}</Notice>}
      <table className={`table alarm-table${compact ? ' is-compact' : ''}`}>
        <thead>
          <tr>
            <th scope="col">{t('alarms.colSeverity')}</th>
            <th scope="col">{t('alarms.colAlarm')}</th>
            {!compact && <th scope="col">{t('alarms.colRaised')}</th>}
            <th scope="col">{t('alarms.colDuration')}</th>
            <th scope="col">{t('alarms.colState')}</th>
            <th scope="col"><span className="sr-only">{t('alarms.colAction')}</span></th>
          </tr>
        </thead>
        <tbody>
          {alarms.map((a) => (
            <tr key={a.id} className={`alarm-row alarm-${a.state}`} data-alarm-id={a.id} data-sev={normSeverity(a.severity)}>
              <td><SeverityBadge severity={a.severity} /></td>
              <td className="alarm-what">
                <button type="button" className="alarm-signal tag-link" onClick={() => openFaceplate(a.tag)}>
                  {label(a.tag)}
                </button>
                <span className="alarm-rule mono" title={a.tag}>{a.rule}</span>
              </td>
              {!compact && <td className="mono">{fmtTime(a.ts)}</td>}
              <td className="mono">{fmtDuration(a.ts, now)}</td>
              <td><StateCell a={a} /></td>
              <td className="alarm-action">
                {a.state === 'active' && (canAck ? (
                  <button className="btn btn-sm btn-ack" disabled={busyId === String(a.id)} onClick={() => void ack(a)}>
                    {t('alarms.ack')}
                  </button>
                ) : (
                  <span className="hint">{t('alarms.signInToAck')}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
