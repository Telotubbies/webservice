// Model quality (F12): confusion matrix from reviewed decisions, labelling of
// the true material, and camera drift. Backend: backend/app/vision/quality.py.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { canAdmin } from '../../app/session';
import { ModelGate } from './ModelGate';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { VISION_TABS } from '../devices/tabs';
import { visionApi } from './api';
import './i18n';

const LABELS = ['gravel', 'sand', 'no-material'] as const;
type Label = (typeof LABELS)[number];
interface Confusion { labels: Label[]; cells: Record<Label, Record<Label, number>>; n: number; accuracy: number | null }
interface Drift { hours: number; items: { camera_id: string; n_recent: number; n_base: number; status: 'ok' | 'drift' | 'insufficient'; shift: number | null }[] }

const base = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}/vision`;

export function QualityPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const conf = useQuery({ queryKey: ['vq-conf', orgId], enabled: !!orgId, queryFn: () => request<Confusion>(`${base(orgId!)}/material/confusion`) });
  const drift = useQuery({ queryKey: ['vq-drift', orgId], enabled: !!orgId, queryFn: () => request<Drift>(`${base(orgId!)}/material/drift`) });
  const todo = useQuery({
    queryKey: ['vq-todo', orgId], enabled: !!orgId,
    queryFn: () => visionApi.events(orgId!, { kind: 'material', outcome: 'unreviewed', limit: 8 }),
  });
  const label = useMutation({
    mutationFn: (a: { id: string; v: Label }) =>
      request(`${base(orgId!)}/events/${a.id}/true-material`, { method: 'PUT', body: JSON.stringify({ true_material: a.v }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { setMsg(null); void qc.invalidateQueries({ queryKey: ['vq-conf', orgId] }); void qc.invalidateQueries({ queryKey: ['vq-todo', orgId] }); },
    onError: (e) => setMsg(String(e instanceof Error ? e.message : e)),
  });
  const c = conf.data;
  const max = c ? Math.max(1, ...LABELS.flatMap((r) => LABELS.map((p) => c.cells[r][p]))) : 1;
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="eye" title={t('nav.vision')} tabs={VISION_TABS(t)} lede={t('vis.qualityLede')} />
      <div className="flex-1 space-y-5 p-4">
        {msg && <Notice tone="error">{msg}</Notice>}
        <section aria-label={t('vis.confusion')}>
          <h2 className="mb-2 text-[13px] font-medium">{t('vis.confusion')}{c?.accuracy != null && ` — ${t('vis.accuracy')} ${Math.round(c.accuracy * 100)}% (n=${c.n})`}</h2>
          {conf.isError ? <ErrorState onRetry={() => void conf.refetch()} />
            : conf.isLoading ? <SkeletonRows rows={3} />
            : !c || c.n === 0 ? <EmptyState icon="info" title={t('vis.noLabelled')} /> : (
            <table className="text-[13px]">
              <thead><tr><th className="px-3 py-1 text-left text-[11px] text-ink-68">{t('vis.trueVsPred')}</th>
                {LABELS.map((p) => <th key={p} className="px-3 py-1 text-[11px] font-medium">{t(`vis.mat_${p}`)}</th>)}</tr></thead>
              <tbody>{LABELS.map((r) => (
                <tr key={r}><th className="px-3 py-1 text-left text-[11px] font-medium">{t(`vis.mat_${r}`)}</th>
                  {LABELS.map((p) => (
                    <td key={p} className="border border-line px-4 py-2 text-center tabular-nums"
                      style={{ background: `color-mix(in srgb, var(--color-${r === p ? 'blue' : 'danger'}) ${Math.round((c.cells[r][p] / max) * 40)}%, transparent)` }}>
                      {c.cells[r][p]}</td>))}
                </tr>))}</tbody>
            </table>)}
        </section>
        {orgId && <ModelGate orgId={orgId} admin={canAdmin(orgRole ?? 'none')} />}
        <section aria-label={t('vis.driftTitle')}>
          <h2 className="mb-2 text-[13px] font-medium">{t('vis.driftTitle')}</h2>
          {drift.data?.items.length ? (
            <ul className="space-y-1 text-[13px]">{drift.data.items.map((d) => (
              <li key={d.camera_id} className="flex gap-3">
                <span className="font-mono text-[12px]">{d.camera_id.slice(0, 8)}</span>
                <span className={d.status === 'drift' ? 'text-[var(--color-danger)]' : ''}>{t(`vis.drift_${d.status}`)}</span>
                {d.shift != null && <span className="tabular-nums">{d.shift > 0 ? '+' : ''}{Math.round(d.shift * 100)} pp</span>}
              </li>))}</ul>
          ) : <p className="text-[13px] text-ink-68">{t('vis.driftNone')}</p>}
        </section>
        <section aria-label={t('vis.labelTitle')}>
          <h2 className="mb-2 text-[13px] font-medium">{t('vis.labelTitle')}</h2>
          {todo.data?.items.length ? (
            <ul className="space-y-1 text-[13px]">{todo.data.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap">{new Date(e.fired_at).toLocaleString()}</span>
                <span className="text-ink-68">{String((e.detail as Record<string, unknown> | null)?.decision ?? '—')}</span>
                {LABELS.map((v) => <button key={v} type="button" className="btn btn-sm" onClick={() => label.mutate({ id: e.id, v })}>{t(`vis.mat_${v}`)}</button>)}
              </li>))}</ul>
          ) : <p className="text-[13px] text-ink-68">{t('vis.noEvents')}</p>}
        </section>
      </div>
    </div>
  );
}
