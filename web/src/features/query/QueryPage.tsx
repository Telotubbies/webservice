// Query — ad-hoc history lookup for one signal: summary statistics, a
// sparkline-style trace and the raw samples (CSV export).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { Segmented } from '../../shared/ui/Segmented';
import '../misc/i18n';

const RANGES = { '15m': 15, '1h': 60, '4h': 240, '8h': 480 } as const;
type Range = keyof typeof RANGES;
const W = 600; const H = 80;

export function QueryPage() {
  const { t } = useTranslation();
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });
  const [tag, setTag] = useState('');
  const [range, setRange] = useState<Range>('1h');
  const hist = useQuery({
    queryKey: ['query-history', tag, range],
    queryFn: () => api.history(tag, { from: new Date(Date.now() - RANGES[range] * 60e3).toISOString(), limit: 5000 }),
    enabled: !!tag,
  });
  const pts = useMemo(() => (hist.data ?? []).filter((p) => p.q === 'good').map((p) => ({ t: Date.parse(p.ts), v: Number(p.v) })), [hist.data]);
  const stats = useMemo(() => {
    if (!pts.length) return null;
    const vs = pts.map((p) => p.v);
    return { count: pts.length, min: Math.min(...vs), max: Math.max(...vs), avg: vs.reduce((a, b) => a + b, 0) / vs.length, last: vs[vs.length - 1] };
  }, [pts]);
  const path = useMemo(() => {
    if (pts.length < 2 || !stats) return '';
    const t0 = pts[0].t; const span = Math.max(1, pts[pts.length - 1].t - t0); const rng = stats.max - stats.min || 1;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${((p.t - t0) / span) * W},${H - ((p.v - stats.min) / rng) * H}`).join('');
  }, [pts, stats]);
  const n = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 3 });

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="database" title={t('px.query.title')} />
      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-white px-4 py-2">
        <label className="text-[12px] font-semibold text-ink-68">{t('px.query.metric')}
          <select className="input mt-1 block w-72 font-mono" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('px.query.pick')}</option>
            {(tags.data ?? []).map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        </label>
        <Segmented value={range} onChange={setRange} label={t('px.query.range')} options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))} />
      </div>
      <div className="space-y-3 p-4">
        {!tag ? <EmptyState title={t('px.query.pick')} icon="search" /> : hist.isLoading ? <SkeletonRows /> : hist.isError ? <ErrorState onRetry={hist.refetch} /> : !stats ? <EmptyState title={t('px.query.noData')} icon="search" /> : (
          <>
            <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
              {(['count', 'min', 'max', 'avg', 'last'] as const).map((k) => (
                <span key={k}><b className="block font-mono text-[20px] text-ink">{n(stats[k])}</b>{t(`px.query.${k}`)}</span>
              ))}
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full rounded-[5px] border border-line bg-white" role="img" aria-label={tag}>
              <path d={path} fill="none" stroke="var(--color-blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <button type="button" className="btn btn-sm"
              onClick={() => downloadCsv(`query-${tag}`, [{ key: 'ts', label: 'ts' }, { key: 'v', label: 'value' }], pts.map((p) => ({ ts: new Date(p.t).toISOString(), v: p.v })))}>
              {t('px.export')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
