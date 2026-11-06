// TimeSeries v2 — the uPlot wrapper every trend surface uses (spec §7.1,
// §7.3, M8, M10). Grew out of trends/TimeChart (which now re-exports it).
//
//  - Colours come from the chart theme (palette.ts); the plot rebuilds when
//    the theme changes, never on new data (live data is setData only).
//  - Silence is a gap (withGaps) — an outage never draws as a flat line.
//  - Legend: swatch + name + last value; click isolates, ⌘/Ctrl-click
//    toggles. Hiding a series never repaints the others (colour follows the
//    entity).
//  - Limits are the only dashed lines; ▼ marks where a value first breached.
//  - Annotations: alarm / command / batch hairlines.
//  - A refetch keeps the last plot at 0.6 opacity (M10); a drag-zoom eases
//    the x scale over 250 ms (M8) unless motion is reduced.
//  - Canvas has no semantics, so the chart carries its text alternative: a
//    per-series summary, ← → read-out under a keyboard cursor, and a table.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { EmptyState, ErrorState, Skeleton } from '../shared/ui/Feedback';
import {
  LIMIT_STROKE, chartOptions, currentChartTheme, fmtNum, fmtRange, fmtTime, joinSeries, limitLabel, seriesStroke,
  type Limit, type Pt, type SeriesSpec,
} from '../features/trends/viz';
import { summarize, tableRows } from '../features/trends/summary';
import { chartPhase } from '../features/trends/chartMount';
import { useThemeName } from '../theme/useTheme';
import { chartThemeKey } from './palette';
import { legendToggle, withGaps } from './series';
import type { Annotation } from './annotations';
import './i18n';

export interface ChartSeries extends SeriesSpec { pts: Pt[] }

const reducedMotion = () =>
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || document.documentElement.dataset.motion === 'calm';

export function TimeSeries({
  series, limits = [], unit, xRange, height, fill = false, syncKey, onZoom,
  yMin, yMax, legend = true, loading, error, onRetry, compact = false,
  annotations = [], view, hasPrevious = false, plugins, detail,
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
  annotations?: Annotation[];
  /** force chart or table; omitted, the reader toggles it */
  view?: 'chart' | 'table';
  /** a previous render exists: a refetch dims it instead of a skeleton */
  hasPrevious?: boolean;
  /** extra uPlot plugins, built once per chart (they read their data from a ref) */
  plugins?: uPlot.Plugin[];
  /** extra tooltip line for a sample time (epoch s) */
  detail?: (tSec: number) => string | null;
}) {
  const { t, i18n } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  const hasData = series.some((s) => s.pts.length > 0);
  const refetch = !!loading && hasPrevious && hasData;
  const phase = chartPhase({ loading: loading && !refetch, error, hasData });
  const themeName = useThemeName();
  const theme = useMemo(() => currentChartTheme(), [themeName]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = series.map((s) => s.key);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(keys));
  // a series that appears later starts visible; one that left is forgotten
  const keyStr = keys.join('\u0001');
  useEffect(() => {
    setVisible((v) => {
      const next = new Set([...v].filter((k) => keys.includes(k)));
      for (const k of keys) if (!v.has(k) && !prevKeys.current.includes(k)) next.add(k);
      return next.size ? next : new Set(keys);
    });
    prevKeys.current = keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr]);
  const prevKeys = useRef<string[]>(keys);

  // structure key: rebuild only when what is drawn changes, not on new data
  const structure = JSON.stringify([
    series.map((s) => [s.key, s.label, s.color, s.unit, s.decimals, s.width]),
    limits, unit, yMin, yMax, syncKey, i18n.language, height, fill, !!onZoom, chartThemeKey(theme),
    annotations.map((a) => [a.t, a.kind, a.severity]),
  ]);
  const data = useMemo(() => joinSeries(series.map((s) => withGaps(s.pts))), [series]);
  const rangeRef = useRef(xRange);
  const shown = useRef(xRange);
  const descId = useId();
  const [readout, setReadout] = useState('');
  const [tableOn, setTableOn] = useState(false);
  const table = view ? view === 'table' : tableOn;
  const cursor = useRef<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || phase !== 'plot') return;
    const size = () => ({ width: Math.max(120, el.clientWidth), height: height ?? Math.max(80, el.clientHeight) });
    const opts = chartOptions({
      ...size(),
      series, limits, unit, locale: i18n.language, yMin, yMax, syncKey, theme, annotations, plugins, detail,
      xRange: rangeRef.current,
      onZoom: zoomRef.current ? (a, b) => zoomRef.current?.(a, b) : undefined,
    });
    // x range is read live so a moving live window doesn't need a rebuild
    opts.scales!.x!.range = () => [rangeRef.current[0] / 1000, rangeRef.current[1] / 1000];
    const u = new uPlot(opts, data, el);
    series.forEach((s, i) => { if (!visible.has(s.key)) u.setSeries(i + 1, { show: false }); });
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize(size()));
    ro.observe(el);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, phase === 'plot']);

  useEffect(() => { plot.current?.setData(data); }, [data]);

  // M8: a zoom (span change) eases over 250 ms; a sliding live window and
  // reduced motion jump straight there.
  useEffect(() => {
    const prev = shown.current;
    const next = xRange;
    shown.current = next;
    const u = plot.current;
    const spanPrev = prev[1] - prev[0];
    const spanChange = spanPrev > 0 ? Math.abs((next[1] - next[0]) - spanPrev) / spanPrev : 1;
    if (!u || spanChange < 0.05 || reducedMotion()) {
      rangeRef.current = next;
      u?.setScale('x', { min: next[0] / 1000, max: next[1] / 1000 });
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 250);
      const e = 1 - (1 - k) ** 3;
      rangeRef.current = [prev[0] + (next[0] - prev[0]) * e, prev[1] + (next[1] - prev[1]) * e];
      u.setScale('x', { min: rangeRef.current[0] / 1000, max: rangeRef.current[1] / 1000 });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); rangeRef.current = next; };
  }, [xRange[0], xRange[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickLegend = (key: string, e: MouseEvent) => {
    const next = legendToggle(visible, key, e.ctrlKey || e.metaKey ? 'toggle' : 'isolate', keys);
    setVisible(next);
    series.forEach((s, i) => plot.current?.setSeries(i + 1, { show: next.has(s.key) }));
  };

  if (phase === 'loading') {
    return (
      <div className="flex h-full min-h-[80px] flex-col justify-end gap-2 p-2" role="status" aria-label={t('viz.loading')}>
        <Skeleton h={compact ? 60 : (height ?? 160) - 20} />
        <Skeleton w="40%" h={10} />
      </div>
    );
  }
  if (phase === 'error') {
    return compact
      ? <div className="error-state !p-3" role="alert"><p className="text-[12px]">{t('viz.loadFailed')}</p>{onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>{t('common.retry')}</button>}</div>
      : <ErrorState onRetry={onRetry} detail={t('viz.loadFailed')} />;
  }
  if (phase === 'empty') {
    return compact
      ? <div className="empty !p-3"><p className="text-[12px] font-semibold">{t('viz.noData')}</p><p className="text-[11px]">{fmtRange(xRange[0], xRange[1], i18n.language)}</p></div>
      : <EmptyState icon="search" title={t('viz.noData')} body={t('viz.noDataBody', { range: fmtRange(xRange[0], xRange[1], i18n.language) })} />;
  }

  const names = series.map((s) => s.label).join(', ');
  const lang = i18n.language;
  const withUnit = (v: number | null | undefined, s: ChartSeries) =>
    `${fmtNum(v, s.decimals, lang)}${(s.unit ?? unit) ? ` ${s.unit ?? unit}` : ''}`;
  const summaryText = series.map((s) => {
    const m = summarize(s.pts);
    return m ? t('viz.sumSeries', {
      name: s.label, last: withUnit(m.last, s), min: withUnit(m.min, s), max: withUnit(m.max, s),
      trend: t(`viz.trend_${m.trend}`),
    }) : t('viz.sumEmpty', { name: s.label });
  }).join(' ');

  /* Keyboard cursor: ← → step one sample, PgUp/PgDn ten, Home/End the ends,
     Esc hides it. The uPlot tooltip follows (it hooks setCursor) and a polite
     live region reads the same values out. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const u = plot.current;
    const xs = u?.data[0];
    if (!u || !xs?.length) return;
    const n = xs.length;
    let i = cursor.current ?? n - 1;
    switch (e.key) {
      case 'ArrowLeft': i -= 1; break;
      case 'ArrowRight': i += 1; break;
      case 'PageUp': i -= 10; break;
      case 'PageDown': i += 10; break;
      case 'Home': i = 0; break;
      case 'End': i = n - 1; break;
      case 'Escape': cursor.current = null; u.setCursor({ left: -10, top: -10 }); setReadout(''); return;
      default: return;
    }
    e.preventDefault();
    i = Math.max(0, Math.min(n - 1, i));
    cursor.current = i;
    const ys = series.map((_, k) => u.data[k + 1]?.[i] ?? null);
    const firstY = ys.find((v) => v != null && Number.isFinite(v));
    u.setCursor({ left: u.valToPos(xs[i], 'x'), top: firstY != null ? u.valToPos(firstY, 'y') : u.over.clientHeight / 2 });
    setReadout(`${fmtTime(xs[i] * 1000, true)} · ${series.map((s, k) => `${s.label} ${ys[k] == null ? '—' : withUnit(ys[k], s)}`).join(', ')}`);
  };
  const onBlur = () => {
    if (cursor.current == null) return;
    cursor.current = null;
    plot.current?.setCursor({ left: -10, top: -10 });
    setReadout('');
  };
  const rows = table ? tableRows(data[0].length, 200) : [];

  return (
    <div className={`flex min-h-0 flex-col transition-opacity duration-200 ${fill ? 'h-full' : ''} ${refetch ? 'opacity-60' : ''}`} aria-busy={refetch || undefined}>
      <div
        ref={box}
        className={`relative min-h-0 w-full ${fill ? 'flex-1' : ''} ${table && view === 'table' ? 'hidden' : ''}`}
        style={height ? { height } : undefined}
        role="img"
        tabIndex={0}
        aria-label={`${t('viz.chartLabel', { unit: unit || t('viz.noUnit'), names })}. ${t('viz.kbdHint')}`}
        aria-describedby={descId}
        onKeyDown={onKey}
        onBlur={onBlur}
      />
      <p id={descId} className="sr-only">{summaryText}</p>
      <p className="sr-only" role="status" aria-live="polite">{readout}</p>
      {legend && (series.length > 1 || limits.length > 0) && (
        <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-ink-2" aria-label={t('viz.legend')}>
          {series.length > 1 && series.map((s) => {
            const last = s.pts.length ? s.pts[s.pts.length - 1].v : null;
            const on = visible.has(s.key);
            return (
              <li key={s.key}>
                <button type="button" aria-pressed={on} title={t('viz2.isolateHint')} onClick={(e) => pickLegend(s.key, e)}
                  className={`flex min-h-6 min-w-0 items-center gap-1.5 rounded-control px-1 hover:bg-panel-2 ${on ? '' : 'opacity-45'}`}>
                  <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: seriesStroke(s.color, themeName) }} aria-hidden />
                  <span className="truncate">{s.label}</span>
                  <span className="font-mono font-semibold tabular-nums text-ink">{fmtNum(last, s.decimals, i18n.language)}{s.unit ? ` ${s.unit}` : ''}</span>
                </button>
              </li>
            );
          })}
          {limits.map((l, i) => (
            <li key={`l${i}`} className="flex items-center gap-1.5 px-1">
              <svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke={LIMIT_STROKE[l.severity]} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>{l.severity === 'critical' ? '▲' : l.severity === 'warning' ? '◆' : '●'} {limitLabel(l, unit, i18n.language, series[0]?.decimals)}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && !view && (
        <div className="flex justify-end px-1">
          <button type="button" className="text-[11px] text-accent hover:underline" aria-expanded={table} onClick={() => setTableOn((v) => !v)}>
            {table ? t('viz.hideTable') : t('viz.showTable')}
          </button>
        </div>
      )}
      {table && (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-line">
          <table className="w-full text-[12px]">
            <caption className="sr-only">{t('viz.tableCaption', { names, count: rows.length })}</caption>
            <thead className="sticky top-0 bg-panel-2 text-ink-2">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-semibold">{t('viz.colTime')}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-2 py-1 text-right font-semibold">{s.label}{(s.unit ?? unit) ? ` (${s.unit ?? unit})` : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-0.5 font-mono text-ink-2">{fmtTime(data[0][i] * 1000, true)}</td>
                  {series.map((s, k) => (
                    <td key={s.key} className="px-2 py-0.5 text-right font-mono tabular-nums">{fmtNum(data[k + 1]?.[i], s.decimals, lang)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
