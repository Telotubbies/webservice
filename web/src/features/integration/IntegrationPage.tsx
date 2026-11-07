// Integration (F18): outbox deliveries to ERP/webhooks (replay or discard the dead ones),
// closed shift/hour totals with CSV export, and the site's data origin.
// Backend: backend/app/integration/routes.py.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, requestBlob } from '../../lib/api';
import { saveBlob } from '../../lib/saveBlob';
import { usePrimaryScope } from '../admin/admin';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import './i18n';

type Status = 'pending' | 'sent' | 'dead';
interface Row { id: number; event_type: string; status: Status; attempts: number; last_code: number | null; last_error: string | null; created_at: string; next_try_at: string }
interface Summary { machine: string; shift_name?: string; hour_start?: string; from_ts?: string; version: number; qty_total: number; qty_good: number; qty_scrap: number; run_s: number; stop_s: number; coverage_pct: number; data_origin: string }
const ORIGINS = ['production', 'demo', 'simulated', 'test'] as const;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export function IntegrationPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'' | Status>('');
  const [kind, setKind] = useState<'shift' | 'hour'>('shift');
  const [msg, setMsg] = useState<string | null>(null);
  const org = `/api/v1/orgs/${encodeURIComponent(orgId ?? '')}`;
  const outbox = useQuery({
    queryKey: ['int-outbox', orgId, filter], enabled: !!orgId, refetchInterval: 15_000,
    queryFn: () => request<{ counts: Record<string, number>; items: Row[] }>(`${org}/integration/outbox${filter ? `?status=${filter}` : ''}`),
  });
  const sums = useQuery({
    queryKey: ['int-sums', orgId, siteId, kind], enabled: !!orgId && !!siteId,
    queryFn: () => request<{ items: Summary[] }>(`${org}/sites/${siteId}/summaries?kind=${kind}`),
  });
  const fail = (e: unknown) => setMsg(String(e instanceof Error ? e.message : e));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['int-outbox', orgId] });
  const replay = useMutation({ mutationFn: (id: number) => request(`${org}/integration/outbox/${id}/replay`, { method: 'POST' }), onSuccess: refresh, onError: fail });
  const discard = useMutation({ mutationFn: (id: number) => request(`${org}/integration/outbox/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  const origin = useMutation({ mutationFn: (o: string) => request(`${org}/sites/${siteId}/data-origin`, json('PUT', { data_origin: o })), onError: fail, onSuccess: () => setMsg(null) });
  const exportCsv = async () => {
    try { const { blob } = await requestBlob(`${org}/sites/${siteId}/summaries?kind=${kind}&format=csv`); saveBlob(`${kind}-summaries.csv`, blob); } catch (e) { fail(e); }
  };
  const c = outbox.data?.counts ?? {};
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="database" title={t('int.title')} lede={t('int.lede')} />
      <div className="flex-1 space-y-5 p-4">
        {msg && <Notice tone="error">{msg}</Notice>}
        <section aria-label={t('int.outbox')} className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <h2 className="font-medium">{t('int.outbox')}</h2>
            {(['pending', 'sent', 'dead'] as const).map((s) => <span key={s} className={s === 'dead' && (c[s] ?? 0) > 0 ? 'text-[var(--color-danger)]' : 'text-ink-68'}>{t(`int.st_${s}`)} {c[s] ?? 0}</span>)}
            <select className="input h-8" aria-label={t('int.filter')} value={filter} onChange={(e) => setFilter(e.target.value as '' | Status)}>
              <option value="">{t('int.all')}</option>
              {(['pending', 'sent', 'dead'] as const).map((s) => <option key={s} value={s}>{t(`int.st_${s}`)}</option>)}
            </select>
          </div>
          {outbox.isError ? <ErrorState onRetry={() => void outbox.refetch()} />
            : outbox.isLoading ? <SkeletonRows rows={4} />
            : !outbox.data?.items.length ? <EmptyState icon="info" title={t('int.noOutbox')} /> : (
            <div className="overflow-x-auto rounded-[5px] border border-line bg-paper">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left text-[11px] text-ink-68">
                  {['when', 'event', 'status', 'attempts', 'error', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h ? t(`int.col_${h}`) : ''}</th>)}
                </tr></thead>
                <tbody>{outbox.data.items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-1">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-1 font-mono text-[12px]">{r.event_type}</td>
                    <td className={`px-3 py-1 ${r.status === 'dead' ? 'text-[var(--color-danger)]' : ''}`}>{t(`int.st_${r.status}`)}</td>
                    <td className="px-3 py-1 tabular-nums">{r.attempts}</td>
                    <td className="px-3 py-1 text-[12px] text-ink-68">{r.last_error ?? '—'}</td>
                    <td className="px-3 py-1 whitespace-nowrap">{r.status === 'dead' && <>
                      <button type="button" className="btn btn-sm" onClick={() => replay.mutate(r.id)}>{t('int.replay')}</button>{' '}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => discard.mutate(r.id)}>{t('int.discard')}</button></>}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </section>
        <section aria-label={t('int.summaries')} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <h2 className="font-medium">{t('int.summaries')}</h2>
            <select className="input h-8" aria-label={t('int.summaries')} value={kind} onChange={(e) => setKind(e.target.value as 'shift' | 'hour')}>
              <option value="shift">{t('int.kind_shift')}</option><option value="hour">{t('int.kind_hour')}</option>
            </select>
            <button type="button" className="btn btn-sm" disabled={!siteId} onClick={() => void exportCsv()}>{t('int.exportCsv')}</button>
            <label className="ml-auto flex items-center gap-2">{t('int.origin')}
              <select className="input h-8" defaultValue="production" onChange={(e) => origin.mutate(e.target.value)}>
                {ORIGINS.map((o) => <option key={o} value={o}>{t(`int.origin_${o}`)}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[12px] text-ink-68">{t('int.originNote')}</p>
          {sums.isLoading ? <SkeletonRows rows={3} />
            : !sums.data?.items.length ? <EmptyState icon="info" title={t('int.noSummaries')} /> : (
            <div className="overflow-x-auto rounded-[5px] border border-line bg-paper">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left text-[11px] text-ink-68">
                  {['machine', 'period', 'ver', 'total', 'good', 'scrap', 'run', 'stop', 'cov'].map((h) => <th key={h} className="px-3 py-2 font-medium">{t(`int.sc_${h}`)}</th>)}
                </tr></thead>
                <tbody>{sums.data.items.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-0 tabular-nums">
                    <td className="px-3 py-1">{s.machine}</td>
                    <td className="px-3 py-1 whitespace-nowrap">{s.shift_name ? `${s.shift_name} ${s.from_ts ? new Date(s.from_ts).toLocaleDateString() : ''}` : s.hour_start ? new Date(s.hour_start).toLocaleString() : ''}</td>
                    <td className="px-3 py-1">{s.version}</td><td className="px-3 py-1">{s.qty_total}</td><td className="px-3 py-1">{s.qty_good}</td>
                    <td className="px-3 py-1">{s.qty_scrap}</td><td className="px-3 py-1">{s.run_s}</td><td className="px-3 py-1">{s.stop_s}</td>
                    <td className="px-3 py-1">{s.coverage_pct}%</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </section>
      </div>
    </div>
  );
}
