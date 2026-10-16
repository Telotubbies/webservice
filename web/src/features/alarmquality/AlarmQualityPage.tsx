// Alarm quality — ISA-18.2 performance from the backend's real alarm table
// (GET /api/v1/orgs/{org}/alarm-quality): rate per operator-hour, 10-minute
// flood peak, standing + never-acked counts, per-rule bad actors. The demo
// client-side computation was removed — this page shows server numbers.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { SeverityBadge } from '../../shared/ui/Status';
import { notifyApi } from '../notify/api';
import { usePrimaryScope } from '../admin/admin';
import { enabled } from '../../lib/features';
import './i18n';

const H = 3600_000;
const FLOOD_10M = 10;
const TOP_N = 10;
const WINDOWS = [24, 72, 168] as const;

const rateLevel = (r: number) => (r > 12 ? 'overloaded' : r > 6 ? 'manageable' : 'ok');

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-[5px] border border-line bg-white p-3">
      <p className="text-[12px] text-ink-68">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none text-ink">{value}</p>
      {tone && <p className="mt-1 text-[12px] font-semibold text-ink">{tone}</p>}
      <p className="mt-1 text-[11px] text-ink-46">{hint}</p>
    </div>
  );
}

export function AlarmQualityPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const [hours, setHours] = useState<number>(24);
  const [q, setQ] = useState('');
  const [offSev, setOffSev] = useState<Set<string>>(new Set());
  const [offFlag, setOffFlag] = useState<Set<string>>(new Set());

  const qy = useQuery({
    queryKey: ['alarm-quality', orgId, siteId, hours],
    queryFn: () => notifyApi.quality(orgId!, hours, siteId ?? undefined),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const m = qy.data;
  const mins = (s: number | null) => {
    if (s == null) return '—';
    const ms = s * 1000;
    return ms >= H ? t('aq.hrs', { n: (ms / H).toFixed(1) }) : t('aq.mins', { n: Math.max(1, Math.round(ms / 60_000)) });
  };

  const rows = (m?.rules ?? [])
    .filter((r) => !offSev.has(r.severity))
    .filter((r) => r.flags.length === 0 ? !offFlag.has('none') : r.flags.some((f) => !offFlag.has(f)))
    .filter((r) => r.rule.toLowerCase().includes(q.toLowerCase()));
  const max = Math.max(1, ...(m?.hourly ?? [0]));
  const findings = m ? ([
    m.rules.length > TOP_N && m.top10_share > 0.8 && ['fFrequent', TOP_N, Math.round(m.top10_share * 100)],
    m.rules.some((r) => r.chatter) && ['fChatter', m.rules.filter((r) => r.chatter).length],
    m.rules.some((r) => r.standing) && ['fStanding', m.rules.filter((r) => r.standing).length],
    m.rules.some((r) => r.unacked) && ['fUnacked', m.rules.filter((r) => r.unacked).length],
  ].filter(Boolean) as [string, number, number?][]) : [];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="bell-curve" title={t('aq.product')} lede={t('aq.lede', { n: m?.total ?? 0 })}
        tabs={[
          { to: '/alarms', label: t('aq.tabList'), end: true },
          { to: '/admin/rules', label: t('aq.tabRules') },
          { to: '/alarms/quality', label: t('aq.tabQuality') },
          ...(enabled('alarmsettings') ? [{ to: '/alarms/settings', label: t('aq.tabSettings') }] : []),
        ]} />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-2 text-[12px] text-ink-68">
          <span>{t('aq.windowLabel')}</span>
          <select className="input h-7 text-[12px]" aria-label={t('aq.windowLabel')}
            value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {WINDOWS.map((h) => <option key={h} value={h}>{t('aq.hours', { n: h })}</option>)}
          </select>
        </div>
        {qy.isError && <Notice tone="warn">{t('common.loadFailed', { defaultValue: 'Could not load alarm history.' })}</Notice>}
        {qy.isLoading ? null : !m || m.total === 0 ? (
          <EmptyState title={t('aq.empty')} body={t('aq.emptyBody')} icon="search" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label={t('aq.kpiRate')} value={m.alarms_per_operator_hour.toFixed(1)} tone={t(`aq.${rateLevel(m.alarms_per_operator_hour)}`)} hint={t('aq.kpiRateHint', { n: m.operators })} />
              <Kpi label={t('aq.kpiPeak')} value={String(m.peak_10m)} tone={m.peak_10m > FLOOD_10M ? t('aq.flood') : t('aq.ok')} hint={t('aq.kpiPeakHint')} />
              <Kpi label={t('aq.kpiStanding')} value={String(m.standing)} hint={t('aq.kpiStandingHint')} />
              <Kpi label={t('aq.kpiUnacked')} value={String(m.unacked)} hint={t('aq.kpiUnackedHint')} />
            </div>

            <section className="rounded-[5px] border border-line bg-white p-3" aria-label={t('aq.rateChart')}>
              <h2 className="mb-2 text-[13px] font-semibold">{t('aq.rateChart')}</h2>
              <div className="relative flex h-24 items-end gap-1">
                {[6, 12].map((l) => (
                  <span key={l} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line-hard" style={{ bottom: `${Math.min(100, (l / max) * 100)}%` }}>
                    <span className="bg-white pr-1 text-[10px] text-ink-46">{t(l === 6 ? 'aq.target6' : 'aq.target12')}</span>
                  </span>
                ))}
                {m.hourly.map((n, i) => (
                  <span key={i} className="flex-1 bg-[var(--color-blue)]" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }}
                    title={`${n} ${t('aq.rateUnit')}`} />
                ))}
              </div>
            </section>

            <section aria-label={t('aq.findings')}>
              <h2 className="mb-2 text-[13px] font-semibold">{t('aq.findings')}</h2>
              {findings.length === 0 ? (
                <Notice tone="info"><b>{t('aq.fNone')}</b> {t('aq.fNoneBody')}</Notice>
              ) : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {findings.map(([k, n, pct]) => (
                    <li key={k} className="rounded-[5px] border border-line bg-white p-3">
                      <p className="text-[13px] font-semibold">{t(`aq.${k}`, { n })}</p>
                      <p className="mt-0.5 text-[12px] text-ink-68">{t(`aq.${k}Body`, { pct })}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex gap-4">
              <aside className="w-[220px] shrink-0 self-start border border-line bg-white">
                <FacetGroup title={t('aq.facetSev')} off={offSev} emptyLabel={t('aq.noValues')} onToggle={(v) => setOffSev((s) => toggleIn(s, v))}
                  options={facetOptions(m.rules, (r) => r.severity, (v) => t(`alarms.${v}`, { defaultValue: v }))} />
                <FacetGroup title={t('aq.facetFlag')} off={offFlag} emptyLabel={t('aq.noValues')} onToggle={(v) => setOffFlag((s) => toggleIn(s, v))}
                  options={(['frequent', 'chatter', 'standing', 'unacked'] as const).map((f) => ({ value: f, label: t(`aq.flag.${f}`), count: m.rules.filter((r) => r.flags.includes(f)).length }))} />
              </aside>
              <section className="min-w-0 flex-1" aria-label={t('aq.badActors')}>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
                  <input className="input w-full pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('aq.searchPh')} aria-label={t('aq.searchPh')} />
                </div>
                <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colRule', 'colSev', 'colCount', 'colShare', 'colChatter', 'colStanding', 'colUnacked', 'colMtta', 'colFlags'].map((c) => (
                          <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`aq.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.rule_id} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                          <td className="px-3 font-medium"><Link to={`/alarms?rule=${encodeURIComponent(r.rule)}`} className="hover:text-blue hover:underline">{r.rule}</Link></td>
                          <td className="px-3"><SeverityBadge severity={r.severity} /></td>
                          <td className="px-3 font-mono">{r.count}</td>
                          <td className="px-3 font-mono">{Math.round(r.share * 100)}%</td>
                          <td className="px-3 font-mono">{r.chatter}</td>
                          <td className="px-3 font-mono">{r.standing}</td>
                          <td className="px-3 font-mono">{r.unacked}</td>
                          <td className="px-3 font-mono text-[12px]">{mins(r.mtta_s)}</td>
                          <td className="px-3 text-[12px] text-ink-68">{r.flags.map((f) => t(`aq.flag.${f}`)).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-line px-3 py-2 text-[12px] text-ink-68">{t('aq.showing', { shown: rows.length, total: m.rules.length })}</p>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
