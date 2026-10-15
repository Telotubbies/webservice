// Gateway -> sources -> tags. Admins get add/edit/delete/test and the one-click
// Factory I/O template on an empty gateway; everyone else gets a read-only view.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, ApiError } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { canAdmin } from '../../app/session';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { Confirm } from '../../shared/ui/Confirm';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { deviceState } from '../devices/devices';
import { DEVICE_TABS } from '../devices/tabs';
import { applyTemplate, type StepStatus } from './apply';
import { dsApi, type DataSource } from './api';
import { ConfigChip, StateChip } from './DataSourcesPage';
import { configState, templatePlan, type PlanStep } from './logic';
import { SourceWizard } from './SourceWizard';
import { TagTable } from './TagTable';
import { factoryioSorting } from './templates';
import './i18n';

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; source: DataSource };

export function GatewayPage() {
  const { t } = useTranslation();
  const now = useNow();
  const qc = useQueryClient();
  const { edgeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { orgId, orgRole } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const admin = canAdmin(orgRole ?? 'none');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [del, setDel] = useState<DataSource | null>(null);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState<{ plan: PlanStep[]; status: StepStatus[]; errors: string[] } | null>(null);

  const edges = useQuery({
    queryKey: ['devices', orgId, site?.id], queryFn: () => adminApi.devices(orgId!, site!.id),
    enabled: !!orgId && !!site, refetchInterval: 10_000,
  });
  const edge = edges.data?.items.find((e) => e.id === edgeId);
  const srcKey = ['ds-sources', orgId, edgeId];
  const sources = useQuery({
    queryKey: srcKey, queryFn: () => dsApi.sources(orgId!, edgeId),
    enabled: !!orgId && !!edge, refetchInterval: 10_000,
  });
  const items = sources.data?.items ?? [];
  const selId = params.get('source') ?? items[0]?.id ?? null;
  const selected = items.find((s) => s.id === selId) ?? null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: srcKey }); void qc.invalidateQueries({ queryKey: ['devices', orgId, site?.id] }); };
  const select = (id: string) => setParams((p) => { p.set('source', id); return p; }, { replace: true });

  const remove = useMutation({
    mutationFn: (s: DataSource) => dsApi.deleteSource(orgId!, edgeId, s.id),
    onSuccess: () => { setDel(null); setMsg(''); refresh(); },
    onError: (e) => {
      setDel(null);
      setMsg(e instanceof ApiError && e.status === 409 ? t('ds.sourceHasTags') : e instanceof ApiError ? t('ds.errGeneric', { reason: e.message }) : t('dev.errNetwork'));
    },
  });

  const [applying, setApplying] = useState(false);
  const runTemplate = async () => {
    if (!orgId || !site) return;
    setApplying(true); setMsg('');
    const plan = templatePlan(factoryioSorting, site.code);
    const status: StepStatus[] = plan.map(() => 'pending');
    setProgress({ plan, status: [...status], errors: [] });
    const res = await applyTemplate(factoryioSorting, plan, { org: orgId, siteId: site.id, siteCode: site.code, edgeId }, (i, s) => {
      status[i] = s;
      setProgress((p) => p && { ...p, status: [...status] });
    });
    const why = (e: unknown) => e instanceof ApiError ? `${e.status} ${e.message}` : String((e as Error)?.message ?? e);
    const errors = res.failures.map((f) => {
      const s = plan[f.index];
      const label = s.kind === 'source' ? t('ds.stepSource', { name: s.body.name }) : s.kind === 'tags' ? t('ds.stepTags', { count: s.count }) : s.kind === 'dashboard' ? t('ds.stepDashboard') : t('ds.stepRule', { name: s.rule.name });
      const hint = s.kind === 'tags' ? ` ${t('ds.applyTagsHint')}` : s.kind === 'source' ? ` ${t('ds.applySourceHint')}` : '';
      return `${label}: ${why(f.error)}.${hint}`;
    });
    setProgress({ plan, status: [...status], errors });
    setApplying(false);
    refresh();
  };

  const stepLabel = (s: PlanStep) => s.kind === 'source' ? t('ds.stepSource', { name: s.body.name })
    : s.kind === 'tags' ? t('ds.stepTags', { count: s.count })
    : s.kind === 'dashboard' ? t('ds.stepDashboard') : t('ds.stepRule', { name: s.rule.name });
  const glyph = (s: StepStatus) => ({ pending: '○', running: '…', done: '✓', failed: '▲' })[s];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="server" title={edge?.name ?? t('dev.product')} tabs={DEVICE_TABS(t)}
        back={{ to: '/infrastructure/sources', label: t('ds.tab') }}
        status={edge ? <span className="flex items-center gap-3 text-[12px]"><StateChip state={deviceState(edge, now)} /><ConfigChip state={configState(edge)} /></span> : undefined}
        actions={admin && edge && mode.kind === 'list'
          ? <button type="button" className="btn btn-sm whitespace-nowrap" onClick={() => setMode({ kind: 'add' })}><Plus size={14} aria-hidden /> {t('ds.addSource')}</button>
          : !admin ? <span className="hidden text-[11px] text-ink-46 md:inline">{t('ds.readOnly')}</span> : undefined} />

      <div className="flex-1 p-4">
        {edges.isError || sources.isError ? <ErrorState onRetry={() => { void edges.refetch(); void sources.refetch(); }} />
          : edges.isLoading || !site ? <SkeletonRows rows={4} />
          : !edge ? <EmptyState icon="info" title={t('ds.gatewayNotFound')} />
          : (
            <>
              {edge.config_error && <div className="mb-3"><Notice tone="error">{t('ds.cfgErrorBanner', { message: edge.config_error })}</Notice></div>}
              {msg && <div className="mb-3"><Notice tone="error">{msg}</Notice></div>}

              {progress && (
                <section className="mb-4 rounded-[5px] border border-line bg-white p-3" aria-live="polite" aria-label={t('ds.applyTitle')}>
                  <h2 className="text-[14px] font-semibold">{t('ds.applyTitle')}</h2>
                  <ol className="mt-2 space-y-0.5 text-[13px]">
                    {progress.plan.map((s, i) => (
                      <li key={i} className={progress.status[i] === 'failed' ? 'text-[var(--color-danger)]' : ''}><span aria-hidden className="inline-block w-5">{glyph(progress.status[i] ?? 'pending')}</span>{stepLabel(s)}</li>
                    ))}
                  </ol>
                  {progress.errors.map((m, i) => <div key={i} className="mt-2"><Notice tone="error">{t('ds.applyFailed', { reason: m })}</Notice></div>)}
                  {!applying && progress.errors.length === 0 && progress.plan.length > 0 && <div className="mt-2"><Notice tone="ok">{t('ds.applyDone')}</Notice></div>}
                  {!applying && <button type="button" className="btn btn-sm btn-ghost mt-2" onClick={() => setProgress(null)}>{t('ds.close')}</button>}
                </section>
              )}

              {mode.kind !== 'list' && orgId && (
                <SourceWizard orgId={orgId} edgeId={edgeId} existing={mode.kind === 'edit' ? mode.source : undefined}
                  onCancel={() => setMode({ kind: 'list' })}
                  onDone={(s) => { setMode({ kind: 'list' }); select(s.id); refresh(); }} />
              )}

              {sources.isLoading ? <SkeletonRows rows={3} /> : items.length === 0 && mode.kind === 'list' && !progress ? (
                <EmptyState icon="info" title={t('ds.noSources')} body={admin ? t('ds.noSourcesHint') : t('ds.noSourcesViewer')}
                  action={admin ? (
                    <span className="flex flex-wrap justify-center gap-2">
                      <button type="button" className="btn" disabled={applying} onClick={() => void runTemplate()}>{t('ds.useTemplate')}</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setMode({ kind: 'add' })}>{t('ds.addSource')}</button>
                    </span>
                  ) : undefined} />
              ) : items.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-left">
                          {['colName', 'colProtocol', 'colConnection', 'colStatus', 'colTags', ''].map((c) => (
                            <th key={c || 'act'} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{c && t(`ds.${c}`)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((s) => (
                          <tr key={s.id} className={`border-b border-line last:border-0 ${s.id === selected?.id ? 'bg-info-soft' : ''}`}>
                            <td className="px-3 py-2"><button type="button" className="font-medium text-blue hover:underline" aria-pressed={s.id === selected?.id} onClick={() => select(s.id)}>{s.name}</button>{!s.enabled && <span className="ml-2 text-[11px] text-ink-46">{t('ds.disabled')}</span>}</td>
                            <td className="px-3 py-2">{t(`ds.proto_${s.protocol}`)}</td>
                            <td className="px-3 py-2 font-mono text-[12px]">{String(s.connection.host ?? s.connection.endpoint ?? '')}{s.connection.port ? `:${s.connection.port}` : ''}</td>
                            <td className="px-3 py-2" title={s.status_detail ?? undefined}>
                              {s.status === 'ok' ? <span>● {t('ds.srcOk')}</span> : s.status === 'error' ? <span className="text-[var(--color-danger)]">▲ {s.status_detail || t('ds.srcError')}</span> : <span className="text-ink-46">○ {s.status ?? t('ds.srcUnknown')}</span>}
                            </td>
                            <td className="px-3 py-2">{s.tag_count ?? 0}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {admin && (
                                <>
                                  <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('ds.edit')} ${s.name}`} onClick={() => setMode({ kind: 'edit', source: s })}><Pencil size={12} aria-hidden /></button>{' '}
                                  <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" aria-label={`${t('ds.delete')} ${s.name}`} onClick={() => setDel(s)}><Trash2 size={12} aria-hidden /></button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selected?.protocol === 's7' && <div className="mt-3"><Notice tone="warn">{t('ds.s7Notice')}</Notice></div>}
                  {selected && orgId && <TagTable key={selected.id} orgId={orgId} edgeId={edgeId} source={selected} siteId={site.id} canEdit={admin} />}
                </>
              )}
            </>
          )}
      </div>
      {del && (
        <Confirm title={t('ds.deleteSourceTitle', { name: del.name })} body={t('ds.deleteSourceBody')} confirm={t('ds.delete')}
          onYes={() => remove.mutate(del)} onNo={() => setDel(null)} />
      )}
    </div>
  );
}
