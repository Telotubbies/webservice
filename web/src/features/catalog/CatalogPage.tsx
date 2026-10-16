// Asset catalog — every signal the site publishes, grouped by equipment, with
// live quality and age.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { fmtAge } from '../../lib/format';
import { equipmentOf, EQUIPMENT } from '../../lib/plant';
import { useNow, useStore } from '../../lib/hooks';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { FacetGroup, ProductHeader, facetOptions, toggleIn } from '../../shared/ui/Product';
import { QualityMark } from '../../shared/ui/Status';
import '../misc/i18n';

export function CatalogPage() {
  const { t } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });
  const [q, setQ] = useState('');
  const [off, setOff] = useState<Set<string>>(new Set());
  const rows = useMemo(() => (tags.data ?? []).map((g) => ({ ...g, eq: equipmentOf(g.name) ?? 'other' })), [tags.data]);
  const eqLabel = (v: string) => { const e = EQUIPMENT.find((x) => x.id === v); return e ? t(e.labelKey) : t('px.catalog.other'); };
  const shown = rows.filter((r) => !off.has(r.eq) && `${r.name} ${r.unit ?? ''} ${eqLabel(r.eq)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="books" title={t('px.catalog.title')} />
      <div className="border-b border-line bg-white px-4 py-2">
        <input className="input w-full font-mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('px.catalog.queryPh')} aria-label={t('px.catalog.queryPh')} />
      </div>
      <div className="flex flex-1 gap-4 p-4">
        <aside className="w-[220px] shrink-0 self-start border border-line bg-white">
          <FacetGroup title={t('px.catalog.facetEquipment')} off={off} emptyLabel={t('px.empty')} onToggle={(v) => setOff((s) => toggleIn(s, v))}
            options={facetOptions(rows, (r) => r.eq, eqLabel)} />
        </aside>
        <div className="min-w-0 flex-1 overflow-x-auto">
          {tags.isLoading ? <SkeletonRows /> : tags.isError ? <ErrorState onRetry={tags.refetch} /> : shown.length === 0 ? <EmptyState title={t('px.empty')} icon="search" /> : (
            <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {['colSignal', 'colEquipment', 'colUnit', 'colWritable', 'colQuality', 'colAge'].map((c) => (
                    <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.catalog.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const tv = live.latest.get(r.name);
                  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
                  return (
                    <tr key={r.name} className="h-9 border-b border-line last:border-0 hover:bg-info-soft">
                      <td className="px-3 font-mono text-[12px]"><Link className="text-blue hover:underline" to={`/trends?tags=${encodeURIComponent(r.name)}`}>{r.name}</Link></td>
                      <td className="px-3">{eqLabel(r.eq)}</td>
                      <td className="px-3 text-ink-68">{r.unit ?? '—'}</td>
                      <td className="px-3">{r.writable ? t('px.yes') : t('px.no')}</td>
                      <td className="px-3">{tv ? <QualityMark q={tv.q} stale={stale} /> : '—'}</td>
                      <td className="px-3 font-mono text-[12px] text-ink-68">{tv ? fmtAge(tv.ts, now) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
