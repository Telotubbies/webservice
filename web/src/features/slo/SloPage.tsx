// SLOs — service-level objectives over tag availability, stored per org
// (/api/v1/orgs/{org}/slos). WP-C: dd explorer layout — FacetSidebar on the
// left (state / type / equipment / signal), omnibar with `state:` tokens,
// Breached/Warning/OK summary tiles, and a right-side detail panel opened
// per row and deep-linked with `?slo=<id>`.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { sloApi, type SloDef } from '../../lib/api';
import { Icon } from '../../shared/ui/Icon';
import { DdIcon } from '../../shared/ui/DdIcon';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { Confirm } from '../../shared/ui/Confirm';
import { PageBar, PageBody } from '../../shared/ui/Page';
import { FacetSidebar, passesFacets, toggleFacet, type FacetDef, type FacetSel } from '../../shared/ui/Facets';
import { canAdmin, useAdminOrg } from '../admin/admin';
import { SloEditor } from './SloDialogs';
import { SloPanel } from './SloPanel';
import {
  matchSlo, sloRows, STATUS_BAR, STATUS_GLYPH, STATUS_ORDER, STATUS_TILE,
  type SloRow, type Status,
} from './slo';
import { listWindow, setListWindow, SLO_WINDOW_KEYS, SLO_WINDOWS, type SloWindowKey } from './prefs';
import './i18n';

/** Starter set offered by "Add the default SLOs" on an empty org — templates
 *  only; the SLIs come from live tag data. */
export const DEFAULT_SLOS = [
  { id: 'slo-belt', name: 'Conveyor belt availability', tag: 'plant1.sort.line1.conv1.speed_mps', target: 99.9, warning: 99.95, equipment: 'conveyor' },
  { id: 'slo-temp', name: 'Belt temperature telemetry', tag: 'plant1.sort.line1.conv1.temp_c', target: 99.5, warning: 99.7, equipment: 'conveyor' },
  { id: 'slo-bin', name: 'Bin level sensor uptime', tag: 'plant1.sort.line1.bin1.level_pct', target: 99.0, warning: 99.5, equipment: 'bin' },
  { id: 'slo-vision', name: 'Vision camera frames', tag: 'plant1.sort.vision.cam1.gravel_ratio', target: 99.5, warning: 99.8, equipment: 'camera' },
];

export function SloPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { orgId, orgRole } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');
  const [win, setWinState] = useState<SloWindowKey>(listWindow);
  const setWin = (w: SloWindowKey) => { setWinState(w); setListWindow(w); };
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<FacetSel>({});
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<SloDef | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SloDef | null>(null);
  const [err, setErr] = useState('');
  const [params, setParams] = useSearchParams();

  const defs = useQuery({ queryKey: ['slos', orgId], queryFn: () => sloApi.list(orgId!), enabled: !!orgId });
  const stat = useQuery({
    queryKey: ['slo-status', orgId, win, defs.data?.items.length],
    queryFn: () => sloApi.status(orgId!, SLO_WINDOWS[win]),
    enabled: !!orgId && (defs.data?.items.length ?? 0) > 0, staleTime: 60_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['slos'] });
    void qc.invalidateQueries({ queryKey: ['slo-status'] });
    void qc.invalidateQueries({ queryKey: ['slo-audit'] });
    void qc.invalidateQueries({ queryKey: ['slo-hist'] });
  };

  const rows = useMemo(() => sloRows(defs.data?.items ?? [], stat.data?.items), [defs.data, stat.data]);
  const base = rows.filter((r) => matchSlo(r, q));

  const pick = (r: SloRow) => (f: string): string => {
    switch (f) {
      case 'state': return r.status;
      case 'type': return 'availability';
      case 'equipment': return r.equipment;
      case 'signal': return r.tag;
      default: return '';
    }
  };
  const shown = base.filter((r) => passesFacets(sel, pick(r)));

  // facet counts ignore that facet's own selection (dd behaviour)
  const count = (facet: string, value: string) =>
    base.filter((r) => passesFacets(sel, pick(r), facet) && pick(r)(facet) === value).length;
  const uniq = (f: string) => [...new Set(rows.map((r) => pick(r)(f)))].filter(Boolean).sort();

  const facets: FacetDef[] = [
    { id: 'state', title: t('slos.facetStatus'), values: STATUS_ORDER.map((s) => ({
      value: s, count: count('state', s),
      label: t(`slos.status.${s}`),
      mark: <span aria-hidden className={`h-3 w-1 rounded-sm ${STATUS_BAR[s]}`} />,
    })) },
    { id: 'type', title: t('slos.facetType'), values: [
      { value: 'availability', label: t('slos.typeAvailability'), count: count('type', 'availability') },
    ] },
    { id: 'equipment', title: t('slos.facetEquipment'), values: uniq('equipment').map((e) => ({
      value: e, label: e === 'other' ? t('slos.otherArea') : t(`line.${e}`, { defaultValue: e }), count: count('equipment', e),
    })) },
    { id: 'signal', title: t('slos.facetSignal'), limit: 6, values: uniq('signal').map((s) => ({
      value: s, label: <span className="font-mono text-[12px]">{s}</span>, count: count('signal', s),
    })) },
  ];

  // ?slo=<id> deep link → detail panel
  const openId = params.get('slo');
  const openRow = rows.find((r) => r.id === openId) ?? null;
  useEffect(() => {
    if (openId && defs.isSuccess && !openRow) {
      const p = new URLSearchParams(params); p.delete('slo'); setParams(p, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, defs.isSuccess, openRow]);
  const openPanel = (id: string) => { const p = new URLSearchParams(params); p.set('slo', id); setParams(p); };
  const closePanel = () => { const p = new URLSearchParams(params); p.delete('slo'); setParams(p); };

  const importDefaults = async () => {
    setErr('');
    try {
      for (const d of DEFAULT_SLOS) await sloApi.create(orgId!, { name: d.name, tag: d.tag, target: d.target, warning: d.warning });
      refresh();
    } catch { setErr(t('slos.errSave')); refresh(); }
  };

  const tileCount = (s: Status) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageBar
        icon="status-page" title={t('slos.title')}
        tabs={[
          { to: '/slos', label: t('slos.tabList'), end: true },
          { to: '/slos/settings', label: t('slos.tabSettings') },
        ]}
        actions={admin ? (
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden /> {t('slos.new')}
          </button>
        ) : undefined}
      />
      <div className="px-4 pt-3 md:hidden">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          <DdIcon name="filter" size={13} /> {t('slos.filters')}
        </button>
      </div>
      <div className="grid md:grid-cols-[248px_minmax(0,1fr)]">
        <FacetSidebar
          className={`border-b border-line bg-white p-3 md:sticky md:top-[80px] md:block md:max-h-[calc(100svh-80px)] md:overflow-y-auto md:border-b-0 md:border-r ${showFilters ? '' : 'hidden'}`}
          facets={facets} sel={sel}
          onToggle={(f, v) => setSel((s) => toggleFacet(s, f, v))}
          onClear={() => setSel({})}
          viewMore={t('slos.viewMore')} clearLabel={t('slos.clearFilters')}
        />
        <PageBody className="min-w-0">
          <div className="relative">
            <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
            <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('slos.queryPh')} aria-label={t('slos.queryPh')} />
          </div>

          {/* summary tiles — Breached / Warning / OK (+ no-data and total) */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {STATUS_ORDER.map((s) => (
              <div key={s} className={`rounded-[4px] px-3 py-2 ${STATUS_TILE[s]}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wide">
                  <span aria-hidden>{STATUS_GLYPH[s]} </span>{t(`slos.status.${s}`)}
                </div>
                <div className="mt-1 font-mono text-[22px] font-semibold">{tileCount(s)}</div>
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
            <Segmented value={win} onChange={(v) => setWin(v as SloWindowKey)} label={t('slos.window')}
              options={SLO_WINDOW_KEYS.map((w) => ({ value: w, label: w }))} />
          </div>

          {stat.isError && <div className="mt-2"><Notice tone="error">{t('slos.loadError')}</Notice></div>}
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
                      <th key={c} scope="col" className="overline h-8 px-3">{t(`slos.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} tabIndex={0}
                      aria-selected={openId === r.id}
                      className={`h-10 cursor-pointer border-b border-line last:border-0 hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${openId === r.id ? 'bg-info-soft' : ''}`}
                      onClick={() => openPanel(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openPanel(r.id); }}
                    >
                      <td className="px-3 text-[12px] text-ink-68">{t('slos.typeAvailability')}</td>
                      <td className="px-3 font-medium">
                        {r.name}
                        <span className="ml-2 font-mono text-[11px] text-ink-46">{r.tag.split('.').slice(-2).join('.')}</span>
                      </td>
                      <td className="px-3 font-mono text-[12px]">{win}</td>
                      <td className="px-3 font-mono text-[12px]">{r.target.toFixed(1)}%</td>
                      <td className="px-3 font-mono text-[12px]">{stat.isLoading ? '…' : r.sli == null ? '—' : `${r.sli.toFixed(2)}%`}</td>
                      <td className="px-3">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_TILE[r.status]}`}>
                          <span aria-hidden>{STATUS_GLYPH[r.status]}</span>{t(`slos.status.${r.status}`)}
                        </span>
                      </td>
                      <td className="px-3">
                        {r.budgetLeft == null ? '—' : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
                              <span className={`block h-full ${STATUS_BAR[r.status]}`}
                                style={{ width: `${Math.max(0, Math.min(100, r.budgetLeft))}%` }} />
                            </span>
                            <span className={`font-mono text-[12px] ${r.budgetLeft < 0 ? 'font-semibold text-sev-critical' : ''}`}>
                              {r.budgetLeft.toFixed(0)}%
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3">
                        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-68">equipment:{r.equipment}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <p className="mt-2 text-[11px] text-ink-46">{t('slos.footnote')}</p>
        </PageBody>
      </div>

      {openRow && orgId && (
        <SloPanel
          org={orgId} row={openRow} admin={admin} win={win} onWin={setWin}
          onClose={closePanel}
          onEdit={() => setEditing(openRow)}
          onDelete={() => setDeleting(openRow)}
          onChanged={refresh}
        />
      )}
      {editing && orgId && (
        <SloEditor org={orgId} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {deleting && orgId && (
        <Confirm title={t('slos.deleteTitle', { name: deleting.name })} body={t('slos.deleteBody')} confirm={t('slos.delete')}
          onNo={() => setDeleting(null)}
          onYes={() => {
            const d = deleting; setDeleting(null);
            sloApi.remove(orgId, d.id).then(() => { if (openId === d.id) closePanel(); refresh(); }).catch(() => setErr(t('slos.errSave')));
          }} />
      )}
    </>
  );
}
