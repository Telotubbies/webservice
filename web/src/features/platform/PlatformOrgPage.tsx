// Tenant detail — plan/limits/trial patching, suspend/restore, feature
// flags, support-session issue (roadmap §11 7.1–7.3). /platform/orgs/:id

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import './i18n';
import { isPlatformDenied, platformApi } from './api';
import { PageBar, Card } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState, Notice } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { Segmented } from '../../shared/ui/Segmented';

const PLANS = ['trial', 'starter', 'pro', 'enterprise'] as const;

export function PlatformOrgPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['platform-org', id], queryFn: () => platformApi.org(id),
    enabled: !!id,
  });
  const flags = useQuery({
    queryKey: ['platform-flags', id], queryFn: () => platformApi.flags(id),
    enabled: !!id,
  });
  const [plan, setPlan] = useState<string>('trial');
  const [limits, setLimits] = useState('{}');
  const [trial, setTrial] = useState('');
  const [flagsText, setFlagsText] = useState('{}');
  const [reason, setReason] = useState('');
  const [sessionReason, setSessionReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  useEffect(() => {
    if (q.data?.org) {
      setPlan(q.data.org.plan);
      setLimits(JSON.stringify(q.data.org.plan_limits ?? {}, null, 2));
      setTrial(q.data.org.trial_ends_at ?? '');
    }
    if (flags.data) setFlagsText(JSON.stringify(flags.data.flags, null, 2));
  }, [q.data, flags.data]);

  const inv = () => {
    void qc.invalidateQueries({ queryKey: ['platform-org', id] });
    void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
  };
  const patch = useMutation({
    mutationFn: () => platformApi.patchOrg(id, {
      plan, limits: JSON.parse(limits || '{}'), trial_ends_at: trial || '',
    }),
    onSuccess: inv,
  });
  const suspend = useMutation({
    mutationFn: () => platformApi.suspend(id, reason), onSuccess: inv,
  });
  const unsuspend = useMutation({ mutationFn: () => platformApi.unsuspend(id), onSuccess: inv });
  const saveFlags = useMutation({
    mutationFn: () => platformApi.setFlags(id, JSON.parse(flagsText || '{}')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-flags', id] }),
  });
  const issue = useMutation({
    mutationFn: () => platformApi.issueSession(id, { reason: sessionReason, minutes }),
  });

  const denied = q.isError && isPlatformDenied(q.error);
  const o = q.data?.org;
  return (
    <>
      <PageBar title={o ? o.name : t('plat.tenants')}
               back={{ to: '/platform', label: t('plat.tenants') }} />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {denied ? <Notice tone="warn">{t('plat.denied')}</Notice>
          : q.isPending ? <PageSkeleton rows={4} />
          : q.isError || !o ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
          : (
          <>
            {o.suspended && <Notice tone="error">{t('plat.suspended')}: {o.suspended_reason ?? ''}</Notice>}
            {o.deleted && <Notice tone="warn">{t('plat.deletedBadge')}</Notice>}
            <Card title={t('plat.setPlan')}>
              <div className="flex flex-col gap-3 text-[13px]">
                <Segmented value={plan} onChange={(l) => setPlan(l)} label={t('plat.planCol')}
                           options={PLANS.map((p): { value: string; label: string } => ({ value: p, label: p }))} />
                <label className="flex flex-col gap-1">
                  <span className="text-ink-68">{t('plat.limitsJson')}</span>
                  <textarea className="input font-mono text-[12px]" rows={4}
                            value={limits} onChange={(e) => setLimits(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-68">{t('plat.trialUntil')}</span>
                  <input className="input h-9 font-mono text-[12px]" value={trial}
                         onChange={(e) => setTrial(e.target.value)}
                         placeholder="2026-12-31T00:00:00Z" />
                </label>
                {patch.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(patch.error) })}</Notice>}
                {patch.isSuccess && <Notice tone="ok">{t('plat.saved')}</Notice>}
                <button type="button" className="btn btn-primary h-9 w-fit text-[13px] font-semibold"
                        disabled={patch.isPending} onClick={() => patch.mutate()}>
                  {t('plat.savePlan')}
                </button>
              </div>
            </Card>

            <Card title={o.suspended ? t('plat.unsuspend') : t('plat.suspend')}>
              {o.suspended ? (
                <button type="button" className="btn btn-primary h-9 text-[13px] font-semibold"
                        disabled={unsuspend.isPending} onClick={() => unsuspend.mutate()}>
                  {t('plat.unsuspend')}
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <input className="input h-9 text-[13px]" placeholder={t('plat.suspendReason')}
                         value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className="btn h-9 w-fit text-[13px] font-semibold text-[var(--color-danger)]"
                          onClick={() => setConfirmSuspend(true)}>
                    {t('plat.suspend')}
                  </button>
                </div>)}
            </Card>

            <Card title={t('plat.issueSession')}>
              <div className="flex flex-col gap-2 text-[13px]">
                <input className="input h-9" placeholder={t('plat.reason')}
                       value={sessionReason} onChange={(e) => setSessionReason(e.target.value)} />
                <input className="input h-9 w-40" type="number" min={5} max={60}
                       value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                {issue.isSuccess && <Notice tone="ok">{t('plat.sessionOpened')}</Notice>}
                {issue.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(issue.error) })}</Notice>}
                <button type="button" className="btn h-9 w-fit text-[13px] font-semibold"
                        disabled={issue.isPending || sessionReason.trim().length < 3}
                        onClick={() => issue.mutate()}>
                  {t('plat.issueSession')}
                </button>
              </div>
            </Card>

            <Card title={t('plat.flagsTitle')}>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-[13px]">
                  <span className="text-ink-68">{t('plat.flagsJson')}</span>
                  <textarea className="input font-mono text-[12px]" rows={4}
                            value={flagsText} onChange={(e) => setFlagsText(e.target.value)} />
                </label>
                {saveFlags.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(saveFlags.error) })}</Notice>}
                {saveFlags.isSuccess && <Notice tone="ok">{t('plat.saved')}</Notice>}
                <button type="button" className="btn h-9 w-fit text-[13px] font-semibold"
                        disabled={saveFlags.isPending} onClick={() => saveFlags.mutate()}>
                  {t('plat.saveFlags')}
                </button>
              </div>
            </Card>
          </>)}
      </div>
      {confirmSuspend && (
        <Confirm title={`${t('plat.suspend')} ${o?.name ?? ''}?`}
                 body={reason} confirm={t('plat.suspend')} danger
                 onYes={() => { setConfirmSuspend(false); suspend.mutate(); }}
                 onNo={() => setConfirmSuspend(false)} />)}
    </>
  );
}
