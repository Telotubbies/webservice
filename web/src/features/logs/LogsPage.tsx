// Logs (Phase 4) — gateway/data-source log lines shipped from the edge,
// read from the org-scoped edge_logs endpoint. Searchable, level- and
// edge-filterable, keyset-paginated.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { adminApi, edgeLogsApi, type EdgeLogRow } from '../../lib/api';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, toggleIn } from '../../shared/ui/Product';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import '../onboarding/i18n';
import '../misc/i18n';
import '../events/i18n';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const LEVEL_TONE: Record<EdgeLogRow['level'], string> = {
  debug: 'text-ink-46', info: 'text-ink-68',
  warn: 'text-[var(--color-caution)]', error: 'text-[var(--color-danger)]',
};

export function LogsPage() {
  const { t, i18n } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const [q, setQ] = useState('');
  const [edgeId, setEdgeId] = useState('');
  const [offLevel, setOffLevel] = useState<Set<string>>(new Set());

  const edges = useQuery({
    queryKey: ['log-edges', orgId, siteId],
    queryFn: () => adminApi.edges(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
  });

  const levels = LEVELS.filter((l) => !offLevel.has(l));
  const logs = useInfiniteQuery({
    queryKey: ['edge-logs', orgId, edgeId, levels.join(','), q],
    queryFn: ({ pageParam }) => edgeLogsApi.list(orgId!, {
      edge: edgeId || undefined, level: levels.length === LEVELS.length ? undefined : levels.join(','),
      q: q || undefined, cursor: pageParam, limit: 200,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!orgId,
  });

  const items = useMemo(() => logs.data?.pages.flatMap((p) => p.items) ?? [], [logs.data]);
  const edgeName = (id: string) =>
    edges.data?.items.find((e) => e.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="log-pipelines" title={t('px.logs.title')} />
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7 font-mono" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('px.logs.queryPh')} aria-label={t('px.logs.queryPh')} />
        </div>
        <select className="input text-[12px]" value={edgeId} onChange={(e) => setEdgeId(e.target.value)}
          aria-label={t('px.logs.edge')}>
          <option value="">{t('px.logs.allEdges')}</option>
          {(edges.data?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <div className="flex flex-1 gap-4 p-4">
        <aside className="hidden w-[180px] shrink-0 self-start border border-line bg-white md:block" aria-label={t('evx.facets')}>
          <FacetGroup title={t('px.logs.colLevel')} off={offLevel} emptyLabel="—"
            onToggle={(v) => setOffLevel((s) => toggleIn(s, v))}
            options={LEVELS.map((l) => ({ value: l, label: l, count: items.filter((i) => i.level === l).length }))} />
        </aside>
        <section className="min-w-0 flex-1 overflow-x-auto rounded-[5px] border border-line bg-white">
          {logs.isLoading ? (
            <SkeletonRows rows={10} />
          ) : logs.isError ? (
            <ErrorState onRetry={logs.refetch} />
          ) : items.length === 0 ? (
            <EmptyState
              title={t('px.logs.empty')}
              body={t('px.logs.emptyBody')}
              icon="search"
              action={<HelpLink doc="logs" />}
            />
          ) : (
            <table className="w-full border-collapse font-mono text-[12px]">
              <thead>
                <tr className="border-b border-line text-left font-sans">
                  {(['colTime', 'colLevel', 'colEdge', 'colSource', 'colMsg'] as const).map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">
                      {t(`px.logs.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="h-8 border-b border-line last:border-0 hover:bg-info-soft">
                    <td className="whitespace-nowrap px-3 text-ink-68">
                      {new Date(r.ts).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { hour12: false })}
                    </td>
                    <td className={`px-3 font-semibold uppercase ${LEVEL_TONE[r.level]}`}>{r.level}</td>
                    <td className="px-3 text-ink-68">{edgeName(r.edge_id)}</td>
                    <td className="px-3 text-ink-68">{r.source}</td>
                    <td className="px-3 text-ink">{r.msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {logs.hasNextPage && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-ink-68">
              {t('evx.count', { count: items.length })}
              <button type="button" className="btn btn-sm btn-ghost" disabled={logs.isFetchingNextPage}
                onClick={() => void logs.fetchNextPage()}>
                {t('evx.showMore')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
