// Heartbeat checks (the plant analog of Datadog Synthetics): one passing /
// failing check per signal (fresh, good-quality sample inside the stale
// window) plus the edge gateway heartbeats. Nothing is probed from outside —
// every status is read from the live store and the edge fleet. Suites group
// the checks by equipment, as dd groups tests into suites.

import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { SIGNALS } from '../../lib/plant';
import { live, STALE_MS } from '../../lib/live';
import { fmtAge } from '../../lib/format';
import { useNow, useStore } from '../../lib/hooks';
import { EdgeFleetTable } from '../health/EdgeFleetTable';
import { PageBar } from '../../shared/ui/Page';
import '../misc/i18n';
import './i18n';

export type Check = 'ok' | 'stale' | 'bad' | 'none';
export const GLYPH: Record<Check, string> = { ok: '●', stale: '◆', bad: '▲', none: '○' };

export function useSyntheticsTabs() {
  const { t } = useTranslation();
  return [
    { to: '/synthetics', label: t('syn.tabChecks'), end: true },
    { to: '/synthetics/coverage', label: t('syn.tabCoverage') },
    { to: '/synthetics/settings', label: t('syn.tabSettings') },
  ];
}

export function SyntheticsPage() {
  const { t } = useTranslation();
  const tabs = useSyntheticsTabs();
  const now = useNow();
  useStore(() => live.version);
  const rows = Object.keys(SIGNALS).map((tag) => {
    const tv = live.latest.get(tag);
    const status: Check = !tv ? 'none' : now - Date.parse(tv.ts) > STALE_MS ? 'stale' : tv.q === 'good' ? 'ok' : 'bad';
    const area: string = SIGNALS[tag].equipment ?? 'other';
    return { tag, tv, status, area };
  });
  const n = (s: Check) => rows.filter((r) => r.status === s).length;
  const suites = [...new Set(rows.map((r) => r.area))].map((area) => {
    const list = rows.filter((r) => r.area === area);
    return { area, list, pass: list.filter((r) => r.status === 'ok').length };
  });
  return (
    <>
      <PageBar icon="multi-heartbeat" title={t('px.synthetics.title')} tabs={tabs} />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
          {(['ok', 'stale', 'bad', 'none'] as const).map((s) => (
            <span key={s}><b className="block font-mono text-[22px] text-ink">{n(s)}</b><span aria-hidden>{GLYPH[s]}</span> {t(`px.synthetics.${s}`)}</span>
          ))}
        </div>
        <section aria-label={t('syn.suites')}>
          <h2 className="mb-2 text-[13px] font-semibold">{t('syn.suites')}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {suites.map((s) => {
              const pct = Math.round((s.pass / s.list.length) * 100);
              return (
                <li key={s.area} className="rounded-[5px] border border-line bg-white p-3">
                  <p className="text-[13px] font-semibold">{s.area === 'other' ? t('syn.otherArea') : t(`line.${s.area}`, { defaultValue: s.area })}</p>
                  <p className="mt-1 font-mono text-[22px] tabular-nums">{pct}<span className="text-[13px] text-ink-46">%</span></p>
                  <p className="text-[12px] text-ink-68">{t('syn.passing', { pass: s.pass, total: s.list.length })}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-[var(--color-ok)]" style={{ width: `${pct}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['colCheck', 'colStatus', 'colAge'].map((c) => (
                  <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.synthetics.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suites.map((s) => (
                <Fragment key={s.area}>
                  <tr className="border-b border-line bg-subtle"><td colSpan={3} className="h-8 px-3 text-[12px] font-semibold text-ink-68">{s.area === 'other' ? t('syn.otherArea') : t(`line.${s.area}`, { defaultValue: s.area })}</td></tr>
                  {s.list.map((r) => (
                    <tr key={r.tag} className="h-9 border-b border-line last:border-0">
                      <td className="px-3 font-mono text-[12px]">{r.tag}</td>
                      <td className="px-3"><span aria-hidden>{GLYPH[r.status]}</span> {t(`px.synthetics.${r.status}`)}</td>
                      <td className="px-3 font-mono text-[12px] text-ink-68">{r.tv ? fmtAge(r.tv.ts, now) : '—'}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <h2 className="text-[13px] font-semibold">{t('px.synthetics.edges')}</h2>
        <EdgeFleetTable />
      </div>
    </>
  );
}
