// Widget renderers. Data comes from the real API surface (history, latest)
// and the live alarm store; no widget fetches anything the backend lacks.

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { api } from '../../lib/api';
import { SIGNALS } from '../../lib/plant';
import { useNow } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { useAlarms } from '../alarms/alarms';
import { SeverityBadge, normSeverity } from '../../shared/ui/Status';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { RANGE_MIN, type Agg, type RangeKey, type Widget } from './model';

const short = (tag: string) => tag.split('.').slice(-2).join('.');
export const unitOfWidget = (w: Widget) => w.unit || SIGNALS[w.tags[0]]?.unit || '';
const num = (v: number | boolean) => (typeof v === 'number' ? v : v ? 1 : 0);

function useHistory(tags: string[], minutes: number) {
  return useQuery({
    queryKey: ['history', tags, minutes],
    queryFn: () => {
      const from = new Date(Date.now() - minutes * 60e3).toISOString();
      return Promise.all(tags.map((tag) => api.history(tag, { from, limit: 600 })));
    },
    enabled: tags.length > 0,
    refetchInterval: 30_000,
  });
}

export type Level = 'crit' | 'warn' | 'ok';
/** Thresholds assume "higher is worse" (HiHi / Hi alarm style). */
export function levelOf(v: number | null, w: Widget): Level {
  if (v == null) return 'ok';
  if (w.crit != null && v >= w.crit) return 'crit';
  if (w.warn != null && v >= w.warn) return 'warn';
  return 'ok';
}

export function WidgetBody({ w, range }: { w: Widget; range: RangeKey }) {
  const minutes = RANGE_MIN[w.range === 'inherit' ? range : w.range];
  switch (w.kind) {
    case 'timeseries': return <TimeseriesBody w={w} minutes={minutes} />;
    case 'value': return <ValueBody w={w} minutes={minutes} />;
    case 'toplist': return <ToplistBody w={w} />;
    case 'alarms': return <AlarmsBody />;
    case 'note': return <p className="h-full overflow-auto whitespace-pre-wrap text-[13px] leading-5 text-ink">{w.note}</p>;
  }
}

function aggregate(vals: number[], agg: Agg): number | null {
  if (!vals.length) return null;
  if (agg === 'last') return vals[vals.length - 1];
  if (agg === 'min') return Math.min(...vals);
  if (agg === 'max') return Math.max(...vals);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const LEVEL_STYLE: Record<Level, string> = { crit: 'bg-[#fde8ea] text-[#a3263c]', warn: 'bg-[var(--color-caution-soft)] text-[#8a5a00]', ok: '' };

function ValueBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t } = useTranslation();
  const hist = useHistory(w.tags.slice(0, 1), minutes);
  if (!w.tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (hist.isLoading) return <Skeleton h={40} />;
  if (hist.isError) return <ErrorState onRetry={() => void hist.refetch()} />;
  const v = aggregate((hist.data?.[0] ?? []).map((p) => num(p.v)), w.agg);
  const lvl = levelOf(v, w);
  return (
    <div className={`flex h-full flex-col justify-center rounded px-2 ${LEVEL_STYLE[lvl]}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[34px] font-semibold leading-none">{v == null ? '—' : v.toFixed(w.decimals)}</span>
        <span className="text-[13px] opacity-70">{unitOfWidget(w)}</span>
      </div>
      <div className="mt-1 text-[11px] opacity-80">
        {t(`dash.agg.${w.agg}`)} · {short(w.tags[0])}
        {lvl !== 'ok' && <span className="ml-2 font-semibold">{lvl === 'crit' ? `▲ ${t('alarms.critical')}` : `◆ ${t('alarms.warning')}`}</span>}
      </div>
    </div>
  );
}

function TimeseriesBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t } = useTranslation();
  const hist = useHistory(w.tags, minutes);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !hist.data?.[0]?.length) return;
    // all series share the first series' grid (same window + limit per request)
    const xs = hist.data[0].map((p) => Date.parse(p.ts) / 1000);
    const ys = hist.data.map((s) => xs.map((_, i) => (s[i] ? num(s[i].v) : NaN)));
    const thresholds: { v: number; stroke: string; label: string }[] = [];
    if (w.warn != null) thresholds.push({ v: w.warn, stroke: '#f99d02', label: t('alarms.warning') });
    if (w.crit != null) thresholds.push({ v: w.crit, stroke: '#d24f57', label: t('alarms.critical') });
    const legendH = w.legend ? 28 : 0;
    const size = () => ({ width: el.clientWidth, height: Math.max(80, el.clientHeight - legendH) });
    const plot = new uPlot({
      ...size(),
      legend: { show: w.legend },
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: true },
        y: w.yMin != null || w.yMax != null
          ? { range: (_u, lo, hi) => [w.yMin ?? lo, w.yMax ?? hi] }
          : {},
      },
      axes: [
        { stroke: '#5d6670', grid: { stroke: '#eef1f4' }, font: '11px "IBM Plex Mono"' },
        { stroke: '#5d6670', grid: { stroke: '#eef1f4' }, font: '11px "IBM Plex Mono"' },
      ],
      series: [
        {},
        ...w.tags.map((tag, i) => ({ label: short(tag), stroke: w.colors[i] ?? '#006bc2', width: w.lineWidth, value: (_u: uPlot, v: number | null) => (v == null ? '—' : v.toFixed(w.decimals)) })),
        ...thresholds.map((th) => ({ label: th.label, stroke: th.stroke, width: 1, dash: [6, 4], points: { show: false } })),
      ],
    }, [xs, ...ys, ...thresholds.map((th) => xs.map(() => th.v))] as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => plot.setSize(size()));
    ro.observe(el);
    return () => { ro.disconnect(); plot.destroy(); };
  }, [hist.data, w, t]);

  if (!w.tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (hist.isLoading) return <Skeleton h={120} />;
  if (hist.isError) return <ErrorState onRetry={() => void hist.refetch()} />;
  if (!hist.data?.[0]?.length) return <EmptyState title={t('dash.noData')} icon="search" />;
  return <div ref={box} className="h-full min-h-0 w-full" role="img" aria-label={t('dash.chartLabel', { title: w.title || w.tags.map(short).join(', ') })} />;
}

function ToplistBody({ w }: { w: Widget }) {
  const { t } = useTranslation();
  const { open } = useAlarms();
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of open) {
      const k = w.groupBy === 'rule' ? a.rule : w.groupBy === 'severity' ? normSeverity(a.severity) : short(a.tag);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [open, w.groupBy]);
  if (!rows.length) return <EmptyState title={t('alarms.emptyActive')} />;
  const max = rows[0][1];
  return (
    <ol className="space-y-1.5 overflow-auto">
      {rows.map(([k, n]) => (
        <li key={k} className="text-[12px]">
          <div className="flex justify-between gap-2"><span className="truncate">{w.groupBy === 'severity' ? t(`alarms.${k}`) : k}</span><span className="font-mono">{n}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-[var(--color-blue)]" style={{ width: `${(n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

function AlarmsBody() {
  const { t } = useTranslation();
  const { open } = useAlarms();
  const now = useNow();
  if (!open.length) return <EmptyState title={t('alarms.emptyActive')} body={t('alarms.emptyActiveBody')} />;
  return (
    <ul className="h-full overflow-auto">
      {open.slice(0, 20).map((a) => (
        <li key={a.id} className="flex items-center gap-2 border-b border-line py-1.5 text-[12px] last:border-0">
          <SeverityBadge severity={a.severity} />
          <span className="min-w-0 flex-1 truncate">{a.rule}</span>
          <span className="shrink-0 text-ink-46">{fmtAge(a.ts, now)}</span>
        </li>
      ))}
    </ul>
  );
}
