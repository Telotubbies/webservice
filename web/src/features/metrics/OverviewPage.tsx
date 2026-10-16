// Metrics Overview (WP-B) — site-wide signal inventory: configured count,
// quality buckets from tags/latest, reporting coverage over 24 h from
// tag-stats, freshest / least-recent signals and the silent list. Every
// number is a count over a real endpoint response — no assumed values.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight, LineChart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, tagQueryApi } from '../../lib/api';
import { STALE_MS } from '../../lib/live';
import { Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { Freshness, QualityMark } from '../../shared/ui/Status';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import { groupOf, trendLink, useTrendNames } from './util';
import '../onboarding/i18n';
import '../misc/i18n';
import './i18n';

const DAY_MS = 24 * 3600e3;

type Bucket = 'good' | 'stale' | 'bad' | 'none';

export function MetricsOverviewPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const trendNames = useTrendNames();
  const from24 = useMemo(() => new Date(Date.now() - DAY_MS).toISOString(), []);

  const tags = useQuery({
    queryKey: ['site-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    staleTime: 60_000,
  });
  const latest = useQuery({
    queryKey: ['tags-latest-v2', orgId, siteId],
    queryFn: () => tagQueryApi.latest(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
  });
  const stats24 = useQuery({
    queryKey: ['tag-stats', orgId, siteId, '24h'],
    queryFn: () => tagQueryApi.stats(orgId!, siteId!, { from: from24 }),
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
  });

  const all = useMemo(() => tags.data?.items ?? [], [tags.data]);
  const byId = useMemo(() => new Map(all.map((g) => [g.id, g])), [all]);
  const latestById = useMemo(() => new Map((latest.data?.items ?? []).map((r) => [r.tag_id, r])), [latest.data]);
  const reporting24 = useMemo(() => new Set((stats24.data?.items ?? []).map((s) => s.tag_id)), [stats24.data]);

  const now = Date.now();
  const buckets = useMemo(() => {
    const b: Record<Bucket, string[]> = { good: [], stale: [], bad: [], none: [] };
    for (const g of all) {
      const lv = latestById.get(g.id);
      if (!lv) { b.none.push(g.path); continue; }
      const age = now - Date.parse(lv.ts);
      if (lv.q === 'bad' || lv.q === 'uncertain') b.bad.push(g.path);
      else if (lv.q === 'stale' || age > STALE_MS) b.stale.push(g.path);
      else b.good.push(g.path);
    }
    return b;
  }, [all, latestById, now]);

  const silent = all.filter((g) => !reporting24.has(g.id));
  const byEquipment = useMemo(() => {
    const m = new Map<string, typeof all>();
    for (const g of all) m.set(groupOf(g.path), [...(m.get(groupOf(g.path)) ?? []), g]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [all]);

  const sortedByTs = [...latestById.entries()]
    .map(([id, r]) => ({ id, ts: r.ts, path: byId.get(id)?.path ?? id }))
    .filter((r) => r.ts)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const freshest = sortedByTs[0];
  const stalest = sortedByTs[sortedByTs.length - 1];

  const loading = tags.isLoading || latest.isLoading || stats24.isLoading;
  const failed = tags.isError || latest.isError || stats24.isError;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <p className="text-[12px] text-ink-46">{t('mtr.ovLede')}</p>
      {loading ? (
        <Card pad><SkeletonRows rows={6} /></Card>
      ) : failed ? (
        <Card pad><ErrorState onRetry={() => { void tags.refetch(); void latest.refetch(); void stats24.refetch(); }} /></Card>
      ) : all.length === 0 ? (
        <Card pad><EmptyState title={t('msum.emptyAll')} body={t('msum.emptyAllBody')} icon="search"
          action={<HelpLink doc="dataSource" />} /></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title={t('mtr.ovSignals')}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-ink-68">{t('mtr.ovConfigured')}</dt>
                <dd className="font-mono font-semibold">{all.length}</dd>
                <dt className="text-ink-68">{t('mtr.ovReporting')}</dt>
                <dd className="font-mono font-semibold">{stats24.data?.items.length ?? 0}</dd>
                <dt className="text-ink-68">{t('mtr.ovSilent')}</dt>
                <dd className={`font-mono font-semibold ${silent.length ? 'text-[var(--color-caution-ink)]' : ''}`}>{silent.length}</dd>
              </dl>
            </Card>

            <Card title={t('mtr.ovQuality')}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-ink-68">{t('mtr.qGood')}</dt>
                <dd className="font-mono font-semibold">{buckets.good.length}</dd>
                <dt><QualityMark q="stale" stale /></dt>
                <dd className="font-mono font-semibold">{buckets.stale.length}</dd>
                <dt><QualityMark q="bad" /></dt>
                <dd className={`font-mono font-semibold ${buckets.bad.length ? 'text-[var(--color-danger)]' : ''}`}>{buckets.bad.length}</dd>
                <dt><span className="qmark" data-q="stale"><span className="text-[9px] leading-none" aria-hidden>○</span>{t('mtr.qNone')}</span></dt>
                <dd className="font-mono font-semibold">{buckets.none.length}</dd>
              </dl>
            </Card>

            <Card title={t('mtr.ovByEquipment')}>
              <ul className="text-[13px]">
                {byEquipment.map(([eq, list]) => (
                  <li key={eq} className="border-b border-line py-1 last:border-0">
                    <details>
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue">
                        <ChevronRight size={12} className="text-ink-46 transition-transform [[open]>&]:rotate-90" aria-hidden />
                        <span className="flex-1 font-medium">{eq}</span>
                        <span className="font-mono text-[12px] text-ink-46">{t('mtr.ovCount', { count: list.length })}</span>
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-5">
                        {list.map((g) => (
                          <li key={g.id}>
                            <Link to={trendLink(g.path, trendNames)} className="flex items-center gap-1.5 font-mono text-[12px] text-blue hover:underline">
                              <LineChart size={11} aria-hidden />{g.path}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={`${t('mtr.ovFreshest')} / ${t('mtr.ovStalest')}`}>
              <p className="sr-only">{t('mtr.ovFreshBody')}</p>
              <dl className="space-y-2 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t('mtr.ovFreshest')}</dt>
                  <dd className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-[12px]">{freshest?.path ?? '—'}</span>
                    <Freshness ts={freshest?.ts} />
                  </dd>
                </div>
                <div className="border-t border-line pt-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t('mtr.ovStalest')}</dt>
                  <dd className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-[12px]">{stalest?.path ?? '—'}</span>
                    <Freshness ts={stalest?.ts} />
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title={`${t('mtr.ovSilentTitle')} (${t('mtr.ovWindow')})`}>
              {silent.length === 0 ? (
                <p className="text-[13px] text-ink-68">{t('mtr.ovAllReporting')}</p>
              ) : (
                <>
                  <p className="mb-2 text-[12px] text-ink-46">{t('mtr.ovSilentBody')}</p>
                  <ul className="space-y-0.5">
                    {silent.map((g) => {
                      const lv = latestById.get(g.id);
                      return (
                        <li key={g.id} className="flex items-center gap-2 text-[13px]">
                          <Link to={trendLink(g.path, trendNames)} className="min-w-0 flex-1 truncate font-mono text-[12px] text-blue hover:underline">{g.path}</Link>
                          <QualityMark q={lv?.q as never} stale={!lv || now - Date.parse(lv.ts) > STALE_MS} />
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
