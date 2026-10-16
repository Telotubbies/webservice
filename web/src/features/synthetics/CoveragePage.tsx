// Synthetics › Coverage — test-coverage analog: which signals are watched by
// an alarm rule and which are watched for going silent (a `stale` rule).
// Everything is derived from the alarm-rule list and the edge fleet.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { SIGNALS } from '../../lib/plant';
import { useNow, useStore } from '../../lib/hooks';
import { canAdmin } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { edgeState, useEdgeFleet } from '../health/fleet';
import { PageBar } from '../../shared/ui/Page';
import { ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { useSyntheticsTabs } from './SyntheticsPage';
import '../misc/i18n';
import './i18n';

function Tile({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-[5px] border border-line bg-white p-4">
      <p className="text-[12px] text-ink-68">{label}</p>
      <p className="mt-1 font-mono text-[28px] font-semibold tabular-nums">{pct}<span className="text-[15px] text-ink-46">%</span></p>
      <p className="font-mono text-[12px] text-ink-46">{value}/{total}</p>
      <div className="mt-2 h-1.5 rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-blue" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function SyntheticsCoveragePage() {
  const { t } = useTranslation();
  const tabs = useSyntheticsTabs();
  const now = useNow(5000);
  useStore(() => live.version);
  const { orgRole } = useAdminOrg();
  const fleet = useEdgeFleet();
  const rules = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });

  const tags = Object.keys(SIGNALS);
  const all = rules.data ?? [];
  const byTag = (tag: string) => all.filter((r) => r.tag === tag && r.enabled);
  const rows = tags.map((tag) => {
    const rs = byTag(tag);
    return { tag, rules: rs.length, stale: rs.some((r) => r.kind === 'stale'), liveOk: live.latest.has(tag) };
  });
  const active = fleet.edges.filter((e) => e.status !== 'disabled');
  const online = active.filter((e) => edgeState(e, now) === 'online').length;
  const gaps = rows.filter((r) => r.rules === 0);

  return (
    <>
      <PageBar icon="multi-heartbeat" title={t('px.synthetics.title')} tabs={tabs} />
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-[16px] font-semibold">{t('syn.covTitle')}</h2>
          <p className="text-[13px] text-ink-68">{t('syn.covLede')}</p>
        </div>
        {rules.isError ? <ErrorState onRetry={() => rules.refetch()} /> : rules.isLoading ? <SkeletonRows rows={4} h={48} /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label={t('syn.covRules')} value={rows.filter((r) => r.rules > 0).length} total={rows.length} />
              <Tile label={t('syn.covStale')} value={rows.filter((r) => r.stale).length} total={rows.length} />
              <Tile label={t('syn.covEdges')} value={online} total={active.length} />
            </div>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold">{t('syn.gaps')}</h3>
              {gaps.length === 0 ? <p className="text-[13px] text-ink-68">{t('syn.noGaps')}</p> : (
                <ul className="divide-y divide-line rounded-[5px] border border-line bg-white text-[13px]">
                  {gaps.map((g) => (
                    <li key={g.tag} className="flex min-h-10 items-center gap-3 px-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{g.tag}</span>
                      {canAdmin(orgRole ?? 'none') && <NavLink to="/admin/rules/new" className="btn btn-ghost btn-sm">{t('syn.addRule')}</NavLink>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse rounded-[5px] border border-line bg-white text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['colSignal', 'colRules', 'colStaleRule', 'colLive'].map((c) => <th key={c} scope="col" className="overline h-8 px-3">{t(`syn.${c}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tag} className="h-9 border-b border-line last:border-0">
                      <td className="px-3 font-mono text-[12px]">{r.tag}</td>
                      <td className="px-3 font-mono tabular-nums">{r.rules}</td>
                      <td className="px-3">{r.stale ? t('syn.yes') : t('syn.no')}</td>
                      <td className="px-3">{r.liveOk ? t('syn.yes') : t('syn.no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
