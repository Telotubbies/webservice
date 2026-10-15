// Alarm quality — ISA-18.2 style performance over the loaded alarm history:
// rate, peak flood, standing and never-acked alarms, plus per-rule bad actors.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { SeverityBadge } from '../../shared/ui/Status';
import { useAlarmHistory } from '../events/alarmHistory';
import { enabled } from '../../lib/features';
import type { Alarm } from '../../types';
import './i18n';

const H = 3600_000;
const CHATTER_MS = 10 * 60_000;
const STANDING_MS = 24 * H;
const FLOOD_10M = 10;
const TOP_N = 10;

type Flag = 'frequent' | 'chatter' | 'standing' | 'unacked';
interface RuleRow {
  rule: string; severity: string; count: number; share: number;
  chatter: number; standing: number; unacked: number; mtta: number | null; flags: Flag[];
}

const ms = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0);

export function computeQuality(alarms: Alarm[], now: number) {
  const times = alarms.map((a) => ms(a.ts)).filter(Boolean).sort((a, b) => a - b);
  const span = times.length ? Math.max(H, now - times[0]) : H;
  const perHour = (times.length / span) * H;

  // peak count in any sliding 10-minute window
  let peak = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] > CHATTER_MS) j++;
    peak = Math.max(peak, i - j + 1);
  }

  const hourly = Array.from({ length: 24 }, () => 0);
  for (const t of times) {
    const back = Math.floor((now - t) / H);
    if (back >= 0 && back < 24) hourly[23 - back]++;
  }

  const byRule = new Map<string, Alarm[]>();
  for (const a of alarms) byRule.set(a.rule, [...(byRule.get(a.rule) ?? []), a]);

  const standingNow = alarms.filter((a) => a.state === 'active' && now - ms(a.ts) > STANDING_MS);
  const unackedNow = alarms.filter((a) => a.state === 'active' && !a.acked_at && !a.acked_by);

  const rows: RuleRow[] = [...byRule.entries()].map(([rule, list]) => {
    const asc = [...list].sort((a, b) => ms(a.ts) - ms(b.ts));
    let chatter = 0;
    for (let i = 1; i < asc.length; i++) {
      const cleared = ms(asc[i - 1].cleared_at);
      if (cleared && ms(asc[i].ts) - cleared < CHATTER_MS) chatter++;
    }
    const acks = list.filter((a) => ms(a.acked_at) && ms(a.ts)).map((a) => ms(a.acked_at) - ms(a.ts));
    return {
      rule, severity: list[0].severity, count: list.length, share: alarms.length ? list.length / alarms.length : 0,
      chatter, standing: list.filter((a) => standingNow.includes(a)).length,
      unacked: list.filter((a) => unackedNow.includes(a)).length,
      mtta: acks.length ? acks.reduce((s, x) => s + x, 0) / acks.length : null, flags: [],
    };
  }).sort((a, b) => b.count - a.count);

  const topShare = rows.slice(0, TOP_N).reduce((s, r) => s + r.share, 0);
  rows.forEach((r, i) => {
    if (i < TOP_N && rows.length > TOP_N) r.flags.push('frequent');
    if (r.chatter > 0) r.flags.push('chatter');
    if (r.standing > 0) r.flags.push('standing');
    if (r.unacked > 0) r.flags.push('unacked');
  });
  return { perHour, peak, hourly, rows, topShare, standing: standingNow.length, unacked: unackedNow.length, from: times[0], to: now };
}

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
  const history = useAlarmHistory();
  const [q, setQ] = useState('');
  const [offSev, setOffSev] = useState<Set<string>>(new Set());
  const [offFlag, setOffFlag] = useState<Set<string>>(new Set());

  const m = useMemo(() => computeQuality(history.alarms, Date.now()), [history.alarms]);
  const mins = (ms_: number | null) => (ms_ == null ? '—' : ms_ >= H ? t('aq.hrs', { n: (ms_ / H).toFixed(1) }) : t('aq.mins', { n: Math.max(1, Math.round(ms_ / 60_000)) }));

  const rows = m.rows
    .filter((r) => !offSev.has(r.severity))
    .filter((r) => r.flags.length === 0 ? !offFlag.has('none') : r.flags.some((f) => !offFlag.has(f)))
    .filter((r) => r.rule.toLowerCase().includes(q.toLowerCase()));
  const max = Math.max(1, ...m.hourly);
  const findings = [
    m.rows.length > TOP_N && m.topShare > 0.8 && ['fFrequent', TOP_N, Math.round(m.topShare * 100)],
    m.rows.some((r) => r.chatter) && ['fChatter', m.rows.filter((r) => r.chatter).length],
    m.rows.some((r) => r.standing) && ['fStanding', m.rows.filter((r) => r.standing).length],
    m.rows.some((r) => r.unacked) && ['fUnacked', m.rows.filter((r) => r.unacked).length],
  ].filter(Boolean) as [string, number, number?][];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="bell-curve" title={t('aq.product')} lede={t('aq.lede', { n: history.alarms.length })}
        tabs={[
          { to: '/alarms', label: t('aq.tabList'), end: true },
          { to: '/admin/rules', label: t('aq.tabRules') },
          { to: '/alarms/quality', label: t('aq.tabQuality') },
          ...(enabled('alarmsettings') ? [{ to: '/alarms/settings', label: t('aq.tabSettings') }] : []),
        ]} />
      <div className="flex flex-1 flex-col gap-4 p-4">
        {history.error && <Notice tone="warn">{t('common.loadFailed', { defaultValue: 'Could not load alarm history.' })}</Notice>}
        {!history.loading && history.alarms.length === 0 ? (
          <EmptyState title={t('aq.empty')} body={t('aq.emptyBody')} icon="search" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label={t('aq.kpiRate')} value={m.perHour.toFixed(1)} tone={t(`aq.${rateLevel(m.perHour)}`)} hint={t('aq.kpiRateHint')} />
              <Kpi label={t('aq.kpiPeak')} value={String(m.peak)} tone={m.peak > FLOOD_10M ? t('aq.flood') : t('aq.ok')} hint={t('aq.kpiPeakHint')} />
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
                  options={facetOptions(m.rows, (r) => r.severity, (v) => t(`alarms.${v}`, { defaultValue: v }))} />
                <FacetGroup title={t('aq.facetFlag')} off={offFlag} emptyLabel={t('aq.noValues')} onToggle={(v) => setOffFlag((s) => toggleIn(s, v))}
                  options={(['frequent', 'chatter', 'standing', 'unacked'] as Flag[]).map((f) => ({ value: f, label: t(`aq.flag.${f}`), count: m.rows.filter((r) => r.flags.includes(f)).length }))} />
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
                        <tr key={r.rule} className="h-10 border-b border-line last:border-0 hover:bg-info-soft">
                          <td className="px-3 font-medium"><Link to={`/alarms?rule=${encodeURIComponent(r.rule)}`} className="hover:text-blue hover:underline">{r.rule}</Link></td>
                          <td className="px-3"><SeverityBadge severity={r.severity} /></td>
                          <td className="px-3 font-mono">{r.count}</td>
                          <td className="px-3 font-mono">{Math.round(r.share * 100)}%</td>
                          <td className="px-3 font-mono">{r.chatter}</td>
                          <td className="px-3 font-mono">{r.standing}</td>
                          <td className="px-3 font-mono">{r.unacked}</td>
                          <td className="px-3 font-mono text-[12px]">{mins(r.mtta)}</td>
                          <td className="px-3 text-[12px] text-ink-68">{r.flags.map((f) => t(`aq.flag.${f}`)).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-line px-3 py-2 text-[12px] text-ink-68">{t('aq.showing', { shown: rows.length, total: m.rows.length })}</p>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
