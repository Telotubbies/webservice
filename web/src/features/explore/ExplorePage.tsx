// Explore (F13): tag stats, lagged correlation between two tags, and saved
// time-split datasets exported as CSV. Backend: backend/app/datasets/routes.py.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, requestBlob, tagQueryApi } from '../../lib/api';
import { saveBlob } from '../../lib/saveBlob';
import { usePrimaryScope } from '../admin/admin';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import './i18n';

interface Dataset { id: string; name: string; tag_ids: string[]; from_ts: string; to_ts: string; bucket_s: number; train_pct: number; val_pct: number }
interface Lag { bucket_s: number; items: { lag: number; r: number | null; n: number }[]; best: { lag: number; r: number } | null }

const sp = (o: string, s: string) => `/api/v1/orgs/${encodeURIComponent(o)}/sites/${s}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export function ExplorePage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const qc = useQueryClient();
  const [hours, setHours] = useState(24);
  const [sel, setSel] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [train, setTrain] = useState(70);
  const [val, setVal] = useState(15);
  const [msg, setMsg] = useState<string | null>(null);
  const range = () => { const to = new Date(); return { from: new Date(to.getTime() - hours * 3600_000).toISOString(), to: to.toISOString() }; };
  const on = !!orgId && !!siteId;
  const stats = useQuery({ queryKey: ['ex-stats', orgId, siteId, hours], enabled: on, queryFn: () => tagQueryApi.stats(orgId!, siteId!, range()) });
  const sets = useQuery({ queryKey: ['ex-sets', orgId, siteId], enabled: on, queryFn: () => request<{ items: Dataset[] }>(`${sp(orgId!, siteId!)}/datasets`) });
  const lag = useQuery({
    queryKey: ['ex-lag', orgId, siteId, hours, sel.slice(0, 2)], enabled: on && sel.length >= 2,
    queryFn: () => { const r = range(); return request<Lag>(`${sp(orgId!, siteId!)}/explore/lag?a=${sel[0]}&b=${sel[1]}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&bucket_s=${Math.max(1, Math.round(hours * 36))}&max_lag=10`); },
  });
  const fail = (e: unknown) => setMsg(String(e instanceof Error ? e.message : e));
  const create = useMutation({
    mutationFn: () => { const r = range(); return request(`${sp(orgId!, siteId!)}/datasets`, json('POST', { name, tag_ids: sel, from_ts: r.from, to_ts: r.to, bucket_s: Math.max(1, Math.round(hours * 36)), train_pct: train, val_pct: val })); },
    onSuccess: () => { setMsg(null); setName(''); void qc.invalidateQueries({ queryKey: ['ex-sets', orgId, siteId] }); }, onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: string) => request(`${sp(orgId!, siteId!)}/datasets/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ex-sets', orgId, siteId] }), onError: fail,
  });
  const exportCsv = async (id: string) => {
    try { const { blob } = await requestBlob(`${sp(orgId!, siteId!)}/datasets/${id}/export.csv`); saveBlob('dataset.csv', blob); } catch (e) { fail(e); }
  };
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const items = stats.data?.items ?? [];
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="database" title={t('exp.title')} lede={t('exp.lede')} />
      <div className="flex-1 space-y-5 p-4">
        {msg && <Notice tone="error">{msg}</Notice>}
        <div className="flex items-center gap-2 text-[13px]">
          <label htmlFor="ex-h">{t('exp.window')}</label>
          <select id="ex-h" className="input h-8" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 6, 24, 72, 168].map((h) => <option key={h} value={h}>{t('exp.hours', { count: h })}</option>)}
          </select>
        </div>
        <section aria-label={t('exp.stats')}>
          {stats.isError ? <ErrorState onRetry={() => void stats.refetch()} />
            : stats.isLoading ? <SkeletonRows rows={5} />
            : items.length === 0 ? <EmptyState icon="info" title={t('exp.noTags')} /> : (
            <div className="overflow-x-auto rounded-[5px] border border-line bg-paper">
              <table className="w-full text-[13px]">
                <thead><tr className="border-b border-line text-left text-[11px] text-ink-68">
                  <th className="w-8 px-2 py-2" aria-label="select" />
                  {['path', 'min', 'avg', 'max', 'count'].map((c) => <th key={c} className="px-3 py-2 font-medium">{t(`exp.col_${c}`)}</th>)}
                </tr></thead>
                <tbody>{items.map((r) => (
                  <tr key={r.tag_id} className="border-b border-line last:border-0">
                    <td className="px-2 py-1"><input type="checkbox" aria-label={r.path} checked={sel.includes(r.tag_id)} onChange={() => toggle(r.tag_id)} /></td>
                    <td className="px-3 py-1 font-mono text-[12px]">{r.path}</td>
                    {[r.min, r.avg, r.max].map((v, i) => <td key={i} className="px-3 py-1 tabular-nums">{v == null ? '—' : +v.toFixed(2)}</td>)}
                    <td className="px-3 py-1 tabular-nums">{r.count}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </section>
        <section aria-label={t('exp.lag')}>
          <h2 className="mb-2 text-[13px] font-medium">{t('exp.lag')}</h2>
          {sel.length < 2 ? <p className="text-[13px] text-ink-68">{t('exp.pickTwo')}</p>
            : lag.isLoading ? <SkeletonRows rows={2} />
            : lag.data?.best ? (
              <div className="space-y-1 text-[13px]">
                <p>{t('exp.bestLag', { lag: lag.data.best.lag, r: lag.data.best.r })}</p>
                <div className="flex items-end gap-1" role="img" aria-label={t('exp.lag')}>
                  {lag.data.items.map((p) => (
                    <div key={p.lag} title={`${p.lag}: ${p.r ?? '—'}`} className="w-4 rounded-t bg-blue"
                      style={{ height: `${Math.round(Math.abs(p.r ?? 0) * 60) + 2}px`, opacity: p.r != null && p.r < 0 ? 0.45 : 1 }} />
                  ))}
                </div>
              </div>
            ) : <p className="text-[13px] text-ink-68">{t('exp.noLag')}</p>}
        </section>
        <section aria-label={t('exp.datasets')} className="space-y-2">
          <h2 className="text-[13px] font-medium">{t('exp.datasets')}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <input className="input h-8" placeholder={t('exp.name')} aria-label={t('exp.name')} value={name} onChange={(e) => setName(e.target.value)} />
            <label>{t('exp.train')} <input type="number" className="input h-8 w-16" min={1} max={98} value={train} onChange={(e) => setTrain(Number(e.target.value))} /></label>
            <label>{t('exp.val')} <input type="number" className="input h-8 w-16" min={0} max={98} value={val} onChange={(e) => setVal(Number(e.target.value))} /></label>
            <button type="button" className="btn btn-sm" disabled={!name || sel.length === 0 || train + val >= 100 || create.isPending} onClick={() => create.mutate()}>{t('exp.save', { count: sel.length })}</button>
          </div>
          <p className="text-[12px] text-ink-68">{t('exp.splitNote')}</p>
          {sets.data?.items.length ? (
            <ul className="space-y-1 text-[13px]">{sets.data.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                <span className="text-ink-68">{t('exp.setInfo', { n: d.tag_ids.length, a: d.train_pct, b: d.val_pct, c: 100 - d.train_pct - d.val_pct })}</span>
                <button type="button" className="btn btn-sm" onClick={() => void exportCsv(d.id)}>{t('exp.export')}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => del.mutate(d.id)}>{t('exp.delete')}</button>
              </li>))}</ul>
          ) : <p className="text-[13px] text-ink-68">{t('exp.noSets')}</p>}
        </section>
      </div>
    </div>
  );
}
