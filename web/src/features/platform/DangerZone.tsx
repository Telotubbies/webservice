// Org danger zone + data export (roadmap §5 1.6, §12 8.2) — leave, owner
// soft-delete with 30-day restore, owner export zip request/download,
// webhook endpoints, and the tenant view of support sessions.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import './i18n';
import { WEBHOOK_EVENTS, planApi, type ExportRow } from './api';
import { useAdminOrg } from '../admin/admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState, Notice } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { saveBlob } from '../../lib/saveBlob';

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const kb = (n: number | null) => (n == null ? '—' : `${(n / 1024).toFixed(0)} KB`);

function Exports({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['org-exports', orgId],
    queryFn: () => planApi.exports(orgId),
    enabled: isOwner,
    refetchInterval: 15_000,
  });
  const req = useMutation({
    mutationFn: () => planApi.requestExport(orgId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['org-exports', orgId] }),
  });
  const rows = q.data?.items ?? [];
  return (
    <Card title={t('plat.exportTitle')} pad={false}
          actions={isOwner && (
            <button type="button" className="btn h-8 text-[12px] font-semibold"
                    disabled={req.isPending} onClick={() => req.mutate()}>
              {t('plat.requestExport')}
            </button>
          )}>
      {req.isSuccess && <Notice tone="ok">{t('plat.exportQueued')}</Notice>}
      {req.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(req.error) })}</Notice>}
      <Table head={[t('plat.exportStatus'), t('plat.exportReady'), t('plat.expires'), '']}>
        {rows.length === 0 && (
          <tr><td colSpan={4} className="text-ink-68">{t('plat.webhookNone')}</td></tr>)}
        {rows.map((r: ExportRow) => (
          <tr key={r.id}>
            <td>{r.status === 'done' ? t('plat.exportReady') : r.status}</td>
            <td>{r.status === 'done' ? kb(r.size_bytes) : '—'}</td>
            <td>{fmt(r.expires_at)}</td>
            <td>{r.status === 'done' && (
              <button type="button" className="btn h-7 text-[12px]"
                      onClick={() => void planApi.exportDownload(orgId, r.id)
                        .then((b) => saveBlob(`wds-export-${orgId}.zip`, b))}>
                {t('plat.download')}
              </button>)}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Webhooks({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set(['alarm_raised']));
  const [secret, setSecret] = useState<string | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['org-webhooks', orgId],
    queryFn: () => planApi.webhooks(orgId), enabled: canWrite,
  });
  const add = useMutation({
    mutationFn: () => planApi.createWebhook(orgId, { url, events: [...events] }),
    onSuccess: (d) => {
      setSecret(d.secret); setUrl('');
      void qc.invalidateQueries({ queryKey: ['org-webhooks', orgId] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => planApi.deleteWebhook(orgId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['org-webhooks', orgId] }),
  });
  return (
    <Card title={t('plat.webhooksTitle')} pad={false}>
      {secret && <Notice tone="ok">{t('plat.webhookSecretOnce')}<br />
        <code className="font-mono text-[12px]">{secret}</code></Notice>}
      {add.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(add.error) })}</Notice>}
      {del.isError && <Notice tone="error">{t('plat.errGeneric', { reason: String(del.error) })}</Notice>}
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 px-4 py-3">
          <input className="input h-9 flex-1 text-[13px]" placeholder={t('plat.webhookUrl')}
                 value={url} onChange={(e) => setUrl(e.target.value)} />
          {url && !url.startsWith('https://') && (
            <p className="basis-full text-[11px] text-[var(--color-danger)]">{t('plat.webhookHttps')}</p>)}
          <div className="flex flex-wrap gap-2 text-[12px]">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1">
                <input type="checkbox" checked={events.has(ev)}
                       onChange={(e) => {
                         const n = new Set(events);
                         e.target.checked ? n.add(ev) : n.delete(ev);
                         setEvents(n);
                       }} />
                {ev}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary h-9 text-[13px] font-semibold"
                  disabled={add.isPending || !url.startsWith('https://') || events.size === 0}
                  onClick={() => add.mutate()}>
            {t('plat.webhookAdd')}
          </button>
        </div>)}
      <Table head={[t('plat.webhookUrl'), t('plat.webhookEvents'), '']}>
        {(list.data?.items ?? []).length === 0 && (
          <tr><td colSpan={3} className="text-ink-68">{t('plat.webhookNone')}</td></tr>)}
        {(list.data?.items ?? []).map((w) => (
          <tr key={w.id}>
            <td className="max-w-[24rem] truncate font-mono text-[12px]">{w.url}</td>
            <td className="text-[12px]">{w.events.join(', ')}</td>
            <td>{canWrite && (
              <button type="button" className="btn h-7 text-[12px] text-[var(--color-danger)]"
                      onClick={() => setDelId(w.id)}>{t('plat.webhookDelete')}</button>)}
            </td>
          </tr>
        ))}
      </Table>
      {delId && (
        <Confirm title={t('plat.webhookDeleteTitle')} body={t('plat.webhookDeleteBody')}
                 confirm={t('plat.webhookDelete')} danger
                 onYes={() => { const id = delId; setDelId(null); del.mutate(id); }}
                 onNo={() => setDelId(null)} />)}
    </Card>
  );
}

export function DangerZone() {
  const { t } = useTranslation();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();
  const myOrgs = useQuery({ queryKey: ['my-orgs'], queryFn: planApi.myOrgs });
  const mine = (myOrgs.data?.items ?? []).find((o) => o.org_id === orgId);
  const isOwner = orgRole === 'owner';
  const canWrite = orgRole === 'owner' || orgRole === 'admin';

  const leave = useMutation({ mutationFn: () => planApi.leave(orgId!) });
  const del = useMutation({ mutationFn: () => planApi.deleteOrg(orgId!) });
  const restore = useMutation({
    mutationFn: () => planApi.restoreOrg(orgId!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-orgs'] }),
  });
  const sessions = useQuery({
    queryKey: ['org-support', orgId],
    queryFn: () => planApi.supportSessions(orgId!), enabled: !!orgId && isOwner,
  });

  if (loading || !orgId) {
    return <><PageBar title={t('plat.dangerTitle')} /><div className="p-4"><PageSkeleton /></div></>;
  }
  return (
    <>
      <PageBar title={t('plat.dangerTitle')} />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {myOrgs.isError ? <Card pad={false}><ErrorState onRetry={() => void myOrgs.refetch()} /></Card> : (
          <>
            {mine?.deleted && <Notice tone="warn">{t('plat.deletedBadge')}</Notice>}
            {mine?.suspended && <Notice tone="error">{t('plat.suspended')}</Notice>}
            <Exports orgId={orgId} isOwner={isOwner} />
            <Webhooks orgId={orgId} canWrite={!!canWrite} />
            {isOwner && (
              <Card title={t('plat.supportTitle')} pad={false}>
                <p className="px-4 pt-3 text-[12px] text-ink-68">{t('plat.supportBody')}</p>
                <Table head={[t('plat.name'), t('plat.reason'), t('plat.expires'), '']}>
                  {(sessions.data?.items ?? []).length === 0 && (
                    <tr><td colSpan={4} className="text-ink-68">{t('plat.supportNone')}</td></tr>)}
                  {(sessions.data?.items ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>{s.admin}</td><td>{s.reason}</td><td>{fmt(s.expires_at)}</td>
                      <td>{s.active ? t('plat.active') : t('plat.ended')}</td>
                    </tr>
                  ))}
                </Table>
              </Card>)}
            <Card title={t('plat.dangerTitle')}>
              {restore.isSuccess && <Notice tone="ok">{t('plat.restoreDone')}</Notice>}
              {mine?.deleted ? (
                isOwner && (
                  <button type="button" className="btn btn-primary h-9 text-[13px] font-semibold"
                          disabled={restore.isPending} onClick={() => restore.mutate()}>
                    {t('plat.restore')}
                  </button>)
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn h-9 text-[13px] font-semibold"
                          onClick={() => setConfirmLeave(true)}>{t('plat.leave')}</button>
                  {isOwner && (
                    <button type="button" className="btn h-9 text-[13px] font-semibold text-[var(--color-danger)]"
                            onClick={() => setConfirmDelete(true)}>{t('plat.deleteOrg')}</button>)}
                </div>)}
            </Card>
          </>)}
      </div>
      {confirmLeave && (
        <Confirm title={t('plat.leaveTitle', { name: orgName ?? orgId })}
                 body={t('plat.leaveBody')} confirm={t('plat.leave')} danger
                 onYes={() => { setConfirmLeave(false); leave.mutate(); }}
                 onNo={() => setConfirmLeave(false)} />)}
      {confirmDelete && (
        <Confirm title={t('plat.deleteTitle', { name: orgName ?? orgId })}
                 body={t('plat.deleteBody')} confirm={t('plat.deleteOrg')} danger
                 onYes={() => { setConfirmDelete(false); del.mutate(); }}
                 onNo={() => setConfirmDelete(false)} />)}
    </>
  );
}
