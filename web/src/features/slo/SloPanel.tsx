// SLO detail side panel — dd pattern: right drawer over the list with a
// meta strip (time window · target · status · error budget), then tabs
// Overview / Alerts / Corrections / Audit history.
//
// Overview carries Performance: the big STATUS and ERROR BUDGET LEFT tiles,
// then the burndown and burn-rate charts rebuilt from raw tag history (the
// status endpoint only returns the whole-window aggregate — the charts are
// computed here from the same good-sample rule).
//
// Esc closes the drawer — unless a dialog (editor/confirm) or the command
// palette is open, per the single-Esc-single-layer rule.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { Pencil, Trash2, X } from 'lucide-react';
import { adminApi, api, type AuditRow } from '../../lib/api';
import { fmtAge, fmtUptime } from '../../lib/format';
import { fetchRange, RETENTION_MS } from '../query/history';
import { sortAlarms } from '../alarms/alarms';
import { EmptyState, ErrorState, Notice, PermissionNotice, Skeleton, SkeletonRows } from '../../shared/ui/Feedback';
import { AlarmStateBadge, SeverityBadge } from '../../shared/ui/Status';
import { Segmented } from '../../shared/ui/Segmented';
import { CorrectionsBody } from './SloDialogs';
import { BurndownChart, BurnRateChart } from './SloCharts';
import {
  buildBurndown, burnRates, STATUS_BAR, STATUS_CHIP, STATUS_GLYPH, STATUS_TILE,
  type SloRow,
} from './slo';
import { SLO_WINDOWS, SLO_WINDOW_KEYS, type SloWindowKey } from './prefs';
import './i18n';

const SLO_ACTIONS = [
  'slo.created', 'slo.updated', 'slo.deleted', 'slo.correction_added', 'slo.correction_removed',
] as const;

type Tab = 'overview' | 'alerts' | 'corrections' | 'audit';

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[1.2px] text-ink-46">{k}</span>
      {children}
    </span>
  );
}

export function SloPanel({ org, row, admin, win, onWin, onEdit, onDelete, onClose, onChanged }: {
  org: string; row: SloRow; admin: boolean;
  win: SloWindowKey; onWin: (w: SloWindowKey) => void;
  onEdit: () => void; onDelete: () => void; onClose: () => void; onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open], .palette-panel')) return;
      onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // "now" is pinned when the panel mounts so the chart domain is stable
  // while the drawer is open (rerenders don't re-draw the x axis).
  const [toMs] = useState(() => Date.now());
  const winMs = SLO_WINDOWS[win] * 86400e3;
  const fromMs = Math.max(toMs - winMs, toMs - RETENTION_MS);

  const hist = useQuery({
    queryKey: ['slo-hist', row.tag, win],
    queryFn: () => fetchRange(row.tag, toMs - winMs, toMs),
    enabled: !!row.tag,
    staleTime: 30_000,
  });
  const alarms = useQuery({ queryKey: ['alarms'], queryFn: api.alarms, staleTime: 15_000 });
  const audit = useQuery({
    queryKey: ['slo-audit', org, row.id],
    queryFn: async () => {
      const res = await Promise.all(SLO_ACTIONS.map((a) => adminApi.audit(org, { action: a, limit: 200 })));
      // target is {slo_id} — filter client-side to this SLO
      return res.flatMap((r) => r.items)
        .filter((it) => (it.target as { slo_id?: string } | null)?.slo_id === row.id)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    },
    enabled: admin && tab === 'audit',
  });

  const bd = hist.data ? buildBurndown(hist.data.pts, fromMs, toMs, row.target, row.corrections) : null;
  const rates = bd ? burnRates(bd.buckets, row.target) : [];
  const sliAlerts = sortAlarms((alarms.data ?? []).filter((a) => a.tag === row.tag));
  const overS = row.budgetLeft != null && row.budgetLeft < 0
    ? ((100 - row.target) / 100) * (-row.budgetLeft / 100) * row.coveredS : 0;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('slos.panel.overview') },
    { id: 'alerts', label: t('slos.panel.alerts') },
    { id: 'corrections', label: t('slos.panel.corrections') },
    { id: 'audit', label: t('slos.panel.audit') },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={row.name} tabIndex={-1}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(760px,100vw)] flex-col overflow-y-auto bg-white shadow-flyout outline-none"
      >
        {/* header: name + admin actions + close */}
        <header className="flex items-start gap-2 px-5 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold leading-7" title={row.name}>{row.name}</h2>
            {row.description && <p className="truncate text-[12px] text-ink-68" title={row.description}>{row.description}</p>}
          </div>
          {admin && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={13} aria-hidden /> {t('slos.panel.edit')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm text-[var(--color-danger)]" onClick={onDelete}>
                <Trash2 size={13} aria-hidden /> {t('slos.panel.delete')}
              </button>
            </>
          )}
          <button type="button" aria-label={t('slos.close')} onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-68 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
            <X size={16} aria-hidden />
          </button>
        </header>

        {/* meta strip: window · target · status · error budget */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-line px-5 py-2.5 text-[13px]">
          <Meta k={t('slos.window')}>
            <span className="font-mono">{win}</span>
          </Meta>
          <Meta k={t('slos.panel.target')}>
            <span className="font-mono">{row.target.toFixed(2)}%</span>
          </Meta>
          <Meta k={t('slos.panel.statusTile')}>
            <span className={`font-mono font-semibold ${STATUS_TILE[row.status].split(' ')[1]}`}>
              {row.sli == null ? '—' : `${row.sli.toFixed(2)}%`}
            </span>
          </Meta>
          <Meta k={t('slos.panel.budgetTile')}>
            <span className="inline-flex items-center gap-2">
              <span className={`font-mono font-semibold ${row.budgetLeft != null && row.budgetLeft < 0 ? 'text-sev-critical' : ''}`}>
                {row.budgetLeft == null ? '—' : `${row.budgetLeft.toFixed(0)}%`}
              </span>
              {row.budgetLeft != null && (
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className={`block h-full ${STATUS_BAR[row.status]}`}
                    style={{ width: `${Math.max(0, Math.min(100, row.budgetLeft))}%` }} />
                </span>
              )}
            </span>
          </Meta>
        </div>

        {/* tabs */}
        <div role="tablist" aria-label={row.name} className="flex gap-1 border-b border-line px-5">
          {TABS.map((tb) => (
            <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id}
              onClick={() => setTab(tb.id)}
              className={`border-b-2 px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                tab === tb.id ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
              }`}>
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-subtle/40 p-4">
          {tab === 'overview' && (
            <Overview
              row={row} win={win} onWin={onWin} admin={admin}
              hist={hist} bd={bd} rates={rates} overS={overS} toMs={toMs}
              truncated={hist.data?.truncated ?? false}
            />
          )}
          {tab === 'alerts' && (
            <div className="rounded-[5px] border border-line bg-white">
              {alarms.isLoading ? <div className="p-4"><SkeletonRows rows={3} /></div>
                : alarms.isError ? <ErrorState compact onRetry={() => void alarms.refetch()} />
                : sliAlerts.length === 0 ? (
                  <EmptyState compact icon="bell" title={t('slos.panel.noAlerts')} body={t('slos.panel.noAlertsBody', { tag: row.tag })} />
                ) : (
                  <>
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-left">
                          {[t('alarms.time'), t('alarms.severity'), t('alarms.alarm'), t('alarms.state'), t('alarms.ackedByCol')].map((h, i) => (
                            <th key={i} scope="col" className="overline h-7 px-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sliAlerts.map((a) => (
                          <tr key={a.id} className="h-9 border-b border-line last:border-0 hover:bg-info-soft">
                            <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68">{fmtAge(a.ts)}</td>
                            <td className="px-3"><SeverityBadge severity={a.severity} /></td>
                            <td className="max-w-0 truncate px-3" title={a.rule}>
                              <NavLink to={`/alarms?alarm=${encodeURIComponent(String(a.id))}`} className="text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">
                                {a.rule}
                              </NavLink>
                            </td>
                            <td className="px-3"><AlarmStateBadge state={a.state} ackedBy={a.acked_by} /></td>
                            <td className="px-3 text-[12px] text-ink-68">{a.acked_by ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-3 py-2 text-right text-[11px] text-ink-46">
                      <NavLink to={`/alarms?q=${encodeURIComponent(row.tag)}`} className="text-blue hover:underline">
                        {t('slos.openAlarms')}
                      </NavLink>
                    </p>
                  </>
                )}
            </div>
          )}
          {tab === 'corrections' && (
            <div className="rounded-[5px] border border-line bg-white p-4">
              <CorrectionsBody org={org} slo={row} admin={admin} onChanged={onChanged} />
            </div>
          )}
          {tab === 'audit' && (
            <div className="rounded-[5px] border border-line bg-white">
              {!admin ? <div className="p-4"><PermissionNotice role="admin" /></div>
                : audit.isLoading ? <div className="p-4"><SkeletonRows rows={3} /></div>
                : audit.isError ? <ErrorState compact onRetry={() => void audit.refetch()} />
                : (audit.data ?? []).length === 0 ? (
                  <EmptyState compact icon="search" title={t('slos.panel.auditEmpty')} body={t('slos.panel.auditHint')} />
                ) : (
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {[t('slos.panel.colWhen'), t('slos.panel.colActor'), t('slos.panel.colAction'), t('slos.panel.colDetail')].map((h, i) => (
                          <th key={i} scope="col" className="overline h-7 px-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(audit.data ?? []).map((it: AuditRow) => (
                        <tr key={it.seq} className="h-9 border-b border-line last:border-0">
                          <td className="whitespace-nowrap px-3 font-mono text-[12px] text-ink-68" title={it.at}>
                            {new Date(it.at).toLocaleString(i18n.language)}
                          </td>
                          <td className="px-3 font-mono text-[12px]">{String(it.actor).replace(/^user:/, '')}</td>
                          <td className="px-3">{t(`slos.panel.auditAction.${it.action}`, { defaultValue: it.action })}</td>
                          <td className="max-w-0 truncate px-3 font-mono text-[11px] text-ink-68" title={JSON.stringify(it.detail)}>
                            {it.detail && typeof it.detail === 'object'
                              ? Object.entries(it.detail as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------------------- Overview tab ---------------------------- */

function Overview({ row, win, onWin, admin, hist, bd, rates, overS, truncated, toMs }: {
  row: SloRow; win: SloWindowKey; onWin: (w: SloWindowKey) => void; admin: boolean;
  hist: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  bd: ReturnType<typeof buildBurndown> | null; rates: (number | null)[];
  overS: number; truncated: boolean; toMs: number;
}) {
  const { t, i18n } = useTranslation();
  const fromMs = bd && bd.buckets.length ? bd.buckets[0].t0 : toMs;
  void admin;
  return (
    <div className="space-y-4">
      {/* identity rows — creator/team aren't in the SLO contract; what exists:
          signal, equipment, type, updated, and the tag chips. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 rounded-[5px] border border-line bg-white px-4 py-3 text-[13px]">
        <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.signal')}</dt>
        <dd className="truncate font-mono" title={row.tag}>{row.tag || '—'}</dd>
        <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.equipment')}</dt>
        <dd>{row.equipment === 'other' ? t('slos.otherArea') : t(`line.${row.equipment}`, { defaultValue: row.equipment })}</dd>
        <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.type')}</dt>
        <dd>{t('slos.typeAvailability')}</dd>
        <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.updated')}</dt>
        <dd>{fmtAge(row.updated_at)}</dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {[`type:availability`, row.equipment !== 'other' && `equipment:${row.equipment}`, row.tag && `signal:${row.tag}`]
          .filter((x): x is string => typeof x === 'string')
          .map((tag) => (
            <span key={tag} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink-68">{tag}</span>
          ))}
      </div>

      <details className="rounded-[5px] border border-line bg-white px-4 py-2.5">
        <summary className="cursor-pointer text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-blue">{t('slos.panel.details')}</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 pb-1 text-[13px]">
          {row.description && (
            <>
              <dt className="text-ink-46">{t('slos.fDesc')}</dt>
              <dd>{row.description}</dd>
            </>
          )}
          <dt className="text-ink-46">{t('slos.panel.target')}</dt><dd className="font-mono">{row.target.toFixed(2)}%</dd>
          <dt className="text-ink-46">{t('slos.panel.warningAt')}</dt><dd className="font-mono">{row.warning.toFixed(2)}%</dd>
          <dt className="text-ink-46">{t('slos.panel.correctionCount')}</dt><dd>{row.corrections.length}</dd>
          <dt className="text-ink-46">{t('slos.panel.excluded')}</dt><dd>{t('slos.panel.excludedN', { count: row.excluded })}</dd>
        </dl>
      </details>

      {/* Performance */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-[14px] font-semibold">{t('slos.panel.performance')}</h3>
          <span className="flex-1" />
          <Segmented value={win} onChange={(v) => onWin(v as SloWindowKey)} label={t('slos.window')}
            options={SLO_WINDOW_KEYS.map((w) => ({ value: w, label: w }))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[5px] border border-line bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.statusTile')}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`font-mono text-[28px] font-semibold leading-none ${STATUS_TILE[row.status].split(' ')[1]}`}>
                {row.sli == null ? '—' : `${row.sli.toFixed(2)}%`}
              </span>
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[row.status]}`}>
                <span aria-hidden>{STATUS_GLYPH[row.status]}</span>{t(`slos.status.${row.status}`)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-ink-46">{t('slos.panel.ofTarget', { target: row.target })}</p>
          </div>
          <div className="rounded-[5px] border border-line bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-46">{t('slos.panel.budgetTile')}</p>
            <div className="mt-1 font-mono text-[28px] font-semibold leading-none">
              {row.budgetLeft == null ? '—' : `${row.budgetLeft.toFixed(0)}%`}
              {overS > 0 && <span className="ml-2 text-[12px] font-normal text-sev-critical">({t('slos.panel.overBy', { dur: fmtUptime(overS) })})</span>}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className={`h-full ${STATUS_BAR[row.status]}`}
                style={{ width: `${Math.max(0, Math.min(100, row.budgetLeft ?? 0))}%` }} />
            </div>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-46">
          {t('slos.panel.samples', { count: row.samples })}
          {row.excluded > 0 && ` · ${t('slos.panel.excludedN', { count: row.excluded })}`}
          {` · ${t('slos.panel.coverage', { span: fmtUptime(Math.min(row.coveredS, SLO_WINDOWS[win] * 86400)) })}`}
        </p>
      </div>

      {/* charts */}
      {hist.isLoading ? <div className="rounded-[5px] border border-line bg-white p-4"><Skeleton h={190} /></div>
        : hist.isError ? <ErrorState compact onRetry={() => void hist.refetch()} />
        : !bd || bd.totalSamples === 0 ? (
          <EmptyState compact icon="search" title={t('slos.panel.noHistory')} body={t('slos.panel.noHistoryBody')} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[5px] border border-line bg-white p-3">
              <h3 className="mb-1 text-[13px] font-semibold">{t('slos.panel.burndown')}</h3>
              <BurndownChart from={fromMs} to={toMs} bd={bd} corrections={row.corrections} />
            </div>
            <div className="rounded-[5px] border border-line bg-white p-3">
              <h3 className="mb-1 text-[13px] font-semibold">{t('slos.panel.burnRate')}</h3>
              <BurnRateChart from={fromMs} to={toMs} buckets={bd.buckets} rates={rates} corrections={row.corrections} />
            </div>
          </div>
        )}
      {truncated && <Notice tone="warn">{t('slos.panel.cappedNote')}</Notice>}
      <p className="text-[11px] text-ink-46" lang={i18n.language}>
        {t('slos.panel.coverage', { span: fmtUptime(Math.min(row.coveredS, SLO_WINDOWS[win] * 86400)) })}
      </p>
    </div>
  );
}
