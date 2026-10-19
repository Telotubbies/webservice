// Single-use ack-link landing page (roadmap §7 3.4). A phone opens
// /ack/<token> from the notification message; the page POSTs the token to
// the API. Outcomes:
//   200          -> acknowledged, link to the alarm detail
//   401 auth_required -> session expired: surface the sign-in wall via the
//                        shared unauthorized handler — the token is NOT
//                        consumed, so sign-in-then-retry keeps working
//   410          -> already used or expired
//   404          -> bad signature / unknown link

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { getToken, onUnauthorized } from '../../lib/api';
import { Card } from '../../shared/ui/Page';
import { PageSkeleton } from '../../shared/ui/Feedback';
import './i18n';

type Phase = 'ready' | 'working' | 'acked' | 'auth' | 'gone' | 'used' | 'error';

export function AckLinkPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [phase, setPhase] = useState<Phase>('ready');
  const [alarmId, setAlarmId] = useState<string | null>(null);
  // The token is single-use, so the effect must not fire twice — this ref
  // survives StrictMode's double-invoke where a state flag would not.
  const fired = useRef(false);

  // Opening the link must never acknowledge: chat and SMS previewers fetch
  // URLs on their own. Only the tap below sends the POST.
  const commit = () => {
    if (fired.current || !token) return;
    fired.current = true;
    setPhase('working');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const tk = getToken();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    void fetch(`/api/v1/ack/${encodeURIComponent(token)}`, { method: 'POST', headers })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as { alarm?: { id?: string }; detail?: string } | null;
        if (res.ok) { setAlarmId(body?.alarm?.id ?? null); setPhase('acked'); return; }
        if (res.status === 401) { setPhase('auth'); onUnauthorized?.(); return; }
        if (res.status === 410) { setPhase('used'); return; }
        if (res.status === 404) { setPhase('gone'); return; }
        setPhase('error');
      })
      .catch(() => setPhase('error'));
  };

  const retry = () => { fired.current = false; commit(); };

  return (
    <div className="grid min-h-[calc(100svh-36px)] place-items-center p-4">
      <div className="w-full max-w-sm">
      <Card>
        {phase === 'ready' && (
          <div className="text-center">
            <p className="text-[14px] font-semibold">{t('ack.confirmTitle')}</p>
            <p className="mt-1 text-[12px] text-ink-68">{t('ack.confirmBody')}</p>
            <button type="button" className="btn mt-4 min-h-12 w-full justify-center text-[15px]" onClick={commit}>{t('ack.confirmBtn')}</button>
          </div>
        )}
        {phase === 'working' && <PageSkeleton rows={2} />}
        {phase === 'acked' && (
          <div className="text-center">
            <p className="text-[16px] font-semibold text-[var(--color-ok)]">{t('ack.ok')}</p>
            {alarmId && <p className="mt-2"><Link className="text-blue hover:underline" to={`/alarms/${alarmId}`}>{t('ack.open')}</Link></p>}
          </div>
        )}
        {phase === 'auth' && (
          <div className="text-center">
            <p className="text-[14px] font-semibold">{t('ack.signin')}</p>
            <p className="mt-1 text-[12px] text-ink-68">{t('ack.signinBody')}</p>
            <button type="button" className="btn btn-sm mt-3" onClick={retry}>{t('ack.retry')}</button>
          </div>
        )}
        {phase === 'used' && <p className="text-center text-[14px] font-semibold">{t('ack.used')}</p>}
        {phase === 'gone' && <p className="text-center text-[14px] font-semibold">{t('ack.gone')}</p>}
        {phase === 'error' && (
          <div className="text-center">
            <p className="text-[14px] font-semibold">{t('ack.err')}</p>
            <button type="button" className="btn btn-sm mt-3" onClick={retry}>{t('ack.retry')}</button>
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}
