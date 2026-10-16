// Downtime classification — phone-first queue of open downtime events
// (needs_reason) grouped into expandable cards. Operator picks a reason from
// the two-level tree, adds an optional note, saves. 390px is the design
// breakpoint: everything is single-column, full-width tappable rows.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { fmtAge } from '../../lib/format';
import { PageBar, PageBody, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { canOperate } from '../../app/session';
import { useAdminOrg, useAdminSite, canAdmin } from '../admin/admin';
import { prodApi, type DtEvent, type ReasonInput, type ReasonRow } from './api';
import './i18n';

const fmtDur = (s: number) => s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}min`;

export function DowntimesPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const canClassify = canOperate(orgRole ?? 'none');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const openOnly = params.get('needs_reason') !== 'all';
  const [reasonMgmt, setReasonMgmt] = useState(false);

  const eventsQ = useQuery({
    queryKey: ['prod-dt', orgId, site?.id, openOnly],
    queryFn: () => prodApi.dtEvents(orgId!, site!.id, { needs_reason: openOnly || undefined }),
    enabled: !!orgId && !!site,
  });
  const reasonsQ = useQuery({
    queryKey: ['prod-reasons', orgId],
    queryFn: () => prodApi.reasons(orgId!), enabled: !!orgId,
  });

  const events = eventsQ.data?.items ?? [];
  const roots = (reasonsQ.data?.items ?? []).filter((r) => !r.parent_id && r.enabled);
  const reasonName = (r: ReasonRow) => (i18n.language === 'th' && r.name_th ? r.name_th : r.name_en);
  const err = eventsQ.error ?? reasonsQ.error;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar icon="pause" title={t('prod.dtTitle')} lede={t('prod.dtLede')}
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={openOnly}
                onChange={(e) => {
                  setParams((p) => { const n = new URLSearchParams(p);
                    if (e.target.checked) n.delete('needs_reason'); else n.set('needs_reason', 'all'); return n; }, { replace: true });
                }} />
              {t('prod.needsReasonOnly')}
            </label>
            {canAdmin(orgRole ?? 'none') && (
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => setReasonMgmt((v) => !v)}>{t('prod.manageReasons')}</button>
            )}
          </>
        }
      />
      <PageBody>
        {!canClassify && <PermissionNotice role="operator">{t('prod.needClassify')}</PermissionNotice>}
        {err && <ErrorState detail={err instanceof ApiError ? err.message : undefined}
          onRetry={() => { void eventsQ.refetch(); void reasonsQ.refetch(); }} />}

        {reasonMgmt && <ReasonManager orgId={orgId!} />}

        {eventsQ.isLoading && <SkeletonRows rows={5} h={56} />}
        {!eventsQ.isLoading && !err && events.length === 0 && (
          <EmptyState icon="check" title={t('prod.dtEmpty')} body={t('prod.dtEmptyBody')} />
        )}
        <ul className="space-y-2" aria-label={t('prod.dtTitle')}>
          {events.map((ev) => (
            <DtCard key={ev.id} orgId={orgId!} siteId={site!.id} ev={ev}
              roots={roots} all={reasonsQ.data?.items ?? []}
              reasonName={reasonName} canClassify={canClassify}
              onSaved={() => void qc.invalidateQueries({ queryKey: ['prod-dt', orgId, site?.id] })} />
          ))}
        </ul>
      </PageBody>
    </div>
  );
}
function DtCard({ orgId, siteId, ev, roots, all, reasonName, canClassify, onSaved }: {
  orgId: string; siteId: string; ev: DtEvent; roots: ReasonRow[]; all: ReasonRow[];
  reasonName: (r: ReasonRow) => string; canClassify: boolean; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState(ev.reason_id ?? '');
  const [note, setNote] = useState(ev.note ?? '');
  const kids = (pid: string) => all.filter((r) => r.parent_id === pid && r.enabled)
    .sort((a, b) => a.sort - b.sort || a.name_en.localeCompare(b.name_en));
  const save = useMutation({
    mutationFn: () => prodApi.classify(orgId, siteId, ev.id,
      { reason_id: reasonId || null, note: note.trim() || undefined }),
    onSuccess: () => { setOpen(false); onSaved(); },
  });

  return (
    <li className="rounded-[5px] border border-line bg-white shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-label={`${ev.device ?? ev.device_id} ${fmtDur(ev.seconds)}`}
        className="flex w-full items-center gap-2 p-3 text-left">
        <span className={`size-2 shrink-0 rounded-full ${ev.needs_reason ? 'bg-[var(--color-caution)]' : 'bg-[var(--color-ok)]'}`}
          aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{ev.device ?? ev.device_id}</span>
          <span className="block text-[11px] text-ink-46">
            {ev.state && <>{t('prod.stopAt', { state: t(`prod.state_${ev.state}`) })}</>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-[13px] font-semibold tabular-nums">{fmtDur(ev.seconds)}</span>
          <span className="block text-[11px] text-ink-46" title={ev.starts_at}>{fmtAge(ev.starts_at)}</span>
        </span>
        <span className={`shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[1px] ${
          ev.needs_reason ? 'bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]' : 'bg-subtle text-ink-68'
        }`}>
          {ev.needs_reason ? t('prod.dtPending') : (ev.reason ?? t('prod.dtClassified'))}
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3">
          <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-ink-46">{t('prod.start')}</dt>
            <dd className="font-mono tabular-nums">{new Date(ev.starts_at).toLocaleString()}</dd>
            <dt className="text-ink-46">{t('prod.end')}</dt>
            <dd className="font-mono tabular-nums">{ev.ends_at ? new Date(ev.ends_at).toLocaleString() : '—'}</dd>
            <dt className="text-ink-46">{t('prod.duration')}</dt>
            <dd className="font-mono tabular-nums">{fmtDur(ev.seconds)}</dd>
            {ev.classified_at && (
              <>
                <dt className="text-ink-46">{t('prod.dtClassified')}</dt>
                <dd className="font-mono tabular-nums">{new Date(ev.classified_at).toLocaleString()}</dd>
              </>
            )}
          </dl>
          {canClassify ? (
            <>
              <label className="block text-[12px] font-semibold text-ink-68" htmlFor={`r-${ev.id}`}>
                {t('prod.reason')}
              </label>
              <select id={`r-${ev.id}`} className="input mt-1 w-full" value={reasonId}
                onChange={(e) => setReasonId(e.target.value)}>
                <option value="">{t('prod.pickReason')}</option>
                {roots.sort((a, b) => a.sort - b.sort).flatMap((root) => {
                  const group = [root, ...kids(root.id)];
                  return group.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.parent_id ? '— ' : ''}{reasonName(r)}
                    </option>
                  ));
                })}
              </select>
              <label className="mt-2 block text-[12px] font-semibold text-ink-68" htmlFor={`n-${ev.id}`}>
                {t('prod.dtNote')}
              </label>
              <textarea id={`n-${ev.id}`} className="input mt-1 w-full" rows={2} value={note}
                onChange={(e) => setNote(e.target.value)} placeholder={t('prod.dtNotePh')} />
              {save.isError && (
                <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t('prod.saveErr')}</p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                  {t('prod.cancel')}
                </button>
                <button type="button" className="btn btn-sm" disabled={save.isPending || (!reasonId && !note.trim())}
                  onClick={() => save.mutate()}>
                  {save.isPending ? t('prod.saving') : t('prod.dtSave')}
                </button>
              </div>
            </>
          ) : ev.note ? <p className="text-[12px] text-ink-68">{ev.note}</p> : null}
        </div>
      )}
    </li>
  );
}

function ReasonManager({ orgId }: { orgId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const reasonsQ = useQuery({ queryKey: ['prod-reasons', orgId], queryFn: () => prodApi.reasons(orgId) });
  const [del, setDel] = useState<ReasonRow | null>(null);
  const [form, setForm] = useState<ReasonInput>({ code: '', name_en: '', name_th: '', sort: 0 });
  const create = useMutation({
    mutationFn: (b: ReasonInput) => prodApi.createReason(orgId, b),
    onSuccess: () => {
      setForm({ code: '', name_en: '', name_th: '', sort: 0 });
      void qc.invalidateQueries({ queryKey: ['prod-reasons', orgId] });
    },
  });
  const delM = useMutation({
    mutationFn: (id: string) => prodApi.deleteReason(orgId, id),
    onSuccess: () => { setDel(null); void qc.invalidateQueries({ queryKey: ['prod-reasons', orgId] }); },
  });
  const items = reasonsQ.data?.items ?? [];
  const nm = (r: ReasonRow) => (i18n.language === 'th' && r.name_th ? r.name_th : r.name_en);

  return (
    <Card title={t('prod.reasonsTitle')}>
      {reasonsQ.isLoading ? <SkeletonRows rows={3} /> : (
        <>
          {(items.length === 0) ? <EmptyState compact title={t('prod.noReasons')} body={t('prod.noReasonsHint')} /> : (
            <div className="overflow-x-auto">
              <Table head={[t('prod.code'), t('prod.nameEn'), t('prod.nameTh'), t('prod.parent'), '']}>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-[12px]">{r.code}</td>
                    <td>{r.parent_id ? '— ' : ''}{r.name_en}</td>
                    <td className="text-ink-68">{r.name_th}</td>
                    <td className="text-[12px] text-ink-68">
                      {r.parent_id ? nm(items.find((x) => x.id === r.parent_id) ?? r) : '—'}
                    </td>
                    <td><button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                      onClick={() => setDel(r)}>{t('prod.delete')}</button></td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 sm:grid-cols-5">
            <input className="input h-8 text-[12px]" placeholder={t('prod.code')} value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} aria-label={t('prod.code')} />
            <input className="input h-8 text-[12px]" placeholder={t('prod.nameEn')} value={form.name_en}
              onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} aria-label={t('prod.nameEn')} />
            <input className="input h-8 text-[12px]" placeholder={t('prod.nameTh')} value={form.name_th}
              onChange={(e) => setForm((f) => ({ ...f, name_th: e.target.value }))} aria-label={t('prod.nameTh')} />
            <select className="input h-8 text-[12px]" value={form.parent_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value || null }))}
              aria-label={t('prod.parent')}>
              <option value="">{t('prod.parentNone')}</option>
              {items.filter((r) => !r.parent_id).map((r) => <option key={r.id} value={r.id}>{nm(r)}</option>)}
            </select>
            <button type="button" className="btn btn-sm" disabled={!form.code.trim() || !form.name_en.trim() || create.isPending}
              onClick={() => create.mutate(form)}>
              {t('prod.addReason')}
            </button>
          </div>
        </>
      )}
      {del && (
        <Confirm danger title={t('prod.deleteReasonTitle')} body={del.name_en}
          confirm={t('prod.delete')}
          onYes={() => delM.mutate(del.id)} onNo={() => setDel(null)} />
      )}
    </Card>
  );
}
