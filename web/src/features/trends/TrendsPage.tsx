// Trends — the technician's diagnosis surface. Signal picker left; charts
// right, one chart per engineering unit (never a second y-axis) with a
// shared crosshair; full-resolution stats table under them. Everything that
// defines the view lives in the URL so alarm → tag → trend pivots land on
// the same picture:  ?tags=a,b  &w=15m|1h|4h|8h  (&from=&to= epoch ms).
// Drag across a chart to zoom — the zoom becomes a from/to window.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, T, displayNumber, shortName, unitOf } from '../../lib/plant';
import { downloadCsv } from '../../lib/csv';
import { PageBar, Card } from '../../shared/ui/Page';
import { Icon } from '../../shared/ui/Icon';
import { Segmented } from '../../shared/ui/Segmented';
import { EmptyState, Notice } from '../../shared/ui/Feedback';
import { QualityMark } from '../../shared/ui/Status';
import { TimeChart } from './TimeChart';
import { useSeries, type TagSeries } from './useSeries';
import { MAX_SERIES, SERIES_PALETTE, fmtNum, fmtRange, useLimits, type Pt } from './viz';
import { WINDOWS, type WindowKey } from './links';

const DEFAULT_TAGS = [T.beltSpeed, T.beltTemp];
const PICKABLE = Object.keys(SIGNALS).filter((k) => k !== T.running);

const labelOf = (tag: string, t: (k: string) => string) => (SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : shortName(tag));
const decimalsOf = (tag: string) => SIGNALS[tag]?.decimals;

/** Scale stored engineering values for display (ratio → %), same as tiles. */
const scalePts = (tag: string, pts: Pt[]): Pt[] =>
  (displayNumber(tag, 1) === 1 ? pts : pts.map((p) => ({ t: p.t, v: displayNumber(tag, p.v) })));
const scaleV = (tag: string, v: number | null) => (v == null ? null : displayNumber(tag, v));

/** Colour follows the entity: a tag keeps its slot while selected, so
 *  removing one signal never repaints the survivors. */
function useSlots(sel: string[]): Map<string, number> {
  const slots = useRef(new Map<string, number>());
  const m = slots.current;
  for (const k of [...m.keys()]) if (!sel.includes(k)) m.delete(k);
  for (const tag of sel) {
    if (m.has(tag)) continue;
    const used = new Set(m.values());
    let s = 0;
    while (used.has(s)) s++;
    m.set(tag, s);
  }
  return m;
}

export function TrendsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tagRev = useStore(() => live.tagRev);
  const [fq, setFq] = useState('');
  const [mode, setMode] = useState<'explorer' | 'grid'>('explorer');

  const sel = useMemo(() => {
    const raw = params.get('tags');
    const list = raw == null ? DEFAULT_TAGS : raw.split(',').filter(Boolean);
    return [...new Set(list)].slice(0, MAX_SERIES);
  }, [params]);
  const wParam = params.get('w') ?? '';
  const w: WindowKey = wParam in WINDOWS ? (wParam as WindowKey) : '1h';
  const fromP = Number(params.get('from'));
  const toP = Number(params.get('to'));
  const fixed = Number.isFinite(fromP) && Number.isFinite(toP) && fromP > 0 && toP > fromP;
  const win = fixed ? { fromMs: fromP, toMs: toP, spanMs: toP - fromP } : { fromMs: 0, toMs: null, spanMs: WINDOWS[w] };

  const patch = (p: Record<string, string | null>) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v == null) n.delete(k); else n.set(k, v); }
    return n;
  }, { replace: true });

  const toggle = (tag: string) => {
    const next = sel.includes(tag) ? sel.filter((x) => x !== tag) : [...sel, tag].slice(-MAX_SERIES);
    patch({ tags: next.join(',') });
  };

  const slots = useSlots(sel);
  const colorOf = (tag: string) => SERIES_PALETTE[slots.get(tag) ?? 0];
  const limits = useLimits();
  const data = useSeries(sel, win);

  // picker rows: every known tag; plant-model signals first
  const rows = useMemo(() => {
    void tagRev;
    const names = live.tags.length ? live.tags.map((x) => x.name) : PICKABLE;
    const known = names.filter((n) => SIGNALS[n] && n !== T.running);
    const rest = names.filter((n) => !SIGNALS[n] || n === T.running).sort();
    return [...known, ...rest];
  }, [tagRev]);
  const unitFor = (tag: string) => unitOf(tag, live.tags.find((x) => x.name === tag)?.unit) ?? '';

  // one chart per unit — small multiples instead of a dual axis
  const groups = new Map<string, TagSeries[]>();
  for (const s of data.series) {
    const u = unitFor(s.tag);
    groups.set(u, [...(groups.get(u) ?? []), s]);
  }

  const badCount = data.series.reduce((a, s) => a + s.bad, 0);
  const onZoom = (a: number, b: number) => patch({ from: String(a), to: String(b) });

  const exportCsv = () => {
    const out: Record<string, unknown>[] = [];
    for (const s of data.series) {
      for (const p of s.pts) out.push({ ts: new Date(p.t).toISOString(), tag: s.tag, v: scaleV(s.tag, p.v), unit: unitFor(s.tag) });
    }
    downloadCsv(`trend-${new Date().toISOString().slice(0, 16)}.csv`,
      [{ key: 'ts', label: 'ts' }, { key: 'tag', label: 'tag' }, { key: 'v', label: 'value' }, { key: 'unit', label: 'unit' }], out);
  };

  return (
    <>
      <PageBar title={t('nav.trends')} lede={t('trends.lede')} actions={
        <Segmented
          value={mode}
          onChange={setMode}
          label={t('trends.mode')}
          options={[
            { value: 'explorer', label: t('trends.explorer') },
            { value: 'grid', label: t('trends.grid') },
          ]}
        />
      } />
      {mode === 'grid' ? (
        /* one card per plant signal, live 15 min */
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {PICKABLE.map((tag) => <GridCard key={tag} tag={tag} />)}
        </div>
      ) : (
      <div className="grid gap-3 p-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card title={t('viz.signalsPanel')} pad={false}>
          <div className="border-b border-line p-2">
            <div className="relative">
              <Icon name="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-35" />
              <input
                className="input h-7 w-full pl-6 text-[12px]"
                placeholder={t('trends.searchFacets')}
                aria-label={t('trends.searchFacets')}
                value={fq}
                onChange={(e) => setFq(e.target.value)}
              />
            </div>
          </div>
          <ul className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto p-2 lg:max-h-[60vh]" aria-label={t('trends.facets')}>
            {rows.filter((tag) => !fq || tag.toLowerCase().includes(fq.toLowerCase()) || labelOf(tag, t).toLowerCase().includes(fq.toLowerCase())).map((tag) => {
              const on = sel.includes(tag);
              return (
                <li key={tag}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-subtle has-[:focus-visible]:bg-subtle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(tag)}
                      disabled={!on && sel.length >= MAX_SERIES}
                      className="accent-blue"
                    />
                    <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: on ? colorOf(tag) : '#c8cdd5' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{labelOf(tag, t)}</span>
                      {!SIGNALS[tag] && <span className="block truncate font-mono text-[10px] text-ink-46">{tag}</span>}
                    </span>
                    <span className="text-[11px] text-ink-46">{unitFor(tag)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line p-2 text-[11px] text-ink-46"><Icon name="info" size={10} /> {t('viz.limitCount', { count: MAX_SERIES })} · {t('viz.perUnit')}</p>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {/* window bar — filters in one row above the charts */}
          <div className="flex flex-wrap items-center gap-2">
            {fixed ? (
              <>
                <span className="inline-flex h-7 items-center gap-1.5 rounded border border-line bg-white px-2 text-[12px]">
                  <Icon name="clock" size={12} /> {t('viz.custom')}: <span className="font-mono">{fmtRange(fromP, toP, i18n.language)}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => patch({ from: null, to: null })}>
                  {t('viz.backToLive')}
                </button>
              </>
            ) : (
              <>
                <Segmented
                  value={w}
                  onChange={(v) => patch({ w: v })}
                  label={t('viz.window')}
                  options={(Object.keys(WINDOWS) as WindowKey[]).map((k) => ({ value: k, label: k }))}
                />
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-68">
                  <span className="livedot" data-ws={live.ws === 'open' ? 'open' : 'reconnecting'} aria-hidden /> {t('viz.live')} · <span className="font-mono">{fmtRange(data.from, data.to, i18n.language)}</span>
                </span>
              </>
            )}
            <span className="flex-1" />
            <span className="hidden text-[11px] text-ink-46 md:inline">{t('viz.zoomHint')}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv} disabled={!data.hasData}>
              <Icon name="download" size={12} /> {t('viz.exportCsv')}
            </button>
          </div>

          {data.truncated && <Notice tone="warn">{t('viz.truncated')}</Notice>}
          {badCount > 0 && <Notice>{t('viz.badHidden', { count: badCount })}</Notice>}

          {sel.length === 0 ? (
            <Card><EmptyState title={t('trends.none')} icon="trends" /></Card>
          ) : [...groups.entries()].map(([unit, list]) => {
            const lim = list.length === 1 ? (limits.get(list[0].tag) ?? []).map((l) => ({ ...l, v: displayNumber(list[0].tag, l.v) })) : [];
            return (
              <Card
                key={unit || '—'}
                title={`${list.map((s) => labelOf(s.tag, t)).join(' · ')}${unit ? ` (${unit})` : ''}`}
                pad={false}
              >
                <div className="p-2">
                  <TimeChart
                    series={list.map((s) => ({
                      key: s.tag, label: labelOf(s.tag, t), color: colorOf(s.tag),
                      unit, decimals: decimalsOf(s.tag), pts: scalePts(s.tag, s.pts),
                    }))}
                    limits={lim}
                    unit={unit}
                    xRange={[data.from, data.to]}
                    height={groups.size > 1 ? 220 : 340}
                    syncKey="trends"
                    onZoom={onZoom}
                    loading={data.isLoading}
                    error={data.isError}
                    onRetry={data.refetch}
                  />
                </div>
              </Card>
            );
          })}

          {sel.length > 0 && !data.isLoading && (
            <Card title={t('viz.series')} pad={false}>
              <StatsTable series={data.series} colorOf={colorOf} unitFor={unitFor} />
            </Card>
          )}
        </div>
      </div>
      )}
    </>
  );
}

function StatsTable({ series, colorOf, unitFor }: {
  series: TagSeries[]; colorOf: (tag: string) => string; unitFor: (tag: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const f = (tag: string, v: number | null) => fmtNum(scaleV(tag, v), decimalsOf(tag), i18n.language);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left">
            {[t('viz.series'), t('viz.last'), t('viz.min'), t('viz.max'), t('viz.avg'), t('viz.unit'), t('viz.quality')].map((h, i) => (
              <th key={h} scope="col" className={`h-7 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68 ${i > 0 && i < 5 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const tv = live.latest.get(s.tag);
            const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
            return (
              <tr key={s.tag} className="h-9 border-b border-line last:border-0">
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: colorOf(s.tag) }} aria-hidden />
                    <span className="truncate">{labelOf(s.tag, t)}</span>
                  </span>
                </td>
                <td className="px-3 text-right font-mono font-semibold">{f(s.tag, s.stats.last)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.min)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.max)}</td>
                <td className="px-3 text-right font-mono">{f(s.tag, s.stats.avg)}</td>
                <td className="px-3 text-ink-68">{unitFor(s.tag) || '—'}</td>
                <td className="px-3">{stale || (tv && tv.q !== 'good') ? <QualityMark q={tv?.q} stale={stale} /> : <span className="text-[12px] text-ink-46">{t('state.good')}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GridCard({ tag }: { tag: string }) {
  const { t } = useTranslation();
  const limits = useLimits();
  const data = useSeries([tag], { fromMs: 0, toMs: null, spanMs: WINDOWS['15m'] });
  const unit = unitOf(tag) ?? '';
  return (
    <Card pad={false}>
      <div className="border-b border-line px-3 py-1.5">
        <p className="text-[13px] font-medium">{labelOf(tag, t)}</p>
        <p className="font-mono text-[10px] text-ink-46">{tag}{unit ? ` · ${unit}` : ''}</p>
      </div>
      <div className="p-1">
        <TimeChart
          series={[{ key: tag, label: labelOf(tag, t), color: SERIES_PALETTE[0], unit, decimals: decimalsOf(tag), pts: scalePts(tag, data.series[0]?.pts ?? []) }]}
          limits={(limits.get(tag) ?? []).map((l) => ({ ...l, v: displayNumber(tag, l.v) }))}
          unit={unit}
          xRange={[data.from, data.to]}
          height={160}
          loading={data.isLoading}
          error={data.isError}
          onRetry={data.refetch}
          compact
        />
      </div>
    </Card>
  );
}
