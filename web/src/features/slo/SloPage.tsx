// SLOs — service-level objectives over tag availability, stored per org
// (/api/v1/orgs/{org}/slos). Status tiles, facet panel, table with target,
// status and error budget left; window switch 7d / 30d / 90d. Admins create,
// edit and delete SLOs and add correction windows whose samples are excluded.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { sloApi, type SloDef } from '../../lib/api';
import { equipmentOf } from '../../lib/plant';
import { Icon } from '../../shared/ui/Icon';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { Confirm } from '../../shared/ui/Confirm';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { canAdmin, useAdminOrg } from '../admin/admin';
import { CorrectionsDialog, SloEditor } from './SloDialogs';

/** Starter set offered by "Add the default SLOs" on an empty org. */
export const DEFAULT_SLOS = [
  { id: 'slo-belt', name: 'Conveyor belt availability', tag: 'plant1.sort.line1.conv1.speed_mps', target: 99.9, warning: 99.95, equipment: 'conveyor' },
  { id: 'slo-temp', name: 'Belt temperature telemetry', tag: 'plant1.sort.line1.conv1.temp_c', target: 99.5, warning: 99.7, equipment: 'conveyor' },
  { id: 'slo-bin', name: 'Bin level sensor uptime', tag: 'plant1.sort.line1.bin1.level_pct', target: 99.0, warning: 99.5, equipment: 'bin' },
  { id: 'slo-vision', name: 'Vision camera frames', tag: 'plant1.sort.vision.cam1.gravel_ratio', target: 99.5, warning: 99.8, equipment: 'camera' },
];

export type Status = 'breached' | 'warning' | 'ok' | 'nodata';
export const sloStatus = (sli: number | null, target: number, warning: number): Status =>
  sli == null ? 'nodata' : sli < target ? 'breached' : sli < warning ? 'warning' : 'ok';
const WINDOWS = { '7d': 7, '30d': 30, '90d': 90 } as const;
type Win = keyof typeof WINDOWS;

const TILE: Record<Status, string> = {
  breached: 'bg-[#fde8ea] text-[#a3263c]',
  warning: 'bg-[var(--color-caution-soft)] text-[#8a5a00]',
  ok: 'bg-[#e6f5ec] text-[#1c6b45]',
  nodata: 'bg-subtle text-ink-68',
};
const GLYPH: Record<Status, string> = { breached: '▲', warning: '◆', ok: '●', nodata: '○' };

export function SloPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { orgId, orgRole } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');
  const [win, setWin] = useState<Win>('30d');
  const [q, setQ] = useState('');
  const [offStatus, setOffStatus] = useState<Set<string>>(new Set());
  const [offEq, setOffEq] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SloDef | 'new' | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SloDef | null>(null);
  const [err, setErr] = useState('');

  const defs = useQuery({ queryKey: ['slos', orgId], queryFn: () => sloApi.list(orgId!), enabled: !!orgId });
  const stat = useQuery({
    queryKey: ['slo-status', orgId, win, defs.data?.items.length],
    queryFn: () => sloApi.status(orgId!, WINDOWS[win]),
    enabled: !!orgId && (defs.data?.items.length ?? 0) > 0, staleTime: 60_000,
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['slos'] }); void qc.invalidateQueries({ queryKey: ['slo-status'] }); };

  const byId = new Map((stat.data?.items ?? []).map((x) => [x.id, x]));
  const rows = (defs.data?.items ?? []).map((s) => {
    const st = byId.get(s.id);
    const sli = st?.sli ?? null;
    const status = sloStatus(sli, s.target, s.warning);
    // budget = allowed bad fraction; left = share of it not yet spent
    const budgetLeft = sli == null ? null : (1 - (100 - sli) / (100 - s.target)) * 100;
    const equipment = (s.tag && equipmentOf(s.tag)) || 'other';
    return { ...s, tag: s.tag ?? '', sli, status, budgetLeft, equipment, excluded: st?.excluded ?? 0, loading: stat.isLoading };
  });

  const importDefaults = async () => {
    setErr('');
    try {
      for (const d of DEFAULT_SLOS) await sloApi.create(orgId!, { name: d.name, tag: d.tag, target: d.target, warning: d.warning });
      refresh();
    } catch { setErr(t('slos.errSave')); refresh(); }
  };

  const shown = rows
    .filter((r) => !offStatus.has(r.status) && !offEq.has(r.equipment))
    .filter((r) => `${r.name} ${r.tag} ${r.equipment}`.toLowerCase().includes(q.toLowerCase()));
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const anyError = stat.isError;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="status-page" title={t('slos.title')} tabs={[{ to: '/slos', label: t('slos.tabList'), end: true }]}
        actions={admin ? <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}><Plus size={14} aria-hidden /> {t('slos.new')}</button> : undefined} />
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
          <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('slos.queryPh')} aria-label={t('slos.queryPh')} />
        </div>
      </div>

      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white" aria-label={t('errtrack.facets')}>
          <FacetGroup title={t('slos.facetStatus')} off={offStatus} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffStatus((s) => toggleIn(s, v))}
            options={facetOptions(rows, (r) => r.status, (v) => t(`slos.status.${v}`))} />
          <FacetGroup title={t('slos.facetEquipment')} off={offEq} emptyLabel={t('slos.noValues')}
            onToggle={(v) => setOffEq((s) => toggleIn(s, v))}
            options={facetOptions(rows, (r) => r.equipment)} />
        </aside>

        <div className="min-w-0 flex-1">
          {/* status tiles */}
          <div className="grid grid-cols-5 gap-2">
            {(['breached', 'warning', 'ok', 'nodata'] as Status[]).map((s) => (
              <div key={s} className={`rounded-[4px] px-3 py-2 ${TILE[s]}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wide"><span aria-hidden>{GLYPH[s]} </span>{t(`slos.status.${s}`)}</div>
                <div className="mt-1 font-mono text-[22px] font-semibold">{count(s)}</div>
              </div>
            ))}
            <div className="rounded-[4px] border border-line bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-68">{t('slos.total')}</div>
              <div className="mt-1 font-mono text-[22px] font-semibold text-ink">{rows.length}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="text-[12px] text-ink-68">{t('slos.showing', { shown: shown.length, total: rows.length })}</span>
            <span className="flex-1" />
            <Segmented
              value={win}
              onChange={(v) => setWin(v as Win)}
              options={(Object.keys(WINDOWS) as Win[]).map((w) => ({ value: w, label: w }))}
              label={t('slos.window')}
            />
          </div>

          {anyError && <div className="mt-2"><Notice tone="error">{t('slos.loadError')}</Notice></div>}
          {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}

          <section className="mt-2 overflow-x-auto rounded-[5px] border border-line bg-white">
            {defs.isLoading ? <div className="p-4"><Skeleton h={80} /></div> : defs.isError ? (
              <ErrorState onRetry={() => void defs.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState title={t('slos.none')} body={admin ? t('slos.noneBody') : t('slos.noneViewer')} icon="search"
                action={admin ? (
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>{t('slos.new')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void importDefaults()}>{t('slos.importDefaults')}</button>
                  </span>
                ) : undefined} />
            ) : shown.length === 0 ? (
              <EmptyState title={t('slos.empty')} icon="search" />
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colType', 'colName', 'colWindow', 'colTarget', 'colSli', 'colStatus', 'colBudget', 'colTags'].map((c) => (
                      <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`slos.${c}`)}</th>
                    ))}
                    {admin && <th scope="col" className="h-8 px-3"><span className="sr-only">{t('access.colActions')}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                      <td className="px-3 text-[12px] text-ink-68">{t('slos.typeAvailability')}</td>
                      <td className="px-3 font-medium">{r.name}<span className="ml-2 font-mono text-[11px] text-ink-46">{r.tag.split('.').slice(-2).join('.')}</span></td>
                      <td className="px-3 font-mono text-[12px]">{win}</td>
                      <td className="px-3 font-mono text-[12px]">{r.target.toFixed(1)}%</td>
                      <td className="px-3 font-mono text-[12px]">{r.loading ? '…' : r.sli == null ? '—' : `${r.sli.toFixed(2)}%`}</td>
                      <td className="px-3">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${TILE[r.status]}`}>
                          <span aria-hidden>{GLYPH[r.status]}</span>{t(`slos.status.${r.status}`)}
                        </span>
                      </td>
                      <td className="px-3">
                        {r.budgetLeft == null ? '—' : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
                              <span className={`block h-full ${r.budgetLeft < 0 ? 'bg-[#c8485f]' : r.budgetLeft < 25 ? 'bg-[var(--color-warn)]' : 'bg-[#2c9a63]'}`}
                                style={{ width: `${Math.max(0, Math.min(100, r.budgetLeft))}%` }} />
                            </span>
                            <span className="font-mono text-[12px]">{r.budgetLeft.toFixed(0)}%</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3"><span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-68">equipment:{r.equipment}</span></td>
                      {admin && (
                        <td className="whitespace-nowrap px-3 text-right">
                          <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('slos.edit')} ${r.name}`} onClick={() => setEditing(defs.data!.items.find((x) => x.id === r.id)!)}><Pencil size={13} aria-hidden /></button>
                          <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('slos.fix')} ${r.name}`} title={r.excluded ? t('slos.excludedN', { count: r.excluded }) : t('slos.fix')} onClick={() => setFixing(r.id)}>
                            <Wrench size={13} aria-hidden />{r.corrections.length > 0 && <span className="ml-1 text-[11px]">{r.corrections.length}</span>}
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" aria-label={`${t('slos.delete')} ${r.name}`} onClick={() => setDeleting(defs.data!.items.find((x) => x.id === r.id)!)}><Trash2 size={13} aria-hidden /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <p className="mt-2 text-[11px] text-ink-46">{t('slos.footnote')}</p>
        </div>
      </div>
      {editing && orgId && (
        <SloEditor org={orgId} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {fixing && orgId && defs.data?.items.find((x) => x.id === fixing) && (
        <CorrectionsDialog org={orgId} slo={defs.data.items.find((x) => x.id === fixing)!} onClose={() => setFixing(null)} onChanged={refresh} />
      )}
      {deleting && orgId && (
        <Confirm title={t('slos.deleteTitle', { name: deleting.name })} body={t('slos.deleteBody')} confirm={t('slos.delete')}
          onNo={() => setDeleting(null)}
          onYes={() => { const d = deleting; setDeleting(null); sloApi.remove(orgId, d.id).then(refresh).catch(() => setErr(t('slos.errSave'))); }} />
      )}
    </div>
  );
}
