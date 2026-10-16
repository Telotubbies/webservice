// Metrics summary (Phase 4) — real per-tag stats from the v2 tag-stats
// endpoint: min / max / avg / sample count / last value / data gaps over
// the selected window. One request for the whole site — no per-tag fan-out.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { tagQueryApi, type TagStat } from '../../lib/api';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { Freshness } from '../../shared/ui/Status';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import '../onboarding/i18n';
import '../misc/i18n';

const group = (path: string) => path.split('/').slice(-2, -1)[0] ?? path.split('/')[0];
const PAGE = 100;

const fmt = (v: number | null) =>
  v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function MetricsSummaryPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const [q, setQ] = useState('');
  const [offGroup, setOffGroup] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const stats = useQuery({
    queryKey: ['tag-stats', orgId, siteId],
    queryFn: () => tagQueryApi.stats(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
  });

  const items = useMemo(() => stats.data?.items ?? [], [stats.data]);
  const shown = items
    .filter((s) => !offGroup.has(group(s.path)))
    .filter((s) => !q || `${s.path} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const staleCount = items.filter((s) => s.count === 0).length;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="metric" title={t('nav.metricsSummary')}
        lede={t('msum.lede', { total: items.length, stale: staleCount })} />
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
            placeholder={t('msum.searchPh')} aria-label={t('msum.searchPh')} />
        </div>
      </div>
      <div className="flex flex-1 gap-4 p-4">
        <aside className="hidden w-[220px] shrink-0 self-start border border-line bg-white md:block">
          <FacetGroup title={t('msum.group')} off={offGroup} emptyLabel="—"
            onToggle={(v) => setOffGroup((s) => toggleIn(s, v))} options={facetOptions(items, (s) => group(s.path))} />
        </aside>
        <section className="min-w-0 flex-1 overflow-x-auto rounded-[5px] border border-line bg-white">
          {stats.isLoading ? (
            <SkeletonRows rows={8} />
          ) : stats.isError ? (
            <ErrorState onRetry={stats.refetch} />
          ) : shown.length === 0 ? (
            <EmptyState
              title={items.length === 0 ? t('msum.emptyAll') : t('msum.empty')}
              body={items.length === 0 ? t('msum.emptyAllBody') : undefined}
              icon="search"
              action={items.length === 0 ? <HelpLink doc="dataSource" /> : undefined}
            />
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="w-8" aria-hidden />
                  {(['signal', 'min', 'max', 'avg', 'count', 'value', 'gaps', 'updated'] as const).map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">
                      {t(`msum.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((s) => (
                  <StatRow key={s.tag_id} s={s} isOpen={open.has(s.tag_id)}
                    onToggle={() => setOpen((o) => toggleIn(o, s.tag_id))} />
                ))}
              </tbody>
            </table>
          )}
          {shown.length > limit && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-ink-68">
              {t('evx.shownOf', { shown: limit, total: shown.length })}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLimit((n) => n + PAGE)}>{t('evx.showMore')}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatRow({ s, isOpen, onToggle }: { s: TagStat; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <tr className="h-10 border-b border-line hover:bg-info-soft">
        <td className="px-2">
          <button type="button" aria-expanded={isOpen} aria-label={t('msum.detailToggle', { name: s.path })} onClick={onToggle}
            className="grid h-6 w-6 place-items-center rounded focus-visible:outline-2 focus-visible:outline-blue">
            <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        </td>
        <td className="px-3 font-mono text-[12px]">{s.path}</td>
        <td className="px-3 font-mono text-[12px]">{fmt(s.min)}</td>
        <td className="px-3 font-mono text-[12px]">{fmt(s.max)}</td>
        <td className="px-3 font-mono text-[12px]">{fmt(s.avg)}</td>
        <td className="px-3 font-mono text-[12px]">{s.count}</td>
        <td className="px-3 font-mono text-[12px]">
          {typeof s.last === 'boolean' ? (s.last ? t('state.on') : t('state.off')) : `${fmt(s.last)}${s.unit ? ` ${s.unit}` : ''}`}
        </td>
        <td className="px-3 font-mono text-[12px]">
          {s.gaps > 0 ? <span className="text-[var(--color-caution)]" title={t('msum.gapTip')}>{s.gaps} · {s.max_gap_s}s</span> : '—'}
        </td>
        <td className="px-3 text-[12px]"><Freshness ts={s.last_ts} /></td>
      </tr>
      {isOpen && (
        <tr className="border-b border-line bg-subtle">
          <td />
          <td colSpan={8} className="px-3 py-2 text-[12px] text-ink-68">
            {t('msum.detail', {
              count: s.count, min: fmt(s.min), max: fmt(s.max), avg: fmt(s.avg),
              gaps: s.gaps, gap: s.max_gap_s,
            })}{' '}
            <Link to={`/trends?tags=${encodeURIComponent(s.path)}`} className="text-blue hover:underline">{t('nav.trends')}</Link>
          </td>
        </tr>
      )}
    </>
  );
}
