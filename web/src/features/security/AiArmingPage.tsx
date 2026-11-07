// AI write approval per site (F21): AI may write to a PLC from this site only while a person has
// armed it, with a reference to what they reviewed. Dry-run stays the default either way.
// Backend: backend/app/vision/arming.py.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { usePrimaryScope } from '../admin/admin';
import { ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { PageBar, Card } from '../../shared/ui/Page';
import './armingI18n';

interface Arming { armed: boolean; arming: { armed_at: string; evidence_ref: string } | null }

export function AiArmingPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const qc = useQueryClient();
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const url = `/api/v1/orgs/${encodeURIComponent(orgId ?? '')}/sites/${siteId}/ai-arming`;
  const q = useQuery({ queryKey: ['ai-arming', orgId, siteId], enabled: !!orgId && !!siteId, queryFn: () => request<Arming>(url) });
  const done = () => { setMsg(null); setEvidence(''); void qc.invalidateQueries({ queryKey: ['ai-arming', orgId, siteId] }); };
  const fail = (e: unknown) => setMsg(String(e instanceof Error ? e.message : e));
  const arm = useMutation({ mutationFn: () => request(url, { method: 'POST', body: JSON.stringify({ evidence_ref: evidence }), headers: { 'Content-Type': 'application/json' } }), onSuccess: done, onError: fail });
  const disarm = useMutation({ mutationFn: () => request(url, { method: 'DELETE' }), onSuccess: done, onError: fail });
  return (
    <>
      <PageBar title={t('arm.title')} lede={t('arm.lede')} />
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {msg && <Notice tone="error">{msg}</Notice>}
        {q.isError ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
          : q.isLoading ? <SkeletonRows rows={3} /> : (
          <Card title={q.data?.armed ? t('arm.armed') : t('arm.notArmed')}>
            {q.data?.armed ? (
              <div className="space-y-3 text-[13px]">
                <p>{t('arm.since', { when: new Date(q.data.arming!.armed_at).toLocaleString() })}</p>
                <p>{t('arm.evidence')}: <span className="font-mono text-[12px]">{q.data.arming!.evidence_ref}</span></p>
                <button type="button" className="btn btn-sm" disabled={disarm.isPending} onClick={() => disarm.mutate()}>{t('arm.disarm')}</button>
              </div>
            ) : (
              <div className="space-y-3 text-[13px]">
                <p>{t('arm.explain')}</p>
                <label className="block">{t('arm.evidence')}
                  <input className="input mt-1 w-full" value={evidence} placeholder={t('arm.evidencePh')} onChange={(e) => setEvidence(e.target.value)} />
                </label>
                <button type="button" className="btn btn-sm" disabled={evidence.trim().length < 3 || arm.isPending} onClick={() => arm.mutate()}>{t('arm.arm')}</button>
              </div>)}
          </Card>)}
        <p className="text-[12px] text-ink-68">{t('arm.note')}</p>
      </div>
    </>
  );
}
