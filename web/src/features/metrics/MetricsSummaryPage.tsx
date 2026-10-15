// Metrics summary — one row per signal: latest value, freshness, and (on
// expand) the stored-sample quality profile. Rows load history lazily so a
// 500-tag site never fans out 500 requests.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight, Search } from 'lucide-react';
import { EmptyState } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { Freshness } from '../../shared/ui/Status';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { QualityProfile } from './QualityProfile';

const group = (name: string) => name.split('.').slice(-2, -1)[0] ?? name.split('.')[0];
const PAGE = 100;

export function MetricsSummaryPage() {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const tagRev = useStore(() => live.tagRev);
  const [q, setQ] = useState('');
  const [offGroup, setOffGroup] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => [...live.tags].sort((a, b) => a.name.localeCompare(b.name)), [tagRev]);
  const shown = tags
    .filter((ti) => !offGroup.has(group(ti.name)))
    .filter((ti) => !q || ti.name.toLowerCase().includes(q.toLowerCase()));
  const staleCount = tags.filter((ti) => {
    const tv = live.latest.get(ti.name);
    return !tv || now - Date.parse(tv.ts) > STALE_MS;
  }).length;

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="metric" title={t('nav.metricsSummary')}
        lede={t('msum.lede', { total: tags.length, stale: staleCount, defaultValue: '{{total}} signals, {{stale}} not reporting right now.' })} />
      <div className="border-b border-line bg-white px-4 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" aria-hidden />
          <input className="input w-full pl-7" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
            placeholder={t('msum.searchPh', { defaultValue: 'Filter signals…' })} aria-label={t('msum.searchPh', { defaultValue: 'Filter signals…' })} />
        </div>
      </div>
      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white">
          <FacetGroup title={t('msum.group', { defaultValue: 'Equipment group' })} off={offGroup} emptyLabel="—"
            onToggle={(v) => setOffGroup((s) => toggleIn(s, v))} options={facetOptions(tags, (ti) => group(ti.name))} />
        </aside>
        <section className="min-w-0 flex-1 overflow-x-auto rounded-[5px] border border-line bg-white">
          {shown.length === 0 ? (
            <EmptyState title={t('msum.empty', { defaultValue: 'No signals match' })} icon="search" />
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="w-8" aria-hidden />
                  {(['signal', 'value', 'updated'] as const).map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">
                      {t(`msum.${c}`, { defaultValue: c === 'signal' ? 'Signal' : c === 'value' ? 'Latest' : 'Updated' })}
                    </th>
                  ))}
                  <th className="w-20" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((ti) => {
                  const tv = live.latest.get(ti.name);
                  const isOpen = open.has(ti.name);
                  return (
                    <FragmentRow key={ti.name} name={ti.name} unit={ti.unit} v={tv?.v} ts={tv?.ts} isOpen={isOpen}
                      onToggle={() => setOpen((s) => toggleIn(s, ti.name))} />
                  );
                })}
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

function FragmentRow({ name, unit, v, ts, isOpen, onToggle }: {
  name: string; unit?: string; v?: number | boolean; ts?: string; isOpen: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className="h-10 border-b border-line hover:bg-info-soft">
        <td className="px-2">
          <button type="button" aria-expanded={isOpen} aria-label={t('msum.qualityToggle', { name, defaultValue: 'Data quality for {{name}}' })} onClick={onToggle}
            className="grid h-6 w-6 place-items-center rounded focus-visible:outline-2 focus-visible:outline-blue">
            <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        </td>
        <td className="px-3 font-mono text-[12px]">{name}</td>
        <td className="px-3 font-mono">{v === undefined ? '—' : typeof v === 'boolean' ? (v ? t('state.on') : t('state.off')) : `${v}${unit ? ` ${unit}` : ''}`}</td>
        <td className="px-3 text-[12px]">{ts ? <Freshness ts={ts} /> : '—'}</td>
        <td className="px-3 text-right"><Link to={`/trends?tags=${encodeURIComponent(name)}`} className="text-[12px] text-blue hover:underline">{t('nav.trends')}</Link></td>
      </tr>
      {isOpen && (
        <tr className="border-b border-line bg-subtle">
          <td />
          <td colSpan={4} className="px-3 py-2"><QualityProfile tag={name} /></td>
        </tr>
      )}
    </>
  );
}
