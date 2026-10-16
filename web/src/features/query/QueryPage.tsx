// Query — read-only tag-history lookup against the v2 tag-history endpoint
// (Phase 4): tag, time range, aggregation (raw | min | max | avg buckets)
// and CSV export served by the backend. No SQL ever leaves this page.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi, getToken, tagQueryApi, type TagBucket, type TagHistoryRow } from '../../lib/api';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { Segmented } from '../../shared/ui/Segmented';
import { usePrimaryScope } from '../admin/admin';
import { HelpLink } from '../onboarding/HelpLink';
import { saveBlob } from '../../lib/saveBlob';
import '../onboarding/i18n';
import '../misc/i18n';

const RANGES = { '15m': 15, '1h': 60, '4h': 240, '8h': 480 } as const;
type Range = keyof typeof RANGES;
const AGGS = ['raw', 'min', 'max', 'avg'] as const;
type Agg = (typeof AGGS)[number];
const W = 600; const H = 80;

const isBucket = (r: TagHistoryRow | TagBucket): r is TagBucket => 'n' in r;

async function downloadServerCsv(url: string, filename: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  saveBlob(filename.endsWith('.csv') ? filename : `${filename}.csv`, await res.blob());
}

export function QueryPage() {
  const { t } = useTranslation();
  const { orgId, siteId } = usePrimaryScope();
  const tags = useQuery({
    queryKey: ['query-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
  });
  const [tag, setTag] = useState('');
  const [range, setRange] = useState<Range>('1h');
  const [agg, setAgg] = useState<Agg>('raw');
  const [csvErr, setCsvErr] = useState(false);
  const from = useMemo(() => new Date(Date.now() - RANGES[range] * 60e3).toISOString(), [range]);
  const hist = useQuery({
    queryKey: ['query-history', orgId, siteId, tag, range, agg],
    queryFn: () => tagQueryApi.history(orgId!, siteId!, { tag, from, agg }),
    enabled: !!orgId && !!siteId && !!tag,
  });

  const rows = hist.data?.rows ?? [];
  const pts = useMemo(() => rows.map((r) => {
    if (isBucket(r)) return { t: Date.parse(r.ts), v: r.avg ?? r.min ?? r.max };
    return { t: Date.parse(r.ts), v: r.q === 'good' ? Number(r.v) : NaN };
  }).filter((p): p is { t: number; v: number } => Number.isFinite(p.v)), [rows]);
  const stats = useMemo(() => {
    if (!rows.length) return null;
    if (agg === 'raw') {
      const vs = pts.map((p) => p.v);
      return { count: rows.length, min: Math.min(...vs), max: Math.max(...vs), avg: vs.reduce((a, b) => a + b, 0) / vs.length, last: vs[vs.length - 1] };
    }
    const buckets = rows as TagBucket[];
    const nums = <K extends 'min' | 'max' | 'avg'>(k: K) =>
      buckets.map((b) => b[k]).filter((v): v is number => v != null);
    const mins = nums('min'); const maxs = nums('max'); const avgs = nums('avg');
    return {
      count: buckets.reduce((a, b) => a + b.n, 0),
      min: mins.length ? Math.min(...mins) : NaN,
      max: maxs.length ? Math.max(...maxs) : NaN,
      avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : NaN,
      last: avgs.length ? avgs[avgs.length - 1] : NaN,
    };
  }, [rows, agg, pts]);
  const path = useMemo(() => {
    if (pts.length < 2 || !stats) return '';
    const t0 = pts[0].t; const span = Math.max(1, pts[pts.length - 1].t - t0);
    const lo = stats.min; const rng = (stats.max - lo) || 1;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${((p.t - t0) / span) * W},${H - ((p.v - lo) / rng) * H}`).join('');
  }, [pts, stats]);
  const n = (v: number) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—');

  const exportCsv = async () => {
    if (!orgId || !siteId) return;
    setCsvErr(false);
    try {
      await downloadServerCsv(
        tagQueryApi.csvUrl(orgId, siteId, { tag, from, agg }), `query-${tag.replace(/\//g, '_')}`);
    } catch { setCsvErr(true); }
  };

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="database" title={t('px.query.title')} />
      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-white px-4 py-2">
        <label className="text-[12px] font-semibold text-ink-68">{t('px.query.metric')}
          <select className="input mt-1 block w-72 font-mono" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('px.query.pick')}</option>
            {(tags.data?.items ?? []).map((g) => <option key={g.id} value={g.path}>{g.path}</option>)}
          </select>
        </label>
        <Segmented value={range} onChange={setRange} label={t('px.query.range')} options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))} />
        <Segmented value={agg} onChange={(a) => setAgg(a as Agg)} label={t('px.query.agg')} options={AGGS.map((a) => ({ value: a, label: t(`px.query.${a}`) }))} />
      </div>
      <div className="space-y-3 p-4">
        {!tag ? (
          <EmptyState title={t('px.query.pick')} body={t('px.query.pickBody')} icon="search" action={<HelpLink doc="query" />} />
        ) : hist.isLoading ? <SkeletonRows /> : hist.isError ? <ErrorState onRetry={hist.refetch} /> : !stats ? (
          <EmptyState title={t('px.query.noData')} icon="search" />
        ) : (
          <>
            <div className="flex flex-wrap gap-6 rounded-[5px] border border-line bg-white p-4 text-[12px] text-ink-68">
              {(['count', 'min', 'max', 'avg', 'last'] as const).map((k) => (
                <span key={k}><b className="block font-mono text-[20px] text-ink">{n(stats[k])}</b>{t(`px.query.${k}`)}</span>
              ))}
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full rounded-[5px] border border-line bg-white" role="img" aria-label={tag}>
              <path d={path} fill="none" stroke="var(--color-blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            {hist.data?.truncated && <p className="text-[12px] text-ink-46">{t('px.query.truncated')}</p>}
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-sm" onClick={() => void exportCsv()}>
                {t('px.export')}
              </button>
              {csvErr && <span className="text-[12px] text-[var(--color-danger)]">{t('px.query.csvFailed')}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
