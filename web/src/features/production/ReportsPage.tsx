// Reports — on-demand CSV/HTML downloads for the four templates plus
// scheduled daily/weekly/monthly email delivery (backend sweeper enqueues
// send_email jobs). Schedule writes need admin|owner.

import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { PageBar, PageBody, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { Toggle } from '../../shared/ui/Toggle';
import { useAdminOrg, useAdminSite, canAdmin } from '../admin/admin';
import { prodApi, type ReportTemplate, type ScheduleInput, type ScheduleRow } from './api';
import './i18n';

const TEMPLATES: ReportTemplate[] = ['shift', 'daily', 'weekly_oee', 'monthly_alarms'];

import { saveBlob } from '../../lib/saveBlob';

export function ReportsPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const canEdit = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  const dlg = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [del, setDel] = useState<ScheduleRow | null>(null);
  const [downError, setDownError] = useState<string | null>(null);

  const schedQ = useQuery({
    queryKey: ['prod-schedules', orgId],
    queryFn: () => prodApi.schedules(orgId!), enabled: !!orgId,
  });
  const download = useMutation({
    mutationFn: (args: { template: ReportTemplate; format: 'csv' | 'html' }) =>
      prodApi.report(orgId!, args.template, site?.id ?? null, args.format),
    onSuccess: ({ blob, filename }) => { setDownError(null); saveBlob(filename, blob); },
    onError: (e) => setDownError(e instanceof ApiError ? e.message : 'download failed'),
  });
  const save = useMutation({
    mutationFn: (b: ScheduleInput & { id?: string }) =>
      b.id ? prodApi.patchSchedule(orgId!, b.id, b) : prodApi.createSchedule(orgId!, b),
    onSuccess: () => {
      dlg.current?.close(); setEditing(null);
      void qc.invalidateQueries({ queryKey: ['prod-schedules', orgId] });
    },
  });
  const toggle = useMutation({
    mutationFn: (row: ScheduleRow) => prodApi.patchSchedule(orgId!, row.id, { enabled: !row.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prod-schedules', orgId] }),
  });
  const delM = useMutation({
    mutationFn: (id: string) => prodApi.deleteSchedule(orgId!, id),
    onSuccess: () => { setDel(null); void qc.invalidateQueries({ queryKey: ['prod-schedules', orgId] }); },
  });

  const err = schedQ.error ?? save.error ?? toggle.error ?? delM.error;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar icon="download" title={t('prod.repTitle')} lede={t('prod.repLede')} />
      <PageBody>
        {!canEdit && <PermissionNotice role="admin">{t('prod.needSchedule')}</PermissionNotice>}
        {err && <ErrorState detail={err instanceof ApiError ? err.message : undefined}
          onRetry={() => void schedQ.refetch()} />}
        {downError && <Notice tone="warn">{downError}</Notice>}

        <Card title={t('prod.templatesTitle')}>
          <ul className="space-y-2">
            {TEMPLATES.map((tp) => (
              <li key={tp} className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{t(`prod.tmpl_${tp}`)}</div>
                  <div className="text-[12px] text-ink-68">{t(`prod.tmpl_${tp}Desc`)}</div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost"
                  disabled={download.isPending}
                  onClick={() => download.mutate({ template: tp, format: 'csv' })}>
                  {t('prod.csv')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost"
                  disabled={download.isPending}
                  onClick={() => download.mutate({ template: tp, format: 'html' })}>
                  {t('prod.html')}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('prod.schedules')}
          actions={canEdit && (
            <button type="button" className="btn btn-sm" onClick={() => { setEditing(null); dlg.current?.showModal(); }}>
              {t('prod.addSchedule')}
            </button>)}>
          {schedQ.isLoading ? <SkeletonRows rows={3} /> : (schedQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title={t('prod.noSchedules')} body={t('prod.noSchedulesHint')} />
          ) : (
            <div className="overflow-x-auto">
              <Table head={[t('prod.template'), t('prod.to'), t('prod.frequency'), t('prod.enabled'), '']}>
                {schedQ.data!.items.map((row) => (
                  <tr key={row.id}>
                    <td>{t(`prod.tmpl_${row.template}`)}</td>
                    <td className="max-w-[220px] truncate text-[12px]">{row.to_addrs.join(', ')}</td>
                    <td className="text-[12px] text-ink-68">
                      {t('prod.dailyAt')} <span className="font-mono tabular-nums">{row.send_time}</span>
                      {row.send_day != null && ` · ${t('prod.day')} ${row.send_day}`}
                    </td>
                    <td>
                      {canEdit
                        ? <Toggle on={row.enabled} onChange={() => toggle.mutate(row)} label={t('prod.enabled')} />
                        : (row.enabled ? '✓' : '—')}
                    </td>
                    <td className="whitespace-nowrap">
                      {canEdit && <>
                        <button type="button" className="btn btn-sm btn-ghost"
                          onClick={() => { setEditing(row); dlg.current?.showModal(); }}>{t('prod.edit')}</button>
                        <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                          onClick={() => setDel(row)}>{t('prod.delete')}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </PageBody>

      <ScheduleDialog key={editing?.id ?? 'new'} dlgRef={dlg} row={editing}
        siteId={site?.id ?? null} pending={save.isPending}
        onSave={(b) => save.mutate(editing ? { ...b, id: editing.id } : b)} />
      {del && (
        <Confirm danger title={t('prod.deleteScheduleTitle')}
          body={`${t(`prod.tmpl_${del.template}`)} → ${del.to_addrs.join(', ')}`}
          confirm={t('prod.delete')}
          onYes={() => delM.mutate(del.id)} onNo={() => setDel(null)} />
      )}
    </div>
  );
}

function ScheduleDialog({ dlgRef, row, siteId, pending, onSave }: {
  dlgRef: RefObject<HTMLDialogElement | null>;
  row: ScheduleRow | null; siteId: string | null; pending: boolean;
  onSave: (b: ScheduleInput) => void;
}) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<ReportTemplate>(row?.template ?? 'daily');
  const [to, setTo] = useState((row?.to_addrs ?? []).join(', '));
  const [sendTime, setSendTime] = useState(row?.send_time ?? '07:00');
  const [sendDay, setSendDay] = useState(row?.send_day == null ? '' : String(row.send_day));
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const close = () => dlgRef.current?.close();
  const addrs = to.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <dialog ref={dlgRef}
      className="m-auto w-[min(440px,94vw)] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40"
      aria-labelledby="rs-title">
      <form method="dialog" className="p-4" onSubmit={(e) => {
        e.preventDefault();
        onSave({
          template, site_id: siteId, to_addrs: addrs,
          send_time: sendTime,
          send_day: sendDay === '' ? null : Number(sendDay),
          enabled,
        });
      }}>
        <h2 id="rs-title" className="mb-3 text-[15px] font-semibold">
          {row ? t('prod.editSchedule') : t('prod.addSchedule')}
        </h2>
        <label className="block text-[12px] font-semibold text-ink-68" htmlFor="rs-tpl">{t('prod.template')}</label>
        <select id="rs-tpl" className="input mt-1 w-full" value={template}
          onChange={(e) => setTemplate(e.target.value as ReportTemplate)}>
          {TEMPLATES.map((tp) => <option key={tp} value={tp}>{t(`prod.tmpl_${tp}`)}</option>)}
        </select>
        <label className="mt-3 block text-[12px] font-semibold text-ink-68" htmlFor="rs-to">{t('prod.to')}</label>
        <input id="rs-to" className="input mt-1 w-full" value={to} onChange={(e) => setTo(e.target.value)}
          placeholder={t('prod.toAddrsPh')} required />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="rs-time">{t('prod.sendTime')}</label>
            <input id="rs-time" type="time" className="input mt-1 w-full" value={sendTime}
              onChange={(e) => setSendTime(e.target.value)} required />
            <p className="mt-0.5 text-[11px] text-ink-46">{t('prod.sendTimeHint')}</p>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="rs-day">{t('prod.sendDay')}</label>
            <input id="rs-day" type="number" min={1} max={31} className="input mt-1 w-full" value={sendDay}
              onChange={(e) => setSendDay(e.target.value)} />
            <p className="mt-0.5 text-[11px] text-ink-46">{t('prod.sendDayHint')}</p>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('prod.enabled')}
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>{t('prod.cancel')}</button>
          <button type="submit" className="btn btn-sm" disabled={pending || addrs.length === 0}>
            {t('prod.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
