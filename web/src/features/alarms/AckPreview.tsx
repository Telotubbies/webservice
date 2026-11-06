// What an ack link is about, shown before the Acknowledge button: priority,
// alarm name, signal, state, age and the value now. Without it an operator on
// a phone acknowledges blind. The preview is a plain GET; it never consumes
// the single-use token.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getToken } from '../../lib/api';
import { live } from '../../lib/live';
import { SIGNALS } from '../../lib/plant';
import { fmtAge } from '../../lib/format';
import { useNow, useStore } from '../../lib/hooks';
import { SeverityBadge } from '../../shared/ui/Status';
import { AlarmStateChip } from './AlarmStateChip';
import './i18n';

export interface AckPreviewAlarm { id: string; rule: string; severity: string; state: string; tag: string; raised_at: string }
export type PreviewState = { kind: 'loading' } | { kind: 'ok'; alarm: AckPreviewAlarm } | { kind: 'used' } | { kind: 'gone' } | { kind: 'none' };

/** 'none' = could not preview (signed out, offline): the page falls back to the plain confirm. */
export function useAckPreview(token: string | undefined): PreviewState {
  const [s, setS] = useState<PreviewState>({ kind: 'loading' });
  useEffect(() => {
    if (!token) { setS({ kind: 'none' }); return; }
    const ctl = new AbortController();
    const headers: Record<string, string> = {};
    const tk = getToken();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    fetch(`/api/v1/ack/${encodeURIComponent(token)}`, { headers, signal: ctl.signal })
      .then(async (res) => {
        if (res.ok) {
          const b = await res.json() as { alarm?: AckPreviewAlarm };
          setS(b.alarm ? { kind: 'ok', alarm: b.alarm } : { kind: 'none' });
        } else if (res.status === 410) setS({ kind: 'used' });
        else if (res.status === 404) setS({ kind: 'gone' });
        else setS({ kind: 'none' });
      })
      .catch(() => { if (!ctl.signal.aborted) setS({ kind: 'none' }); });
    return () => ctl.abort();
  }, [token]);
  return s;
}

export function AckPreview({ alarm }: { alarm: AckPreviewAlarm }) {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const meta = SIGNALS[alarm.tag];
  const tv = live.latest.get(alarm.tag);
  const value = tv && typeof tv.v === 'number' ? `${tv.v.toFixed(meta?.decimals ?? 1)}${meta?.unit ? ` ${meta.unit}` : ''}` : null;
  return (
    <div className="mb-4 rounded-[5px] border border-line bg-subtle p-3 text-left" data-testid="ack-context">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={alarm.severity} />
        <AlarmStateChip state={alarm.state} />
      </div>
      <p className="text-[16px] font-semibold leading-6">{alarm.rule}</p>
      <p className="mt-0.5 text-[12px] text-ink-68">
        {meta && <span className="font-medium text-ink">{t(meta.labelKey)} · </span>}
        <span className="font-mono">{alarm.tag}</span>
      </p>
      <p className="mt-1 text-[12px] text-ink-68">{t('ackp.since', { age: fmtAge(alarm.raised_at, now) })}</p>
      {value && (
        <p className="mt-1 text-[13px]">
          <span className="text-ink-68">{t('ackp.valueNow')}: </span>
          <span className="font-mono text-[18px] font-semibold tabular-nums">{value}</span>
        </p>
      )}
    </div>
  );
}
