// ERP import (F19): read-only Odoo pull and CSV import through one path, with a dry-run
// preview, the staging list for work centers that still need a machine, and recent runs.
// Backend: backend/app/integration/routes.py (+ connectors/).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../lib/api';
import { usePrimaryScope } from '../../admin/admin';
import { EmptyState, Notice } from '../../../shared/ui/Feedback';
import { ProductHeader } from '../../../shared/ui/Product';
import './i18n';

type Entity = 'product' | 'work_center' | 'work_order';
interface Result { added: number; updated: number; skipped: number; bad: number; staged: number; error: string | null; dry_run: boolean }
interface Staged { id: number; external_id: string; payload: Record<string, string>; reason: string }
interface Run { id: number; entity: string; dry_run: boolean; started_at: string; added: number; updated: number; skipped: number; bad: number; staged: number; error: string | null }
interface Conn { id: string; kind: string; name: string; enabled: boolean; status: string }
const counts = (r: { added: number; updated: number; skipped: number; bad: number; staged: number }) => ({ defaultValue: '', added: r.added, updated: r.updated, skipped: r.skipped, bad: r.bad, staged: r.staged });
const ENTITIES: Entity[] = ['product', 'work_center', 'work_order'];

export function OdooPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<Entity>('product');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const base = `/api/v1/orgs/${encodeURIComponent(orgId ?? '')}`;
  const on = !!orgId;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['erp-staging', orgId] }); void qc.invalidateQueries({ queryKey: ['erp-runs', orgId] }); };
  const fail = (e: unknown) => setMsg(String(e instanceof Error ? e.message : e));
  const staging = useQuery({ queryKey: ['erp-staging', orgId], enabled: on, queryFn: () => request<{ items: Staged[] }>(`${base}/integration/staging`) });
  const runs = useQuery({ queryKey: ['erp-runs', orgId], enabled: on, queryFn: () => request<{ items: Run[] }>(`${base}/integration/sync-runs`) });
  const conns = useQuery({ queryKey: ['erp-conns', orgId], enabled: on, queryFn: () => request<{ items: Conn[] }>(`${base}/integration/connections`) });
  const machines = useQuery({ queryKey: ['erp-machines', orgId, siteId], enabled: on && !!siteId, queryFn: () => request<{ items: { device_id: string; name: string }[] }>(`${base}/sites/${siteId}/machines`) });
  const importCsv = useMutation({
    mutationFn: async (dry: boolean) => request<Result>(`${base}/integration/csv-import?entity=${entity}&dry_run=${dry}`,
      { method: 'POST', body: await file!.text(), headers: { 'Content-Type': 'text/csv' } }),
    onSuccess: (r) => { setResult(r); setMsg(null); refresh(); }, onError: fail,
  });
  const sync = useMutation({
    mutationFn: (v: { id: string; dry: boolean }) => request<Result>(`${base}/integration/connections/${v.id}/sync?entity=${entity}&dry_run=${v.dry}`, { method: 'POST' }),
    onSuccess: (r) => { setResult(r); setMsg(null); refresh(); }, onError: fail,
  });
  const map = useMutation({
    mutationFn: (v: { id: number; device: string }) => request(`${base}/integration/staging/${v.id}/map`, { method: 'PUT', body: JSON.stringify({ device_id: v.device }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: refresh, onError: fail,
  });
  const odoo = (conns.data?.items ?? []).filter((c) => c.kind === 'odoo' && c.enabled);
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="database" title={t('erp.title')} lede={t('erp.lede')} />
      <div className="flex-1 space-y-5 p-4">
        {msg && <Notice tone="error">{msg}</Notice>}
        <section className="space-y-2" aria-label={t('erp.import')}>
          <h2 className="text-[13px] font-medium">{t('erp.import')}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <select className="input h-8" aria-label={t('erp.entity')} value={entity} onChange={(e) => setEntity(e.target.value as Entity)}>
              {ENTITIES.map((e) => <option key={e} value={e}>{t(`erp.e_${e}`)}</option>)}
            </select>
            <input type="file" accept=".csv,text/csv" aria-label={t('erp.file')} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
            <button type="button" className="btn btn-sm" disabled={!file || importCsv.isPending} onClick={() => importCsv.mutate(true)}>{t('erp.preview')}</button>
            <button type="button" className="btn btn-sm" disabled={!file || !result?.dry_run || importCsv.isPending} onClick={() => importCsv.mutate(false)}>{t('erp.apply')}</button>
            {odoo.map((c) => <button key={c.id} type="button" className="btn btn-sm" disabled={sync.isPending} onClick={() => sync.mutate({ id: c.id, dry: true })}>{t('erp.previewOdoo', { name: c.name })}</button>)}
            {odoo.map((c) => <button key={c.id + 's'} type="button" className="btn btn-sm" disabled={sync.isPending || !result?.dry_run} onClick={() => sync.mutate({ id: c.id, dry: false })}>{t('erp.syncOdoo', { name: c.name })}</button>)}
          </div>
          <p className="text-[12px] text-ink-68">{t('erp.csvHelp')}</p>
          {result && (
            <p role="status" className="text-[13px]">
              {result.dry_run ? t('erp.wouldDo') : t('erp.did')}: {t('erp.counts', counts(result))}
              {result.error && <span className="ml-2 text-[var(--color-danger)]">{result.error}</span>}
            </p>)}
        </section>
        <section className="space-y-2" aria-label={t('erp.staging')}>
          <h2 className="text-[13px] font-medium">{t('erp.staging')}</h2>
          {!staging.data?.items.length ? <EmptyState icon="info" title={t('erp.noStaging')} /> : (
            <ul className="space-y-1 text-[13px]">{staging.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]">{s.external_id}</span><span>{s.payload.name ?? s.payload.code}</span>
                <select className="input h-8" aria-label={t('erp.pickMachine')} value={pick[s.id] ?? ''} onChange={(e) => setPick({ ...pick, [s.id]: e.target.value })}>
                  <option value="">{t('erp.pickMachine')}</option>
                  {(machines.data?.items ?? []).map((m) => <option key={m.device_id} value={m.device_id}>{m.name}</option>)}
                </select>
                <button type="button" className="btn btn-sm" disabled={!pick[s.id]} onClick={() => map.mutate({ id: s.id, device: pick[s.id] })}>{t('erp.map')}</button>
              </li>))}</ul>)}
        </section>
        <section className="space-y-2" aria-label={t('erp.runs')}>
          <h2 className="text-[13px] font-medium">{t('erp.runs')}</h2>
          {runs.data?.items.length ? (
            <ul className="space-y-1 text-[13px] tabular-nums">{runs.data.items.map((r) => (
              <li key={r.id}>{new Date(r.started_at).toLocaleString()} · {t(`erp.e_${r.entity}`)}{r.dry_run ? ` (${t('erp.dry')})` : ''} · {t('erp.counts', counts(r))}
                {r.error && <span className="ml-2 text-[var(--color-danger)]">{r.error}</span>}</li>))}</ul>
          ) : <p className="text-[13px] text-ink-68">{t('erp.noRuns')}</p>}
        </section>
      </div>
    </div>
  );
}
