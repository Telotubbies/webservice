// Multi-signal trend (uPlot, ADR-11). Seeds from /history, then appends live
// samples on rAF flushes. Selection + window live in the URL (shareable).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { SIGNALS, T, displayNumber, shortName } from '../../lib/plant';
import type { TagInfo } from '../../types';
import { ErrorState, Notice, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { Segmented } from '../../shared/ui/Segmented';
import './trends.css';

const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];
const SAMPLE_MS = 500;
const CAP = 2400;
const DEFAULT = [T.beltSpeed, T.beltTemp, T.binLevel];
const WINDOWS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 } as const;
type Win = keyof typeof WINDOWS;
type Rows = { x: number[]; ys: (number | null)[][] };

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function TrendsPage({ tags }: { tags: TagInfo[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const known = useMemo(() => new Set(tags.map((x) => x.name)), [tags]);
  const selected = useMemo(() => {
    const fromUrl = params.get('s')?.split(',').filter((n) => known.has(n)) ?? [];
    return fromUrl.length ? fromUrl.slice(0, 6) : DEFAULT.filter((n) => known.has(n));
  }, [params, known]);
  const win = (params.get('w') as Win) in WINDOWS ? (params.get('w') as Win) : '15m';
  const winRef = useRef<number>(WINDOWS[win]);
  winRef.current = WINDOWS[win];

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const rowsRef = useRef<Rows>({ x: [], ys: [] });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = selected.join(',');

  const label = (n: string) => (SIGNALS[n] ? t(SIGNALS[n].labelKey) : shortName(n));
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const toggle = (n: string) => {
    const cur = selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n].slice(0, 6);
    update({ s: cur.join(',') || null });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || selected.length === 0) return;
    let cancelled = false;
    let u: uPlot | null = null;
    let unsub: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    let last = 0;
    setLoading(true);
    setFailed(false);
    setZoomed(false);

    void (async () => {
      let perTag: { v: number | boolean; ts: string }[][];
      try {
        // Seed only the selected window — otherwise a large history makes the
        // chart open on days of data instead of the chosen view.
        const from = new Date(Date.now() - winRef.current).toISOString();
        perTag = await Promise.all(selected.map((n) => api.history(n, { from, limit: CAP })));
      } catch {
        if (!cancelled) { setFailed(true); setLoading(false); }
        return;
      }
      if (cancelled) return;
      const maps = perTag.map((rows, i) => {
        const m = new Map<number, number | null>();
        for (const r of rows) {
          const ts = Date.parse(r.ts);
          const num = typeof r.v === 'boolean' ? (r.v ? 1 : 0) : r.v;
          if (Number.isFinite(ts)) m.set(ts, typeof num === 'number' && Number.isFinite(num) ? displayNumber(selected[i], num) : null);
        }
        return m;
      });
      const xs = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b).slice(-CAP);
      rowsRef.current = { x: xs, ys: maps.map((m) => xs.map((x) => m.get(x) ?? null)) };

      const axis = {
        stroke: css('--text-secondary'),
        font: `13px ${css('--font-mono')}`,
        grid: { stroke: css('--line'), width: 1 },
        ticks: { stroke: css('--line-strong') },
      };
      u = new uPlot({
        ms: 1, // x values are millisecond epochs (Date.parse / Date.now)
        width: el.clientWidth || 800,
        height: 420,
        padding: [16, 16, 0, 0],
        scales: { x: { time: true } },
        cursor: { drag: { x: true, y: false } },
        legend: { show: true, live: true },
        axes: [axis, { ...axis, size: 64 }],
        hooks: { setSelect: [() => setZoomed(true)] },
        series: [
          { label: t('trends.time') },
          ...selected.map((n, i) => ({
            label: `${label(n)}${SIGNALS[n]?.unit ? ` (${SIGNALS[n].unit})` : ''}`,
            stroke: css(SERIES[i % SERIES.length]),
            width: 2,
            points: { show: false },
            value: (_u: uPlot, v: number | null) => (v == null ? '—' : v.toFixed(2)),
          })),
        ],
      }, [rowsRef.current.x, ...rowsRef.current.ys] as uPlot.AlignedData, el);
      chartRef.current = u;
      setLoading(false);

      const push = () => {
        const now = Date.now();
        if (!u || now - last < SAMPLE_MS) return;
        last = now;
        const r = rowsRef.current;
        r.x.push(now);
        selected.forEach((n, i) => {
          const lv = live.latest.get(n);
          const num = lv === undefined ? null : typeof lv.v === 'boolean' ? (lv.v ? 1 : 0) : displayNumber(n, lv.v);
          r.ys[i].push(num);
        });
        if (r.x.length > CAP) { const e = r.x.length - CAP; r.x.splice(0, e); r.ys.forEach((y) => y.splice(0, e)); }
        u.setData([r.x, ...r.ys] as uPlot.AlignedData, false);
        if (!zoomRef.current) {
          const xMax = r.x[r.x.length - 1] ?? now;
          u.setScale('x', { min: Math.max(r.x[0] ?? xMax, xMax - winRef.current), max: xMax });
        }
      };
      push();
      unsub = live.subscribe(push);
      ro = new ResizeObserver(() => u?.setSize({ width: el.clientWidth || 800, height: 420 }));
      ro.observe(el);
    })();

    return () => { cancelled = true; unsub?.(); ro?.disconnect(); u?.destroy(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const zoomRef = useRef(false);
  zoomRef.current = zoomed;

  const exportCsv = () => {
    const r = rowsRef.current;
    const head = ['timestamp_utc', ...selected.map((n) => n)].join(',');
    const lines = r.x.map((x, i) => [new Date(x).toISOString(), ...r.ys.map((y) => y[i] ?? '')].join(','));
    const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trend-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('trends.title')}</h1>
          <p className="lede">{t('trends.lede')}</p>
        </div>
        <div className="actions">
          {zoomed && (
            <button className="btn btn-sm btn-ghost" onClick={() => setZoomed(false)}>{t('trends.reset')}</button>
          )}
          <Segmented<Win>
            label={t('trends.window')} value={win} onChange={(w) => { setZoomed(false); update({ w }); }}
            options={(Object.keys(WINDOWS) as Win[]).map((w) => ({ value: w, label: w.toUpperCase() }))}
          />
          <button className="btn btn-sm" onClick={exportCsv} disabled={loading || selected.length === 0}>
            <Icon name="download" size={16} /> {t('trends.exportCsv')}
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="signal-picker" role="group" aria-label={t('trends.signals')}>
          {tags.map((tag) => {
            const i = selected.indexOf(tag.name);
            const on = i >= 0;
            return (
              <button
                key={tag.name} type="button" className={`signal-chip${on ? ' is-on' : ''}`}
                aria-pressed={on} onClick={() => toggle(tag.name)} title={tag.name}
                style={on ? { ['--chip' as string]: `var(${SERIES[i % SERIES.length]})` } : undefined}
                disabled={!on && selected.length >= 6}
              >
                <span className="swatch" aria-hidden />{label(tag.name)}
              </button>
            );
          })}
          <span className="hint">{t('trends.max')}</span>
        </div>
        <div className="panel-body trend-body">
          {selected.length === 0 && <Notice>{t('trends.none')}</Notice>}
          {failed && <ErrorState onRetry={() => setAttempt((a) => a + 1)} />}
          {loading && selected.length > 0 && !failed && (
            <div className="chart-skeleton" aria-label={t('trends.loading')}><Skeleton h={420} /></div>
          )}
          <div ref={wrapRef} className="chart-wrap" hidden={failed || selected.length === 0} />
        </div>
      </section>
    </div>
  );
}
