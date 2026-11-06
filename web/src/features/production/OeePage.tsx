// OEE page — A/P/Q cards per machine and totals, downtime Pareto, weekly
// trend. Filters (machine, range, shift) live in the URL per U4.
// Bars are CSS-only (design system has no chart lib dependency for this).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { PageBar, PageBody, Card, Table } from '../../shared/ui/Page';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { useAdminOrg, useAdminSite } from '../admin/admin';
import { prodApi } from './api';
import './i18n';
import { fmtDuration, localName } from './names';

type RangeKey = '24h' | '7d' | '30d';
const RANGES: RangeKey[] = ['24h', '7d', '30d'];
// Look-back window in seconds, applied client-side to produce from/to.
const RANGE_S: Record<RangeKey, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };

/** Fraction (0–1) → percent string; nulls render as a dash. */
function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** One A/P/Q/OEE headline figure. */
function FactorCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-[130px] flex-1 rounded-[5px] border border-line bg-paper p-3 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{label}</div>
      <div className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-ink">{pct(value)}</div>
    </div>
  );
}

export function OeePage() {
  const { t, i18n } = useTranslation();
  const { orgId } = useAdminOrg();
  const { site } = useAdminSite(orgId);
  const [params, setParams] = useSearchParams();
  const rawRange = params.get('range') ?? '';
  const range: RangeKey = RANGES.includes(rawRange as RangeKey) ? rawRange as RangeKey : '24h';
  const device = params.get('device') ?? '';
  const shift = params.get('shift') ?? '';
  const set = (k: string, v: string) => {
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  };

  const oeeQ = useQuery({
    queryKey: ['prod-oee', orgId, site?.id, range, device, shift],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - RANGE_S[range] * 1000);
      return prodApi.oee(orgId!, site!.id, {
        from: from.toISOString(), to: to.toISOString(),
        device: device || undefined, shift: shift || undefined,
      });
    },
    enabled: !!orgId && !!site,
  });
  const machinesQ = useQuery({
    queryKey: ['prod-machines', orgId, site?.id],
    queryFn: () => prodApi.machines(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });
  const shiftsQ = useQuery({
    queryKey: ['prod-shifts', orgId, site?.id],
    queryFn: () => prodApi.shifts(orgId!, site!.id),
    enabled: !!orgId && !!site,
  });
  const paretoQ = useQuery({
    queryKey: ['prod-pareto', orgId, site?.id, device, oeeQ.data?.from, oeeQ.data?.to],
    queryFn: () => prodApi.pareto(orgId!, site!.id, {
      from: oeeQ.data!.from!, to: oeeQ.data!.to!, device: device || undefined,
    }),
    enabled: !!orgId && !!site && !!oeeQ.data?.from && !!oeeQ.data?.to,
  });
  const trendQ = useQuery({
    queryKey: ['prod-trend', orgId, site?.id, device],
    queryFn: () => prodApi.trend(orgId!, site!.id, 8, { device: device || undefined }),
    enabled: !!orgId && !!site,
  });

  const machines = machinesQ.data?.items ?? [];
  const shifts = shiftsQ.data?.items ?? [];
  const d = oeeQ.data;
  const err = oeeQ.error ?? machinesQ.error;
  const stopsUrl = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ needs_reason: 'all' });
    if (d?.from) q.set('from', d.from);
    if (d?.to) q.set('to', d.to);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `/production/stops?${q}`;
  };

  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <PageBar
        icon="metric" title={t('prod.oeeTitle')} lede={t('prod.oeeLede')}
        actions={
          <>
            <select className="input h-8 w-auto text-[12px]" value={device}
              onChange={(e) => set('device', e.target.value)} aria-label={t('prod.machine')}>
              <option value="">{t('prod.allMachines')}</option>
              {machines.filter((m) => m.configured).map((m) => (
                <option key={m.device_id} value={m.device_id}>{localName(m.name, i18n.language)}</option>))}
            </select>
            <select className="input h-8 w-auto text-[12px]" value={shift}
              onChange={(e) => set('shift', e.target.value)} aria-label={t('prod.shift')}>
              <option value="">{t('prod.allShifts')}</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{localName(s.name, i18n.language)}</option>)}
            </select>
            <Segmented<RangeKey> label={t('prod.oeeTitle')} value={range}
              options={RANGES.map((r) => ({ value: r, label: t(`prod.range${r}`) }))}
              onChange={(v) => set('range', v)} />
          </>
        }
      />
      <PageBody>
        {err && <ErrorState onRetry={() => oeeQ.refetch()} />}
        {oeeQ.isLoading && !err && <SkeletonRows rows={6} h={40} />}
        {!oeeQ.isLoading && !err && machines.filter((m) => m.configured).length === 0 && (
          <EmptyState title={t('prod.noMachines')} body={t('prod.noMachinesHint')} icon="gauge" />
        )}
        {d && machines.some((m) => m.configured) && (
          <>
            <div className="flex flex-wrap gap-3">
              <Link to={stopsUrl({ device, shift })} className="min-w-[130px] flex-1" aria-label={`${t('prod.availability')} — ${t('prod.seeStops')}`}>
                <FactorCard label={t('prod.availability')} value={d.totals.availability} />
              </Link>
              <FactorCard label={t('prod.performance')} value={d.totals.performance} />
              <FactorCard label={t('prod.quality')} value={d.totals.quality} />
              <FactorCard label="OEE" value={d.totals.oee} />
            </div>

            <Card title={t('prod.colMachine')}>
              <div className="overflow-x-auto">
                <Table head={[
                  t('prod.colMachine'), t('prod.colLine'), t('prod.availability'),
                  t('prod.performance'), t('prod.quality'), 'OEE',
                  t('prod.runTime'), t('prod.plannedTime'), t('prod.units'), t('prod.rejects'),
                ]}>
                  {d.machines.map((m) => (
                    <tr key={m.device_id}>
                      <td className="font-medium">
                        <Link className="underline decoration-dotted underline-offset-2" to={stopsUrl({ device: m.device_id, shift })}
                          aria-label={`${localName(m.name, i18n.language)} — ${t('prod.seeStops')}`}>
                          {localName(m.name, i18n.language)}
                        </Link>
                      </td>
                      <td className="text-ink-68">{localName(m.line, i18n.language)}</td>
                      <td className="font-mono tabular-nums">{pct(m.availability)}</td>
                      <td className="font-mono tabular-nums">{pct(m.performance)}</td>
                      <td className="font-mono tabular-nums">{pct(m.quality)}</td>
                      <td className="font-mono font-semibold tabular-nums">{pct(m.oee)}</td>
                      <td className="font-mono tabular-nums text-ink-68">{Math.round(m.run_s)}s</td>
                      <td className="font-mono tabular-nums text-ink-68">{Math.round(m.planned_s)}s</td>
                      <td className="font-mono tabular-nums">{m.units}</td>
                      <td className="font-mono tabular-nums">{m.rejects}</td>
                    </tr>
                  ))}
                  {d.machines.length === 0 && (
                    <tr><td colSpan={10}><EmptyState compact title={t('prod.noOee')} body={t('prod.noOeeHint')} /></td></tr>
                  )}
                </Table>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title={t('prod.paretoTitle')}>
                {paretoQ.isLoading ? <SkeletonRows rows={4} /> : (paretoQ.data?.items.length ?? 0) === 0 ? (
                  <EmptyState compact title={t('prod.paretoEmpty')} />
                ) : (
                  <ul className="space-y-2" aria-label={t('prod.paretoTitle')}>
                    {paretoQ.data!.items.map((r) => (
                      <li key={r.reason_id ?? 'none'}>
                        <div className="flex items-baseline justify-between gap-2 text-[12px]">
                          <Link className="min-w-0 truncate underline decoration-dotted underline-offset-2"
                            to={stopsUrl({ device, reason_id: r.reason_id ?? 'unclassified' })}>
                            {(i18n.language === 'th' ? r.name_th || r.name_en : r.name_en || r.name_th) || r.code || t('prod.unclassified')}
                          </Link>
                          <span className="shrink-0 font-mono tabular-nums text-ink-68">
                            {fmtDuration(r.seconds, i18n.language)} · {r.count}×
                          </span>
                        </div>
                        <div className="mt-0.5 h-2 rounded bg-subtle" role="img"
                          aria-label={`${pct(r.pct)}`}>
                          <div className="h-2 rounded bg-blue" style={{ width: `${((r.pct ?? 0) * 100).toFixed(1)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={t('prod.trendTitle')}>
                {trendQ.isLoading ? <SkeletonRows rows={4} /> : (
                  <div className="overflow-x-auto">
                    <Table head={[t('prod.week'), t('prod.availability'), t('prod.performance'), t('prod.quality'), 'OEE']}>
                      {(trendQ.data?.items ?? []).map((w) => (
                        <tr key={w.week}>
                          <td className="font-mono tabular-nums text-ink-68">{w.week}</td>
                          <td className="font-mono tabular-nums">{pct(w.availability)}</td>
                          <td className="font-mono tabular-nums">{pct(w.performance)}</td>
                          <td className="font-mono tabular-nums">{pct(w.quality)}</td>
                          <td className="font-mono font-semibold tabular-nums">{pct(w.oee)}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </div>
  );
}
