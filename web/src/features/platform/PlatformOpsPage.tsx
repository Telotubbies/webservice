// Support sessions + announcements management (roadmap §11 7.2/7.3).
// /platform/support and /platform/announcements share this page's tabs.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import './i18n';
import { isPlatformDenied, platformApi } from './api';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState, Notice } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

export function PlatformSupportPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-sessions'], queryFn: () => platformApi.sessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => platformApi.revokeSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-sessions'] }),
  });
  const denied = q.isError && isPlatformDenied(q.error);
  return (
    <>
      <PageBar title={t('plat.supportSessions')} back={{ to: '/platform', label: t('plat.platformTitle') }} />
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        {denied ? <Notice tone="warn">{t('plat.denied')}</Notice>
          : q.isPending ? <PageSkeleton />
          : q.isError ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
          : (
            <Card pad={false}>
              <Table head={[t('plat.org'), t('plat.reason'), t('plat.expires'), t('plat.active'), '']}>
                {(q.data?.items ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.org_name ?? s.org_id}</td>
                    <td>{s.reason}</td>
                    <td className="text-[12px]">{fmt(s.expires_at)}</td>
                    <td>{s.active ? t('plat.active') : t('plat.ended')}</td>
                    <td>{s.active && (
                      <button type="button" className="btn h-7 text-[12px] text-[var(--color-danger)]"
                              onClick={() => revoke.mutate(s.id)}>{t('plat.revoke')}</button>)}
                    </td>
                  </tr>))}
              </Table>
            </Card>)}
      </div>
    </>
  );
}

export function PlatformAnnouncementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');
  const [orgId, setOrgId] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const orgs = useQuery({ queryKey: ['platform-orgs'], queryFn: platformApi.orgs });
  const q = useQuery({ queryKey: ['platform-ann'], queryFn: platformApi.announcements });
  const inv = () => void qc.invalidateQueries({ queryKey: ['platform-ann'] });
  const create = useMutation({
    mutationFn: () => platformApi.createAnnouncement({
      title, body, severity, org_id: orgId || null, ends_at: endsAt || null,
    }),
    onSuccess: () => { setTitle(''); setBody(''); inv(); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => platformApi.revokeAnnouncement(id), onSuccess: inv,
  });
  const denied = q.isError && isPlatformDenied(q.error);
  return (
    <>
      <PageBar title={t('plat.announcements')} back={{ to: '/platform', label: t('plat.platformTitle') }} />
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        {denied ? <Notice tone="warn">{t('plat.denied')}</Notice> : (
        <>
          <Card title={t('plat.annCreate')}>
            <div className="flex flex-col gap-2 text-[13px]">
              <input className="input h-9" placeholder={t('plat.annTitle')}
                     value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea className="input" rows={2} placeholder={t('plat.annBody')}
                        value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex flex-wrap items-center gap-3">
                <Segmented value={severity} onChange={(s) => setSeverity(s)}
                           label={t('plat.severity')}
                           options={[
                             { value: 'info', label: t('plat.sevInfo') },
                             { value: 'warning', label: t('plat.sevWarning') },
                             { value: 'critical', label: t('plat.sevCritical') },
                           ]} />
                <select className="input h-9 text-[13px]" value={orgId}
                        onChange={(e) => setOrgId(e.target.value)}>
                  <option value="">{t('plat.allOrgs')}</option>
                  {(orgs.data?.items ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
                <input className="input h-9 font-mono text-[12px]" placeholder={t('plat.annEnd')}
                       value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
              {create.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(create.error) })}</Notice>}
              <button type="button" className="btn btn-primary h-9 w-fit text-[13px] font-semibold"
                      disabled={create.isPending || !title.trim()} onClick={() => create.mutate()}>
                {t('plat.annCreate')}
              </button>
            </div>
          </Card>
          {q.isPending ? <PageSkeleton rows={3} />
            : q.isError ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
            : (
              <Card pad={false}>
                <Table head={[t('plat.annTitle'), t('plat.severity'), t('plat.org'), t('plat.expires'), '']}>
                  {(q.data?.items ?? []).length === 0 && (
                    <tr><td colSpan={5} className="text-ink-68">{t('plat.annNone')}</td></tr>)}
                  {(q.data?.items ?? []).map((a) => (
                    <tr key={a.id} className={a.revoked ? 'opacity-50' : ''}>
                      <td>{a.title}<div className="text-[11px] text-ink-46">{a.body}</div></td>
                      <td>{a.severity}</td>
                      <td>{a.org_name ?? t('plat.allOrgs')}</td>
                      <td className="text-[12px]">{fmt(a.ends_at)}</td>
                      <td>{!a.revoked && (
                        <button type="button" className="btn h-7 text-[12px] text-[var(--color-danger)]"
                                onClick={() => revoke.mutate(a.id)}>{t('plat.revoke')}</button>)}
                      </td>
                    </tr>))}
                </Table>
              </Card>)}
        </>)}
      </div>
    </>
  );
}
