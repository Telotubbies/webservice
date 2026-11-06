// The standard chart (F04): one signal over a window, drawn by viz/TimeSeries
// with a min–max band, limits, events, bad/missing-data shading, a
// last/min/avg/max table, a shared crosshair (syncKey) and drag-to-zoom.
// The data source follows the window (raw → 1m → 1h) and re-picks on zoom,
// so zooming into a rollup spike loads the finer data under it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeSeries } from '../../viz/TimeSeries';
import type { Annotation } from '../../viz/annotations';
import { SERIES } from '../../viz/palette';
import { medianCadence } from '../../viz/stat';
import { useThemeName } from '../../theme/useTheme';
import { currentChartTheme, fmtNum, fmtRange, fmtTime, seriesStroke, type Limit } from '../trends/viz';
import { bandPlugin } from './bandPlugin';
import { bandSegments, findGaps, statsOf, yDomain } from './shape';
import { fetchChartHistory, useChartHistory, type ChartHistory } from './useChartHistory';
import './i18n';

export interface StandardChartProps {
  /** tag name as the trends API takes it (site.area.tag) */
  tag: string;
  label: string;
  unit?: string;
  decimals?: number;
  /** series colour, a light-palette slot; defaults to slot 0 */
  color?: string;
  /** window shown at first, epoch ms */
  range: [number, number];
  limits?: Limit[];
  events?: Annotation[];
  /** charts sharing a key share one crosshair; only the hovered one shows a tooltip */
  syncKey?: string;
  height?: number;
  /** data loader; defaults to the tag-history API */
  load?: (tag: string, from: number, to: number) => Promise<ChartHistory>;
}

export function StandardChart({ load, ...p }: StandardChartProps) {
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const range = zoom ?? p.range;
  const q = useChartHistory(p.tag, range[0], range[1], load ?? fetchChartHistory);
  return (
    <StandardChartView
      {...p} range={range} zoomed={!!zoom} onZoom={(a, b) => setZoom([a, b])} onZoomReset={() => setZoom(null)}
      history={q.data} loading={q.isLoading} error={q.isError} onRetry={q.refetch}
    />
  );
}

export interface ViewProps extends Omit<StandardChartProps, 'load' | 'tag'> {
  history?: ChartHistory;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  zoomed?: boolean;
  onZoom: (from: number, toMs: number) => void;
  onZoomReset: () => void;
}

/** Presentational half: everything it draws comes from props. */
export function StandardChartView({
  label, unit, decimals = 1, color = SERIES.light[0], range, limits = [], events = [], syncKey, height = 220,
  history, loading, error, onRetry, zoomed, onZoom, onZoomReset,
}: ViewProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const themeName = useThemeName();
  const theme = useMemo(() => currentChartTheme(), [themeName]); // eslint-disable-line react-hooks/exhaustive-deps
  const samples = useMemo(() => history?.samples ?? [], [history]);
  const plan = history?.plan;
  const stepMs = plan?.bucketS ? plan.bucketS * 1000 : Math.max(1000, medianCadence(samples.map((s) => ({ t: s.t, v: 0 }))));
  const gaps = useMemo(() => (history ? findGaps(samples, range, stepMs) : []), [history, samples, range, stepMs]);
  const band = useMemo(() => bandSegments(samples, stepMs * 3), [samples, stepMs]);
  const stats = useMemo(() => statsOf(samples), [samples]);
  const dom = useMemo(() => yDomain(samples, limits.map((l) => l.v)), [samples, limits]);
  const pts = useMemo(() => samples.filter((s) => s.v != null).map((s) => ({ t: s.t, v: s.v as number })), [samples]);
  const stroke = seriesStroke(color, theme.name);

  const fmt = (v: number | null) => (v == null ? t('charts.none') : `${fmtNum(v, decimals, lang)}${unit ? ` ${unit}` : ''}`);
  // the plugin is built once; effects hand it the latest shapes and repaint
  const band$ = useMemo(() => bandPlugin(), []);
  const plugins = useMemo(() => [band$.plugin], [band$]);
  useEffect(() => {
    band$.update({
      band, gaps, color: stroke, bad: `${theme.crit}22`, missing: `${theme.grid}99`,
      limits: limits.map((l) => ({ v: l.v, color: l.severity === 'critical' ? theme.crit : theme.warn })),
    });
  }, [band$, band, gaps, stroke, theme, limits]);

  // tooltip line for rollup points; the plot is built once, so read through a ref
  const byTime = useRef(new Map<number, string>());
  useEffect(() => {
    byTime.current = new Map(samples.filter((s) => s.mn != null && s.mx != null)
      .map((s) => [s.t / 1000, `${t('charts.min')} ${fmt(s.mn ?? null)} · ${t('charts.max')} ${fmt(s.mx ?? null)}`]));
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useCallback((tSec: number) => byTime.current.get(tSec) ?? null, []);

  const hasBand = band.length > 0;
  const hasBad = gaps.some((g) => g.kind === 'bad');
  const hasMissing = pts.length > 0 && gaps.some((g) => g.kind === 'missing');
  const centre = (range[0] + range[1]) / 2;
  const half = (range[1] - range[0]) / 2;
  const zoomBy = (k: number) => onZoom(Math.round(centre - half * k), Math.round(centre + half * k));

  return (
    <section className="rounded-control border border-line bg-panel p-3" aria-label={label}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold text-ink">{label}{unit && <span className="ml-1 font-normal text-ink-2">({unit})</span>}</h3>
        <p className="text-[11px] tabular-nums text-ink-2">
          {zoomed ? t('charts.zoomed', { range: fmtRange(range[0], range[1], lang) }) : fmtRange(range[0], range[1], lang)}
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {plan && (
            <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2" title={t('charts.sourceHint')} data-source={plan.source}>
              {t(`charts.source_${plan.source}`)}{plan.bucketS ? ` · ${t('charts.bucket', { n: bucketLabel(plan.bucketS, t) })}` : ''}
            </span>
          )}
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => zoomBy(0.5)} aria-label={t('charts.zoomIn')} title={t('charts.zoomIn')}>+</button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => zoomBy(2)} aria-label={t('charts.zoomOut')} title={t('charts.zoomOut')}>−</button>
          {zoomed && <button type="button" className="btn btn-sm btn-ghost" onClick={onZoomReset}>{t('charts.zoomReset')}</button>}
        </div>
      </header>
      {history?.truncated && <p className="mt-1 text-[11px] text-ink-2" role="note">{t('charts.truncated')}</p>}

      <div className="mt-2" title={t('charts.zoomHint')}>
        <TimeSeries
          series={[{ key: label, label, color, unit, decimals, pts }]}
          limits={limits} unit={unit} xRange={range} height={height} syncKey={syncKey}
          annotations={events} plugins={plugins} detail={detail}
          yMin={dom?.[0]} yMax={dom?.[1]}
          loading={loading} error={error} onRetry={onRetry} hasPrevious={!!history}
          onZoom={onZoom}
        />
      </div>

      <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-2">
        {hasBand && <li className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm" style={{ background: stroke, opacity: 0.25 }} aria-hidden />{t('charts.legendBand')}</li>}
        {hasBad && <li className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm border border-crit" style={{ background: 'repeating-linear-gradient(135deg, var(--color-crit) 0 1px, transparent 1px 4px)' }} aria-hidden />{t('charts.gapBad')}</li>}
        {hasMissing && <li className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-line" aria-hidden />{t('charts.gapMissing')}</li>}
        {events.length > 0 && <li>{t('charts.events')}: {events.length}</li>}
      </ul>

      <table className="mt-2 w-full text-[12px]">
        <caption className="sr-only">{t('charts.statsCaption', { name: label })}</caption>
        <thead className="text-ink-2">
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-semibold">{t('charts.signal')}</th>
            {(['last', 'min', 'avg', 'max'] as const).map((k) => <th key={k} scope="col" className="px-2 py-1 text-right font-semibold">{t(`charts.${k}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <th scope="row" className="px-2 py-1 text-left font-semibold text-ink">
              <span className="mr-1.5 inline-block h-[3px] w-3 align-middle" style={{ background: stroke }} aria-hidden />{label}
            </th>
            <td className="px-2 py-1 text-right font-mono tabular-nums" title={stats.lastT != null ? t('charts.lastAt', { time: fmtTime(stats.lastT, true) }) : undefined}>{fmt(stats.last)}</td>
            <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(stats.min)}</td>
            <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(stats.avg)}</td>
            <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(stats.max)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function bucketLabel(s: number, t: (k: string, o: { n: number }) => string): string {
  return s % 3600 === 0 ? t('charts.unitH', { n: s / 3600 }) : s % 60 === 0 ? t('charts.unitMin', { n: s / 60 }) : t('charts.unitS', { n: s });
}
