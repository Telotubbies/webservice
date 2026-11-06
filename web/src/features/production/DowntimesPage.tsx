// Downtime classification — phone-first queue of open downtime events
// (needs_reason) grouped into expandable cards. Operator picks a reason from
// the two-level tree, adds an optional note, saves. 390px is the design
// breakpoint: everything is single-column, full-width tappable rows.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ApiError, tagQueryApi } from '../../lib/api';
import { fmtAge, fmtDateTime } from '../../lib/format';
import { PageBar, PageBody, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, PermissionNotice, SkeletonRows } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { canOperate } from '../../app/session';
import { useAdminOrg, useAdminSite, canAdmin } from '../admin/admin';
import { StandardChart } from '../charts/StandardChart';
import { pickSource } from '../charts/source';
import { rowsToSamples, type BucketRow, type RawRow } from '../charts/shape';
import type { ChartHistory } from '../charts/useChartHistory';
import { prodApi, type DtEvent, type ReasonInput, type ReasonRow } from './api';
import './i18n';

import { fmtDuration, localName } from './names';

export function DowntimesPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const canClassify = canOperate(orgRole ?? 'none');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const openOnly = params.get('needs_reason') !== 'all';
  const device = params.get('device') ?? '';
  const reasonFilter = params.get('reason_id') ?? '';
  const shift = params.get('shift') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [reasonMgmt, setReasonMgmt] = useState(false);

  const set = (k: string, v: string) => {
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  };
  const localInput = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const isoParam = (v: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const rangeInvalid = (!!from && isoParam(from) === undefined) || (!!to && isoParam(to) === undefined);

  const eventsQ = useQuery({
    queryKey: ['prod-dt', orgId, site?.id, openOnly, device, reasonFilter, shift, from, to],
    queryFn: () => prodApi.dtEvents(orgId!, site!.id, {
      needs_reason: openOnly || undefined,
      device: device || undefined,
      reason_id: reasonFilter || undefined,
      shift: shift || undefined,
      from: isoParam(from),
      to: isoParam(to),
    }),
    enabled: !!orgId && !!site,
  });
  const reasonsQ = useQuery({
    queryKey: ['prod-reasons', orgId],
    queryFn: () => prodApi.reasons(orgId!), enabled: !!orgId,
  });
  const machinesQ = useQuery({
    queryKey: ['prod-machines', orgId, site?.id],
    queryFn: () => prodApi.machines(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });
  const shiftsQ = useQuery({
    queryKey: ['prod-shifts', orgId, site?.id],
    queryFn: () => prodApi.shifts(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });

  const events = eventsQ.data?.items ?? [];
  const roots = (reasonsQ.data?.items ?? []).filter((r) => !r.parent_id && r.enabled);
  const reasonName = (r: ReasonRow) => (i18n.language === 'th' && r.name_th ? r.name_th : r.name_en);
  const err = eventsQ.error ?? reasonsQ.error ?? machinesQ.error ?? shiftsQ.error;
  const machines = machinesQ.data?.items ?? [];
  const shifts = shiftsQ.data?.items ?? [];
  const activeParts = [
    device ? `${t('prod.dtFilterDevice')}: ${localName(machines.find((x) => x.device_id === device)?.name ?? device, i18n.language)}` : '',
    reasonFilter ? `${t('prod.dtFilterReason')}: ${reasonFilter === 'unclassified' ? t('prod.dtFilterUnclassified') : reasonName((reasonsQ.data?.items ?? []).find((r) => r.id === reasonFilter) ?? { name_en: reasonFilter, name_th: reasonFilter } as ReasonRow)}` : '',
    shift ? `${t('prod.dtFilterShift')}: ${localName(shifts.find((x) => x.id === shift)?.name ?? shift, i18n.language)}` : '',
    from || to ? `${from || '…'} → ${to || '…'}` : '',
  ].filter(Boolean);
  const hasFilters = device || reasonFilter || shift || from || to;

  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
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
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-[12px] text-ink-68">
            <span className="block">{t('prod.dtFilterDevice')}</span>
            <select className="input mt-0.5 h-8 w-auto min-w-[8rem] text-[12px]" value={device}
              onChange={(e) => set('device', e.target.value)}>
              <option value="">{t('prod.dtFilterAll')}</option>
              {machines.map((x) => <option key={x.device_id} value={x.device_id}>{localName(x.name, i18n.language)}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-ink-68">
            <span className="block">{t('prod.dtFilterReason')}</span>
            <select className="input mt-0.5 h-8 w-auto min-w-[8rem] text-[12px]" value={reasonFilter}
              onChange={(e) => set('reason_id', e.target.value)}>
              <option value="">{t('prod.dtFilterAll')}</option>
              <option value="unclassified">{t('prod.dtFilterUnclassified')}</option>
              {(reasonsQ.data?.items ?? []).filter((r) => r.enabled).map((r) => (
                <option key={r.id} value={r.id}>{r.parent_id ? '— ' : ''}{reasonName(r)}</option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-ink-68">
            <span className="block">{t('prod.dtFilterShift')}</span>
            <select className="input mt-0.5 h-8 w-auto min-w-[7rem] text-[12px]" value={shift}
              onChange={(e) => set('shift', e.target.value)}>
              <option value="">{t('prod.dtFilterAll')}</option>
              {shifts.map((x) => <option key={x.id} value={x.id}>{localName(x.name, i18n.language)}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-ink-68">
            <span className="block">{t('prod.dtFilterFrom')}</span>
            <input type="datetime-local" className="input mt-0.5 h-8 w-auto text-[12px]" value={localInput(from)}
              onChange={(e) => set('from', e.target.value ? new Date(e.target.value).toISOString() : '')} />
          </label>
          <label className="text-[12px] text-ink-68">
            <span className="block">{t('prod.dtFilterTo')}</span>
            <input type="datetime-local" className="input mt-0.5 h-8 w-auto text-[12px]" value={localInput(to)}
              onChange={(e) => set('to', e.target.value ? new Date(e.target.value).toISOString() : '')} />
          </label>
          {!!hasFilters && (
            <button type="button" className="btn btn-sm btn-ghost h-8" onClick={() => {
              setParams((p) => { const n = new URLSearchParams(p);
                for (const k of ['device', 'reason_id', 'shift', 'from', 'to']) n.delete(k);
                return n; }, { replace: true });
            }}>{t('prod.dtFilterClear')}</button>
          )}
        </div>
        {!!hasFilters && (
          <p className="mb-2 text-[11px] text-ink-46" role="note">
            {t('prod.dtFilterActive', { parts: activeParts.join(' · ') })}
          </p>
        )}
        {rangeInvalid && (
          <p className="mb-2 text-[11px] text-[var(--color-danger)]" role="alert">{t('prod.dtFilterInvalid')}</p>
        )}
        {!canClassify && <PermissionNotice role="operator">{t('prod.needClassify')}</PermissionNotice>}
        {err && <ErrorState detail={err instanceof ApiError ? err.message : undefined}
          onRetry={() => { void eventsQ.refetch(); void reasonsQ.refetch(); void machinesQ.refetch(); void shiftsQ.refetch(); }} />}

        {reasonMgmt && <ReasonManager orgId={orgId!} />}

        {eventsQ.isLoading && <SkeletonRows rows={5} h={56} />}
        {!eventsQ.isLoading && !err && events.length === 0 && (
          <EmptyState icon="check" title={t('prod.dtEmpty')} body={t('prod.dtEmptyBody')} />
        )}
        <ul className="space-y-2" aria-label={t('prod.dtTitle')}>
          {events.map((ev) => (
            <DtCard key={`${orgId}/${site!.id}/${ev.id}`} orgId={orgId!} siteId={site!.id} ev={ev}
              roots={roots} all={reasonsQ.data?.items ?? []}
              reasonName={reasonName} canClassify={canClassify}
              onSaved={() => void qc.invalidateQueries({ queryKey: ['prod-dt', orgId, site?.id] })} />
          ))}
        </ul>
      </PageBody>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** One downtime event: collapsed summary row, expanded classify form. */
function DtCard({ orgId, siteId, ev, roots, all, reasonName, canClassify, onSaved }: {
  orgId: string; siteId: string; ev: DtEvent; roots: ReasonRow[]; all: ReasonRow[];
  reasonName: (r: ReasonRow) => string; canClassify: boolean; onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const fmtDur = (s: number) => fmtDuration(s, i18n.language);
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
  const ctxQ = useQuery({
    queryKey: ['prod-dt-ctx', orgId, siteId, ev.id],
    queryFn: () => prodApi.dtContext(orgId, siteId, ev.id),
    enabled: open,
  });
  const load = useCallback(async (tag: string, f: number, toMs: number): Promise<ChartHistory> => {
    const plan = pickSource(f, toMs, Date.now());
    const isoMs = (ms: number) => new Date(ms).toISOString();
    if (plan.source !== 'raw') {
      const r = await tagQueryApi.history(orgId, siteId, { tag, from: isoMs(f), to: isoMs(toMs), agg: 'avg', bucket_s: plan.bucketS! });
      return { samples: rowsToSamples(r.rows as BucketRow[]), plan, truncated: false };
    }
    const spans: [number, number][] = [];
    for (let a = f; a < toMs; a += 80 * 60e3) spans.push([a, Math.min(toMs, a + 80 * 60e3)]);
    const res = await Promise.all(spans.map(([a, b]) =>
      tagQueryApi.history(orgId, siteId, { tag, from: isoMs(a), to: isoMs(b), agg: 'raw', limit: 5000 })));
    const seen = new Set<string>();
    const rows = res.flatMap((r) => r.rows as RawRow[]).filter((r) => !seen.has(r.ts) && !!seen.add(r.ts));
    return { samples: rowsToSamples(rows), plan, truncated: res.some((r) => r.rows.length >= 5000) };
  }, [orgId, siteId]);
  const ctx = ctxQ.data;
  const ctxRange: [number, number] | null = ctx ? [Date.parse(ctx.from), Date.parse(ctx.to)] : null;

  return (
    <li className="rounded-[5px] border border-line bg-paper shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-label={`${localName(ev.device, i18n.language) || ev.device_id} ${fmtDur(ev.seconds)}`}
        className="flex w-full items-center gap-2 p-3 text-left">
        <span className={`size-2 shrink-0 rounded-full ${ev.needs_reason ? 'bg-[var(--color-caution)]' : 'bg-[var(--color-ok)]'}`}
          aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{localName(ev.device, i18n.language) || ev.device_id}</span>
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
            <dd className="tabular-nums">{fmtDateTime(ev.starts_at)}</dd>
            <dt className="text-ink-46">{t('prod.end')}</dt>
            <dd className="tabular-nums">{ev.ends_at ? fmtDateTime(ev.ends_at) : '—'}</dd>
            <dt className="text-ink-46">{t('prod.duration')}</dt>
            <dd className="font-mono tabular-nums">{fmtDur(ev.seconds)}</dd>
            {ev.classified_at && (
              <>
                <dt className="text-ink-46">{t('prod.dtClassified')}</dt>
                <dd className="tabular-nums">{fmtDateTime(ev.classified_at)}</dd>
              </>
            )}
          </dl>
          <div className="mb-3" aria-label={t('prod.dtContext')}>
            <h4 className="text-[12px] font-semibold text-ink-68">{t('prod.dtContext')}</h4>
            {ctxQ.isLoading && <SkeletonRows rows={2} h={40} />}
            {ctxQ.isError && (
              <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">
                {t('prod.failed', { reason: 'context' })}{' '}
                <button type="button" className="underline" onClick={() => void ctxQ.refetch()}>{t('common.retry')}</button>
              </p>
            )}
            {ctx && ctxRange && (
              <>
                {ctx.tag ? (
                  <div className="mt-1 min-w-0">
                    <StandardChart
                      key={`${orgId}/${siteId}/${ctx.tag.id}`}
                      tag={ctx.tag.id} label={ctx.tag.name || ctx.tag.path}
                      unit={ctx.tag.unit ?? undefined} decimals={0}
                      range={ctxRange} load={load} height={160}
                      events={ctx.alarms.map((a) => ({ t: Date.parse(a.raised_at), kind: 'alarm' as const, label: a.rule ?? a.tag, severity: a.severity === 'critical' ? 'critical' as const : 'warning' as const }))}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-ink-46">{t('prod.dtNoChart')}</p>
                )}
                <h5 className="mt-2 text-[12px] font-semibold text-ink-68">{t('prod.dtContextAlarms')}</h5>
                {ctx.alarms.length === 0 ? (
                  <p className="mt-1 text-[11px] text-ink-46">{t('prod.dtContextNone')}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {ctx.alarms.map((a) => (
                      <li key={a.id} className="min-w-0 break-words text-[12px]">
                        <span className="font-medium">{a.rule ?? a.tag}</span>
                        <span className="block text-[11px] text-ink-46">
                          {a.tag} · {a.severity} · {fmtDateTime(a.raised_at)}{a.cleared_at ? ` → ${fmtDateTime(a.cleared_at)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {ctx.truncated && <p className="mt-1 text-[11px] text-ink-46" role="note">{t('prod.dtTruncatedAlarms')}</p>}
              </>
            )}
          </div>
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

/** Admin-only editor for the two-level downtime-reason tree. */
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
