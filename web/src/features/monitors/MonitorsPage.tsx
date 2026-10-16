// Monitors — the Monitoring group's own landing page (dd "Monitors › List").
// A monitor is an alarm rule with the live state of its alarms. Facet
// sidebar on the left (status / priority / muted / type / equipment /
// signal), omnibar + status-grouped list on the right. Tabs jump to the
// sibling Monitoring pages so the flyout's title always lands somewhere.

import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS } from '../../lib/plant';
import { canAdmin } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { useAlarms } from '../alarms/alarms';
import { PageBar, PageBody, type PageTab } from '../../shared/ui/Page';
import { SeverityBadge } from '../../shared/ui/Status';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { DdIcon } from '../../shared/ui/DdIcon';
import { Icon } from '../../shared/ui/Icon';
import { FacetSidebar, passesFacets, toggleFacet, type FacetDef, type FacetSel } from '../../shared/ui/Facets';
import { SavedViews } from '../../shared/ui/SavedViews';
import { ExportCsvButton } from '../../shared/ui/ExportCsv';
import { matchMonitor, monitorRows, STATUS_ORDER, type MonitorRow, type MonStatus } from './monitors';
import './i18n';

const STATUS_STYLE: Record<MonStatus, string> = {
  alert: 'bg-sev-high text-white',
  warn: 'bg-sev-medium text-sev-ink',
  nodata: 'bg-sev-info text-white',
  ok: 'bg-[var(--color-ok)] text-white',
  disabled: 'bg-subtle text-ink-46 border border-line',
};
const STATUS_STRIPE: Record<MonStatus, string> = {
  alert: 'bg-[var(--color-danger-bright)]', warn: 'bg-[var(--color-warn)]', nodata: 'bg-[var(--color-muted-pill)]',
  ok: 'bg-[var(--color-ok)]', disabled: 'bg-line-hard',
};

export function StatusPill({ status }: { status: MonStatus }) {
  const { t } = useTranslation();
  return <span className={`inline-flex h-5 items-center rounded-[3px] px-1.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>{t(`mon.${status}`)}</span>;
}

export function useMonitoringTabs(): PageTab[] {
  const { t } = useTranslation();
  return [
    { to: '/monitors', label: t('mon.list'), end: true },
    { to: '/monitors/templates', label: t('mon.templates'), end: true },
    { to: '/alarms', label: t('mon.triggered'), end: true },
    { to: '/downtimes', label: t('mon.downtimes') },
    { to: '/alarms/quality', label: t('mon.quality') },
  ];
}

export function MonitorsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow(5000);
  useStore(() => live.seedRev);
  const { all } = useAlarms();
  const { orgRole } = useAdminOrg();
  const tabs = useMonitoringTabs();
  const rules = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  // ?q= and ?status= are the shareable state (dd saved-view contract): the
  // URL round-trips into search + the status facet; the other facets stay
  // in-memory so the URL doesn't sprawl.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const setQ = (v: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (v) next.set('q', v); else next.delete('q');
    return next;
  }, { replace: true });
  const statusSel = useMemo(() => new Set(
    (params.get('status') ?? '').split(',').filter((s): s is MonStatus => (STATUS_ORDER as string[]).includes(s)),
  ), [params]);
  const [sel, setSel] = useState<FacetSel>({}); // non-status facets
  const merged = useMemo<FacetSel>(() => ({ ...sel, status: statusSel }), [sel, statusSel]);
  const toggle = (f: string, v: string) => {
    if (f === 'status') {
      const next = new Set(statusSel);
      if (next.has(v as MonStatus)) next.delete(v as MonStatus); else next.add(v as MonStatus);
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next.size) p.set('status', [...next].join(',')); else p.delete('status');
        return p;
      }, { replace: true });
      return;
    }
    setSel((s) => toggleFacet(s, f, v));
  };
  const clearAll = () => {
    setSel({});
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('status'); return p; }, { replace: true });
  };
  const [showFilters, setShowFilters] = useState(false); // phones: facets collapse behind a button

  const signalLabel = (tag: string) => (SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : tag);
  const rows = useMemo(() => monitorRows(rules.data ?? [], all, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules.data, all, Math.floor(now / 5000)]);

  const pick = (r: MonitorRow) => (f: string): string | string[] => {
    switch (f) {
      case 'status': return r.status;
      case 'severity': return r.severity;
      case 'muted': return r.muted ? 'yes' : 'no';
      case 'kind': return r.rule.kind;
      case 'area': return r.area || 'other';
      case 'signal': return r.rule.tag ?? '';
      default: return '';
    }
  };

  const base = useMemo(() => rows.filter((r) => matchMonitor(r, q, signalLabel)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, q]);
  const visible = base.filter((r) => passesFacets(merged, pick(r)));

  // counts per facet value ignore that facet's own selection (dd behaviour)
  const count = (facet: string, value: string) =>
    base.filter((r) => passesFacets(merged, pick(r), facet) && [pick(r)(facet)].flat().includes(value)).length;
  const uniq = (f: string) => [...new Set(rows.map((r) => pick(r)(f) as string))].filter(Boolean).sort();
  const facets: FacetDef[] = [
    { id: 'status', title: t('mon.fStatus'), values: STATUS_ORDER.map((s) => ({
      value: s, label: t(`mon.${s}`), count: count('status', s), mark: <span aria-hidden className={`h-3 w-1 rounded-sm ${STATUS_STRIPE[s]}`} />,
    })) },
    { id: 'muted', title: t('mon.fMuted'), values: [
      { value: 'yes', label: t('mon.muted'), count: count('muted', 'yes') },
      { value: 'no', label: t('mon.notMuted'), count: count('muted', 'no') },
    ] },
    { id: 'severity', title: t('mon.fSeverity'), values: (['critical', 'warning', 'info'] as const).map((s) => ({
      value: s, label: <SeverityBadge severity={s} />, count: count('severity', s),
    })) },
    { id: 'kind', title: t('mon.fKind'), values: uniq('kind').map((k) => ({ value: k, label: t(`mon.kind.${k}`, { defaultValue: k }), count: count('kind', k) })) },
    { id: 'area', title: t('mon.fArea'), values: uniq('area').map((a) => ({ value: a, label: a === 'other' ? t('mon.otherArea') : t(`line.${a}`, { defaultValue: a }), count: count('area', a) })) },
    { id: 'signal', title: t('mon.fSignal'), limit: 5, values: uniq('signal').map((s) => ({ value: s, label: signalLabel(s), count: count('signal', s) })) },
  ];

  const groups = STATUS_ORDER.map((s) => ({ s, list: visible.filter((r) => r.status === s) })).filter((g) => g.list.length);
  const cond = (r: MonitorRow['rule']) => {
    if (r.kind === 'stale') return t('mon.cond.stale', { v: r.stale_s ?? '—' });
    if (r.kind === 'roc') return t('mon.cond.roc', { v: r.threshold ?? '—' });
    if (r.threshold == null) return t('mon.cond.none');
    return t(r.kind === 'lo' || r.kind === 'lolo' ? 'mon.cond.lt' : 'mon.cond.gt', { v: r.threshold });
  };
  const open = (r: MonitorRow) => navigate(`/alarms?q=${encodeURIComponent(r.rule.name)}`);

  const CSV_COLS = [
    { key: 'status', label: t('mon.colStatus') },
    { key: 'name', label: t('mon.colName') },
    { key: 'condition', label: t('mon.colCondition') },
    { key: 'severity', label: t('mon.colSeverity') },
    { key: 'area', label: t('mon.colArea') },
    { key: 'tag', label: 'tag' },
    { key: 'open', label: 'open' },
    { key: 'muted', label: 'muted' },
  ];

  return (
    <>
      <PageBar
        icon="monitor" title={t('mon.title')} tabs={tabs}
        actions={(
          <>
            <SavedViews page="monitors" />
            <ExportCsvButton
              name="monitors"
              columns={CSV_COLS}
              count={visible.length}
              rows={() => visible.map((r) => ({
                status: t(`mon.${r.status}`), name: r.rule.name,
                condition: `${t(`mon.kind.${r.rule.kind}`, { defaultValue: r.rule.kind })} ${cond(r.rule)}`,
                severity: r.severity, area: r.area || '', tag: r.rule.tag ?? '',
                open: r.open, muted: r.muted ? 'yes' : 'no',
              }))}
            />
            <NavLink to="/alarms/settings" className="btn btn-ghost btn-sm"><DdIcon name="cog" size={13} /> {t('mon.settings')}</NavLink>
            {canAdmin(orgRole ?? 'none') && (
              <NavLink to="/admin/rules/new" className="btn btn-sm"><DdIcon name="plus" size={12} /> {t('mon.newRule')}</NavLink>
            )}
          </>
        )}
      />
      <div className="px-4 pt-3 md:hidden">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}><DdIcon name="filter" size={13} /> {t('mon.filters')}</button>
      </div>
      <div className="grid md:grid-cols-[248px_minmax(0,1fr)]">
        <FacetSidebar
          className={`border-b border-line bg-white p-3 md:sticky md:top-[80px] md:block md:max-h-[calc(100svh-80px)] md:overflow-y-auto md:border-b-0 md:border-r ${showFilters ? '' : 'hidden'}`}
          facets={facets} sel={merged}
          onToggle={toggle}
          onClear={clearAll}
          viewMore={t('mon.viewMore')} clearLabel={t('mon.clear')}
        />
        <PageBody className="min-w-0">
          <div className="relative">
            <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
            <input className="input w-full pl-7" placeholder={t('mon.search')} aria-label={t('mon.searchLabel')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rules.isError ? <ErrorState onRetry={() => rules.refetch()} />
            : rules.isLoading ? <SkeletonRows rows={6} />
            : rows.length === 0 ? <EmptyState title={t('mon.noRules')} body={t('mon.noRulesBody')} icon="bell" />
            : visible.length === 0 ? <EmptyState title={t('mon.empty')} body={t('mon.emptyBody')} icon="search" />
            : (
              <div className="overflow-x-auto rounded-[5px] border border-line bg-white shadow-card">
                <table className="w-full min-w-[720px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {['colStatus', 'colName', 'colCondition', 'colSeverity', 'colArea'].map((c) => <th key={c} scope="col" className="overline h-7 px-3">{t(`mon.${c}`)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(({ s, list }) => (
                      <Fragment key={s}>
                        <tr className="border-b border-line bg-subtle">
                          <td colSpan={5} className="h-8 px-3 text-[12px] font-semibold text-ink-68">
                            <span className="inline-flex items-center gap-2">
                              <span aria-hidden className={`h-3 w-1 rounded-sm ${STATUS_STRIPE[s]}`} />{t(`mon.${s}`)}
                              <span className="rounded-full bg-line px-1.5 font-mono text-[10px] text-ink-68">{list.length}</span>
                            </span>
                          </td>
                        </tr>
                        {list.map((r) => (
                          <tr
                            key={r.key} tabIndex={0}
                            className="h-10 cursor-pointer border-b border-line last:border-0 hover:bg-info-soft focus-visible:bg-info-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
                            onClick={() => open(r)}
                            onKeyDown={(e) => { if (e.key === 'Enter') open(r); }}
                          >
                            <td className="px-3"><StatusPill status={r.status} /></td>
                            <td className="px-3 py-1.5">
                              <span className="block font-semibold">{r.rule.name}</span>
                              <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-46">
                                {r.rule.tag && <span className="font-mono">{r.rule.tag}</span>}
                                {r.open > 0 && <span className="text-ink-68">{t('mon.openAlarms', { count: r.open })}</span>}
                                {r.muted && <span title={t('mon.mutedHint')}><DdIcon name="bell-slashed" size={11} className="inline" /> {t('mon.muted')}</span>}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68">{t(`mon.kind.${r.rule.kind}`, { defaultValue: r.rule.kind })} {cond(r.rule)}</td>
                            <td className="px-3"><SeverityBadge severity={r.severity} /></td>
                            <td className="px-3 text-[12px] text-ink-68">{r.area ? t(`line.${r.area}`, { defaultValue: r.area }) : '—'}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {!rules.isLoading && rows.length > 0 && <p className="text-[11px] text-ink-46">{t('mon.showing', { shown: visible.length, total: rows.length })}</p>}
        </PageBody>
      </div>
    </>
  );
}
