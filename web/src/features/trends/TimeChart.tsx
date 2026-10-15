// TimeChart — the one uPlot wrapper every trend surface uses. Owns the chart
// grammar (viz.ts), an HTML legend (identity never colour-alone: swatch +
// name + last value + unit, and the limit lines), and the state contract:
// loading skeleton · error with retry · empty window · data.

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import {
  LIMIT_STROKE, chartOptions, fmtNum, fmtRange, joinSeries, limitLabel,
  type Limit, type Pt, type SeriesSpec,
} from './viz';

export interface ChartSeries extends SeriesSpec { pts: Pt[] }

export function TimeChart({
  series, limits = [], unit, xRange, height, fill = false, syncKey, onZoom,
  yMin, yMax, legend = true, loading, error, onRetry, compact = false,
}: {
  series: ChartSeries[];
  limits?: Limit[];
  unit?: string;
  xRange: [number, number];
  /** fixed plot height; omit with fill to size to the parent */
  height?: number;
  fill?: boolean;
  syncKey?: string;
  onZoom?: (fromMs: number, toMs: number) => void;
  yMin?: number | null;
  yMax?: number | null;
  legend?: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** smaller empty/error states for dashboard widgets */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  const hasData = series.some((s) => s.pts.length > 0);

  // structure key: rebuild only when what is drawn changes, not on new data
  const structure = JSON.stringify([
    series.map((s) => [s.key, s.label, s.color, s.unit, s.decimals, s.width]),
    limits, unit, yMin, yMax, syncKey, i18n.language, height, fill, !!onZoom,
  ]);
  const data = useMemo(() => joinSeries(series.map((s) => s.pts)), [series]);
  const rangeRef = useRef(xRange);
  rangeRef.current = xRange;

  useEffect(() => {
    const el = box.current;
    if (!el || !hasData) return;
    const size = () => ({
      width: Math.max(120, el.clientWidth),
      height: height ?? Math.max(80, el.clientHeight),
    });
    const opts = chartOptions({
      ...size(),
      series, limits, unit, locale: i18n.language, yMin, yMax, syncKey,
      xRange: rangeRef.current,
      onZoom: zoomRef.current ? (a, b) => zoomRef.current?.(a, b) : undefined,
    });
    // x range is read live so a moving live window doesn't need a rebuild
    opts.scales!.x!.range = () => [rangeRef.current[0] / 1000, rangeRef.current[1] / 1000];
    const u = new uPlot(opts, data, el);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize(size()));
    ro.observe(el);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, hasData]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data, xRange[0], xRange[1]]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[80px] flex-col justify-end gap-2 p-2" role="status" aria-label={t('viz.loading')}>
        <Skeleton h={compact ? 60 : (height ?? 160) - 20} />
        <Skeleton w="40%" h={10} />
      </div>
    );
  }
  if (error) {
    return compact
      ? <div className="error-state !p-3" role="alert"><p className="text-[12px]">{t('viz.loadFailed')}</p>{onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>{t('common.retry')}</button>}</div>
      : <ErrorState onRetry={onRetry} detail={t('viz.loadFailed')} />;
  }
  if (!hasData) {
    return compact
      ? <div className="empty !p-3"><p className="text-[12px] font-semibold">{t('viz.noData')}</p><p className="text-[11px]">{fmtRange(xRange[0], xRange[1], i18n.language)}</p></div>
      : <EmptyState icon="search" title={t('viz.noData')} body={t('viz.noDataBody', { range: fmtRange(xRange[0], xRange[1], i18n.language) })} />;
  }

  const names = series.map((s) => s.label).join(', ');
  return (
    <div className={`flex min-h-0 flex-col ${fill ? 'h-full' : ''}`}>
      <div
        ref={box}
        className={`relative min-h-0 w-full ${fill ? 'flex-1' : ''}`}
        style={height ? { height } : undefined}
        role="img"
        aria-label={t('viz.chartLabel', { unit: unit || t('viz.noUnit'), names })}
      />
      {legend && (series.length > 1 || limits.length > 0) && (
        <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-68" aria-label={t('viz.legend')}>
          {series.length > 1 && series.map((s) => {
            const last = s.pts.length ? s.pts[s.pts.length - 1].v : null;
            return (
              <li key={s.key} className="flex min-w-0 items-center gap-1.5">
                <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="truncate">{s.label}</span>
                <span className="font-mono font-semibold text-ink">{fmtNum(last, s.decimals, i18n.language)}{s.unit ? ` ${s.unit}` : ''}</span>
              </li>
            );
          })}
          {limits.map((l, i) => (
            <li key={`l${i}`} className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke={LIMIT_STROKE[l.severity]} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>{l.severity === 'critical' ? '▲' : l.severity === 'warning' ? '◆' : '●'} {limitLabel(l, unit, i18n.language, series[0]?.decimals)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
