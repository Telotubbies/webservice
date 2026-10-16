// Incidents (WP-E) — Datadog incident list shape on the plant incident model:
// facet sidebar (status / severity / team / equipment), omnibar, dense table,
// CSV export, row → right-hand triage drawer (IncidentPanel). Deep link:
// ?incident=<id>. The settings tab jumps to /incidents/settings.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useSearchParams } from 'react-router';
import { ApiError, incidentApi, type IncidentRow, type IncidentSeverity } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { canOperate } from '../../app/session';
import { fmtAge } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { SeverityBadge } from '../../shared/ui/Status';
import { PageBar, PageBody } from '../../shared/ui/Page';
import { FacetSidebar, passesFacets, toggleFacet, type FacetDef, type FacetSel } from '../../shared/ui/Facets';
import { ExportCsvButton } from '../../shared/ui/ExportCsv';
import { INC_SEVS, INC_STATUSES, matchIncident, useIncidentTabs, useLinkedAlarms } from './incidents';
import { IncidentPanel, IncStatusPill } from './IncidentPanel';
import './i18n';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_MARK: Record<string, string> = {
  active: 'bg-[var(--color-danger-bright)]', acknowledged: 'bg-[var(--color-warn)]', resolved: 'bg-[var(--color-ok)]',
};

export function IncidentsPage() {
  const { t } = useTranslation();
  const { orgId, orgRole } = useAdminOrg();
  const operable = canOperate(orgRole ?? 'none');
  const qc = useQueryClient();
  const now = useNow(15_000);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<FacetSel>({});
  const [showFilters, setShowFilters] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const linked = useLinkedAlarms();

  const list = useQuery({ queryKey: ['incidents', orgId], queryFn: () => incidentApi.list(orgId!), enabled: !!orgId, refetchInterval: 30_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['incidents', orgId] });
    void qc.invalidateQueries({ queryKey: ['incident', orgId] });
  };
  const create = useMutation({ mutationFn: (b: Parameters<typeof incidentApi.create>[1]) => incidentApi.create(orgId!, b), onSuccess: refresh });

  const rows = useMemo(() => list.data?.incidents ?? [], [list.data]);
  const eqOf = (i: IncidentRow) => linked.equipmentOf(i);
  const eqLabel = (eq: string) => (eq ? t(`line.${eq}`, { defaultValue: eq }) : t('inc.noEquipment'));
  const base = useMemo(
    () => rows.filter((i) => matchIncident(i, q, eqLabel(eqOf(i)), linked.tagOf(i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, q, linked],
  );
  const pick = (i: IncidentRow) => (f: string): string => {
    switch (f) {
      case 'status': return i.status;
      case 'severity': return i.severity;
      case 'team': return i.team ?? '_none';
      case 'equipment': return eqOf(i) || '_none';
      default: return '';
    }
  };
  const shown = base.filter((i) => passesFacets(sel, pick(i)));

  const count = (facet: string, value: string) =>
    base.filter((i) => passesFacets(sel, pick(i), facet) && pick(i)(facet) === value).length;
  const uniq = (f: string) => [...new Set(rows.map((i) => pick(i)(f)))].sort();
  const facets: FacetDef[] = [
    { id: 'status', title: t('inc.facetStatus'), values: INC_STATUSES.map((s) => ({
      value: s, label: t(`inc.status.${s}`), count: count('status', s),
      mark: <span aria-hidden className={`h-3 w-1 rounded-sm ${STATUS_MARK[s]}`} />,
    })) },
    { id: 'severity', title: t('inc.facetSeverity'), values: INC_SEVS.map((s) => ({
      value: s, label: <SeverityBadge severity={s} />, count: count('severity', s),
    })) },
    { id: 'team', title: t('inc.facetTeam'), values: uniq('team').map((x) => ({
      value: x, label: x === '_none' ? t('inc.unassigned') : x, count: count('team', x),
    })) },
    { id: 'equipment', title: t('inc.facetEquipment'), values: uniq('equipment').map((x) => ({
      value: x, label: x === '_none' ? t('inc.noEquipment') : eqLabel(x), count: count('equipment', x),
    })) },
  ];

  const openId = params.get('incident');
  const openIncident = (id: string | null) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('incident', id); else n.delete('incident');
      return n;
    }, { replace: true });
  };

  const err = create.error ?? list.error;
  const tabs = useIncidentTabs();

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <PageBar icon="incidents" title={t('inc.title')} tabs={tabs}
        actions={(
          <>
            {/* secondary actions collapse below md — the Declare CTA stays */}
            <span className="hidden md:contents">
              <ExportCsvButton name="incidents" count={shown.length}
                columns={[
                  { key: 'status', label: t('inc.colStatus') }, { key: 'severity', label: t('inc.colSeverity') },
                  { key: 'title', label: t('inc.colTitle') }, { key: 'team', label: t('inc.colTeam') },
                  { key: 'equipment', label: t('inc.colEquipment') }, { key: 'opened', label: t('inc.colOpened') },
                ]}
                rows={() => shown.map((i) => ({
                  status: t(`inc.status.${i.status}`), severity: i.severity, title: i.title,
                  team: i.team ?? '', equipment: eqOf(i) ? eqLabel(eqOf(i)) : '', opened: i.created_at,
                }))} />
              <NavLink to="/dashboards/incident-management-overview" className="btn btn-ghost btn-sm">
                <DdIcon name="dashboard" size={13} /> {t('inc.overviewBoard')}
              </NavLink>
            </span>
            {operable ? (
              <button type="button" onClick={() => dlg.current?.showModal()}
                className="btn btn-sm">
                <DdIcon name="incidents" size={13} /> {t('inc.declare')}
              </button>
            ) : null}
          </>
        )} />

      <PageBody className="flex-1">
        <div className="relative">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
          <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('inc.queryPh')} aria-label={t('inc.searchLabel')} />
        </div>
        {err && <div className="pt-3"><Notice tone="error">{err instanceof ApiError && err.status === 403 ? t('inc.needOperator') : t('inc.failed')}</Notice></div>}
        {!operable && <p className="pt-2 text-[11px] text-ink-46">{t('inc.needOperator')}</p>}

        <div className="md:hidden">
          <button type="button" className="btn btn-ghost btn-sm mt-2" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            <DdIcon name="filter" size={13} /> {t('inc.filters')}
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[248px_minmax(0,1fr)]">
          <FacetSidebar
            className={`self-start rounded-[5px] border border-line bg-white p-3 md:sticky md:top-[80px] md:block md:max-h-[calc(100svh-80px)] md:overflow-y-auto ${showFilters ? '' : 'hidden'}`}
            facets={facets} sel={sel}
            onToggle={(f, v) => setSel((s) => toggleFacet(s, f, v))}
            onClear={() => setSel({})}
            viewMore={t('inc.viewMore')} clearLabel={t('inc.clearFilters')}
          />
          <div className="min-w-0">
            <p className="mb-2 text-[12px] text-ink-68">{t('inc.showing', { shown: shown.length, total: rows.length })}</p>
            <section className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
              {list.isLoading ? <div className="p-3"><SkeletonRows rows={6} /></div>
                : list.isError ? <ErrorState onRetry={() => void list.refetch()} />
                : shown.length === 0 ? <EmptyState title={t('inc.empty')} body={t('inc.emptyBody')} icon="search" />
                : (
                  <table className="w-full min-w-[720px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colStatus', 'colSeverity', 'colTitle', 'colTeam', 'colEquipment', 'colOpened', 'colAge'].map((c) => (
                          <th key={c} scope="col" className="overline h-7 px-3">{t(`inc.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((i) => (
                        <tr key={i.id} tabIndex={0}
                          className={`h-10 cursor-pointer border-b border-line last:border-0 hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${openId === i.id ? 'bg-info-soft' : ''}`}
                          onClick={() => openIncident(openId === i.id ? null : i.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') openIncident(i.id); }}
                          aria-label={t('inc.openIncident', { title: i.title })}>
                          <td className="px-3"><IncStatusPill status={i.status} /></td>
                          <td className="px-3"><SeverityBadge severity={i.severity} /></td>
                          <td className="px-3 font-medium">{i.title}</td>
                          <td className="px-3 text-ink-68">{i.team ?? '—'}</td>
                          <td className="px-3 text-[12px] text-ink-68">{eqOf(i) ? eqLabel(eqOf(i)) : '—'}</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(i.created_at)}</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68">{fmtAge(i.created_at, now)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </section>
          </div>
        </div>
      </PageBody>

      {openId && orgId && (
        <IncidentPanel orgId={orgId} id={openId} operable={operable} linked={linked}
          onChanged={refresh} onClose={() => openIncident(null)} />
      )}
      <DeclareDialog dlgRef={dlg} teams={list.data?.teams ?? []} onSave={(b) => create.mutate(b)} />
    </div>
  );
}

function DeclareDialog({ dlgRef, teams, onSave }: {
  dlgRef: React.RefObject<HTMLDialogElement | null>;
  teams: { id: string; name: string }[];
  onSave: (b: { title: string; severity: IncidentSeverity; owner_team_id: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [sev, setSev] = useState<IncidentSeverity>('warning');
  const [team, setTeam] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => { dlgRef.current?.close(); setTried(false); };
  return (
    <dialog ref={dlgRef} className="m-auto w-[440px] max-w-[calc(100vw-24px)] rounded-[6px] border border-line p-0 shadow-pop backdrop:bg-black/40" aria-labelledby="inc-title">
      <form method="dialog" className="p-4" onSubmit={(e) => {
        e.preventDefault(); setTried(true);
        if (!title.trim()) return;
        onSave({ title: title.trim(), severity: sev, owner_team_id: team || null });
        setTitle(''); close();
      }}>
        <h2 id="inc-title" className="mb-3 text-[15px] font-semibold">{t('inc.declare')}</h2>
        <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-t">{t('inc.colTitle')}</label>
        <input id="inc-t" className="input mt-1 w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && !title.trim()} />
        {tried && !title.trim() && <p className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{t('inc.errTitle')}</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-s">{t('inc.colSeverity')}</label>
            <select id="inc-s" className="input mt-1 w-full" value={sev} onChange={(e) => setSev(e.target.value as IncidentSeverity)}>
              {INC_SEVS.map((s) => <option key={s} value={s}>{t(`alarms.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-ink-68" htmlFor="inc-team">{t('inc.colTeam')}</label>
            <select id="inc-team" className="input mt-1 w-full" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">—</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={close}>{t('common.close')}</button>
          <button type="submit" className="btn btn-sm">{t('inc.declare')}</button>
        </div>
      </form>
    </dialog>
  );
}
