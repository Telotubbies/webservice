// Metrics Volume (WP-B) — samples per signal per window, straight from
// tag-stats. Top-N bar list on top, full table under it; est. rows/day is a
// pure projection (count ÷ window × 24 h) and silent/chatty flags use the
// explicit thresholds printed under the table.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminApi, tagQueryApi, type TagStat } from '../../lib/api';
import { Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { Freshness } from '../../shared/ui/Status';
import { Segmented } from '../../shared/ui/Segmented';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import { trendLink, useTrendNames } from './util';
import '../onboarding/i18n';
import '../misc/i18n';
import './i18n';

const VOL_WINDOWS = { '1h': 3600e3, '8h': 8 * 3600e3, '24h': 24 * 3600e3 } as const;
type VolWindow = keyof typeof VOL_WINDOWS;
const DAY_MS = 86400e3;
/** ≥ 1 sustained sample/second is chatty for plant telemetry. */
const CHATTY_ROWS_DAY = 86400;
const TOP_N = 10;

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function MetricsVolumePage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const trendNames = useTrendNames();
  const [w, setW] = useState<VolWindow>('8h');
  const winMs = VOL_WINDOWS[w];
  const from = useMemo(() => new Date(Date.now() - winMs).toISOString(), [winMs]);

  const stats = useQuery({
    queryKey: ['tag-stats', orgId, siteId, `vol:${w}`],
    queryFn: () => tagQueryApi.stats(orgId!, siteId!, { from }),
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
  });
  // silent detection: a configured tag absent from the stats response had 0
  // samples in the window (the endpoint only returns tags with data)
  const tags = useQuery({
    queryKey: ['site-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    staleTime: 60_000,
  });

  const items = useMemo(
    () => [...(stats.data?.items ?? [])].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
    [stats.data],
  );
  const silent = useMemo(() => {
    const seen = new Set(items.map((s) => s.tag_id));
    return (tags.data?.items ?? []).filter((g) => !seen.has(g.id));
  }, [items, tags.data]);

  const total = items.reduce((a, s) => a + s.count, 0);
  const top = items.slice(0, TOP_N);
  const max = top[0]?.count ?? 0;
  const rowsPerDay = (s: TagStat) => Math.round((s.count / winMs) * DAY_MS);
  const isChatty = (s: TagStat) => s.count >= CHATTY_ROWS_DAY * (winMs / DAY_MS);

  const loading = stats.isLoading || tags.isLoading;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-64 text-[12px] text-ink-46">{t('mtr.volLede')}</p>
        <Segmented
          value={w}
          onChange={setW}
          label={t('mtr.volWindow')}
          options={(Object.keys(VOL_WINDOWS) as VolWindow[]).map((k) => ({ value: k, label: k }))}
        />
      </div>

      {loading ? (
        <Card pad><SkeletonRows rows={8} /></Card>
      ) : stats.isError ? (
        <Card pad><ErrorState onRetry={stats.refetch} /></Card>
      ) : items.length === 0 && silent.length === 0 ? (
        <Card pad><EmptyState title={t('mtr.volEmpty')} body={t('mtr.volEmptyBody')} icon="search"
          action={<HelpLink doc="dataSource" />} /></Card>
      ) : (
        <>
          <Card title={t('mtr.volTop')} actions={<span className="text-[11px] text-ink-46">{t('mtr.volTotal', { count: total })}</span>}>
            {top.length === 0 ? (
              <p className="text-[13px] text-ink-68">{t('mtr.volEmpty')}</p>
            ) : (
              <ul className="space-y-1.5">
                {top.map((s) => {
                  const pct = max ? (s.count / max) * 100 : 0;
                  return (
                    <li key={s.tag_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
                      <Link to={trendLink(s.path, trendNames)} className="truncate font-mono text-blue hover:underline" title={s.path}>
                        {s.path}
                      </Link>
                      <span className="font-mono font-semibold">{fmt(s.count)}</span>
                      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-neutral-soft" role="presentation">
                        <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="overflow-x-auto rounded-[5px] border border-line bg-white">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {(['volSignal', 'volSamples', 'volRowsDay', 'volShare', 'volGaps', 'msum.updated'] as const).map((c, i) => (
                    <th key={c} scope="col" className={`h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68 ${i > 0 && i < 5 ? 'text-right' : ''}`}>
                      {t(c.includes('.') ? c : `mtr.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.tag_id} className="h-9 border-b border-line hover:bg-info-soft">
                    <td className="max-w-0 px-3">
                      <Link to={trendLink(s.path, trendNames)} className="block truncate font-mono text-[12px] text-blue hover:underline" title={s.path}>{s.path}</Link>
                    </td>
                    <td className="px-3 text-right font-mono text-[12px]">{fmt(s.count)}</td>
                    <td className="px-3 text-right font-mono text-[12px]">{fmt(rowsPerDay(s))}</td>
                    <td className="px-3 text-right font-mono text-[12px]">{total ? `${((s.count / total) * 100).toFixed(1)}%` : '—'}</td>
                    <td className="px-3 text-right font-mono text-[12px]">{s.gaps > 0 ? `${s.gaps} · ${s.max_gap_s}s` : '—'}</td>
                    <td className="px-3 text-[12px]">
                      <span className="flex items-center justify-end gap-2">
                        {isChatty(s) && <span className="rounded-full border border-line px-1.5 text-[10px] font-semibold text-ink-68">{t('mtr.volFlagChatty')}</span>}
                        <Freshness ts={s.last_ts} />
                      </span>
                    </td>
                  </tr>
                ))}
                {silent.map((g) => (
                  <tr key={g.id} className="h-9 border-b border-line bg-subtle last:border-0">
                    <td className="max-w-0 px-3">
                      <Link to={trendLink(g.path, trendNames)} className="block truncate font-mono text-[12px] text-ink-68 hover:text-blue hover:underline" title={g.path}>{g.path}</Link>
                    </td>
                    <td className="px-3 text-right font-mono text-[12px]">0</td>
                    <td className="px-3 text-right font-mono text-[12px]">0</td>
                    <td className="px-3 text-right font-mono text-[12px]">—</td>
                    <td className="px-3 text-right font-mono text-[12px]">—</td>
                    <td className="px-3 text-[12px]">
                      <span className="flex items-center justify-end gap-2">
                        <span className="rounded-full border border-dashed border-line px-1.5 text-[10px] font-semibold text-ink-46">{t('mtr.volFlagSilent')}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-46">{t('mtr.volFlagHint')}</p>
          </div>
        </>
      )}
    </div>
  );
}
