// Widget renderers. Data comes from the real API surface (history, latest)
// and the live alarm store; no widget fetches anything the backend lacks.

import { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sloStatus, STATUS_GLYPH, STATUS_TILE, STATUS_ORDER, type Status } from '../slo/slo';
import { incidentApi, sloApi, type IncidentRow } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Markdown from 'react-markdown';
import { EQUIPMENT, SIGNALS, displayNumber, equipmentOf } from '../../lib/plant';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge, fmtClock, fmtUptime } from '../../lib/format';
import { FLOOD_THRESHOLD, useAlarms } from '../alarms/alarms';
import { QualityMark, SeverityBadge, normSeverity } from '../../shared/ui/Status';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { TimeChart } from '../trends/TimeChart';
import { useSeries, RETENTION_MS } from '../trends/useSeries';
import { fmtNum, type Limit, type Pt } from '../trends/viz';
import {
  LEGACY_SERIES_COLORS, RANGE_MIN, SERIES_COLORS, alarmMatchesVars, resolveVarTag,
  type DashVar, type RangeKey, type Widget,
} from './model';
import type { Alarm, Quality, TagValue } from '../../types';

/* ---------- board-level context ----------------------------------------
 * Set by DashboardViewPage: paused window end (null = live), the "show
 * overlays" flag (alarm markers under timeseries), and the selected
 * template-variable values. Defaults keep the widget preview and any
 * detached render live and unfiltered. */
export interface BoardView {
  endMs: number | null;
  overlays: boolean;
  vars: Record<string, string>;
  varDefs: DashVar[];
}
export const BoardCtx = createContext<BoardView>({ endMs: null, overlays: false, vars: {}, varDefs: [] });

/** History window for data widgets — live tail by default, fixed window
 *  when the board is paused/rewound. */
function useBoardWindow(minutes: number): { fromMs: number; toMs: number | null; spanMs: number } {
  const { endMs } = useContext(BoardCtx);
  const span = Math.min(minutes * 60e3, RETENTION_MS);
  return useMemo(() => (
    endMs == null
      ? { fromMs: 0, toMs: null, spanMs: span }
      : { fromMs: endMs - span, toMs: endMs, spanMs: span }
  ), [endMs, span]);
}

/** Effective clock for staleness: paused boards judge against the window end. */
function useBoardNow(): number {
  const { endMs } = useContext(BoardCtx);
  const now = useNow();
  return endMs ?? now;
}

/** Widget tags after template-variable substitution. `miss` = the resolved
 *  tag does not exist on this plant — the widget shows an honest empty
 *  state instead of silently graphing the default tag. */
function useWidgetTags(w: Widget): { tags: string[]; miss: string | null } {
  const { vars } = useContext(BoardCtx);
  useStore(() => live.tagRev);
  return useMemo(() => {
    if (!w.varTag) return { tags: w.tags, miss: null };
    const resolved = resolveVarTag(w.varTag, vars);
    if (resolved == null) return { tags: w.tags, miss: null };
    const known = SIGNALS[resolved] || live.tags.some((x) => x.name === resolved);
    return { tags: [resolved], miss: known ? null : resolved };
  }, [w.varTag, w.tags, vars]);
}

/** Alarm sets narrowed by the board's template variables. */
function useVarAlarms() {
  const { varDefs, vars } = useContext(BoardCtx);
  const a = useAlarms();
  return useMemo(() => {
    const filtering = varDefs.some((d) => vars[d.name] && vars[d.name] !== '*');
    if (!filtering) return a;
    const all = a.all.filter((x) => alarmMatchesVars(x.tag, varDefs, vars));
    const open = all.filter((x) => x.state !== 'cleared');
    return {
      all, open,
      active: all.filter((x) => x.state === 'active'),
      critical: open.filter((x) => normSeverity(x.severity) === 'critical'),
    };
  }, [a, varDefs, vars]);
}

/** Group-by key for alarm widgets ('eq' = plant equipment via the tag map). */
function alarmGroupKey(w: Widget, a: Alarm): string {
  if (w.groupBy === 'rule') return a.rule;
  if (w.groupBy === 'severity') return normSeverity(a.severity);
  if (w.groupBy === 'eq') return equipmentOf(a.tag) ?? 'other';
  return short(a.tag);
}

function alarmGroupLabel(w: Widget, k: string, t: (k: string) => string): string {
  if (w.groupBy === 'severity') return t(`alarms.${k}`);
  if (w.groupBy === 'eq') return k === 'other' ? t('ddb.groupOther') : (EQUIPMENT.some((e) => e.id === k) ? t(`line.${k}`) : k);
  return k;
}

const short = (tag: string) => tag.split('.').slice(-2).join('.');
export const unitOfWidget = (w: Widget) => w.unit || SIGNALS[w.tags[0]]?.unit || '';
const num = (v: number | boolean) => (typeof v === 'number' ? v : v ? 1 : 0);
/** Signal unit -> its display scale (ratio -> %); a custom unit keeps the
 *  raw stored value so the unit the author typed stays true. */
const scaleFor = (w: Widget, tag: string) => (v: number) => (w.unit ? v : displayNumber(tag, v));

/** Render-time palette migration: a series still on a pre-ISA-101 default
 *  colour draws with the new default; colours the author picked stay. */
export function seriesColor(w: Widget, i: number): string {
  const c = (w.colors[i] ?? '').toLowerCase();
  if (!c || LEGACY_SERIES_COLORS.includes(c)) return SERIES_COLORS[i] ?? SERIES_COLORS[0];
  return w.colors[i];
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
  const { t } = useTranslation();
  const { tags, miss } = useWidgetTags(w);
  const vw = useMemo(() => (tags === w.tags ? w : { ...w, tags }), [w, tags]);
  const minutes = RANGE_MIN[vw.range === 'inherit' ? range : vw.range];
  if (miss) return <EmptyState title={t('ddb.varNoSignal')} body={miss} icon="search" compact />;
  switch (vw.kind) {
    case 'timeseries': return <TimeseriesBody w={vw} minutes={minutes} />;
    case 'value': return <ValueBody w={vw} minutes={minutes} />;
    case 'stat': return <StatBody w={vw} minutes={minutes} />;
    case 'gauge': return <GaugeBody w={vw} />;
    case 'bargauge': return <BarGaugeBody w={vw} />;
    case 'stateline': return <StateLineBody w={vw} minutes={minutes} />;
    case 'histogram': return <HistogramBody w={vw} minutes={minutes} />;
    case 'table': return <TableBody w={vw} />;
    case 'toplist': return <ToplistBody w={vw} />;
    case 'pie': return <PieBody w={vw} />;
    case 'alarms': return <AlarmsBody />;
    case 'change': return <ChangeBody w={vw} minutes={minutes} />;
    case 'slo': return <SloBody />;
    case 'monitors': return <MonitorsBody />;
    case 'treemap': return <TreemapBody w={vw} />;
    case 'incidents': return <IncidentsBody />;
    case 'alarmkpi': return <AlarmKpiBody />;
    case 'group': return null; // header bar only — drawn by the board
    // react-markdown drops raw HTML, so a shared note can't inject markup
    case 'note': return <div className="h-full overflow-auto text-[13px] leading-5 text-ink [&_a]:text-blue [&_code]:font-mono [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:text-[14px] [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:bg-subtle [&_pre]:p-2"><Markdown>{w.note}</Markdown></div>;
  }
}

/** display range for gauge/bargauge — author yMin/yMax, else the signal's
 *  declared range, else 0..100. Values are in the widget's display unit. */
export function rangeOf(w: Widget, tag: string): [number, number] {
  const sig = SIGNALS[tag]?.range;
  const lo = w.yMin ?? sig?.[0] ?? 0;
  const hi = w.yMax ?? sig?.[1] ?? lo + 100;
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Non-hook "latest" lookup: live store when running live, else the last
 *  buffered sample at or before the paused window end. */
function latestAt(tag: string, endMs: number | null): TagValue | undefined {
  if (endMs == null) return live.latest.get(tag);
  const buf = live.buffers.get(tag) ?? [];
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= endMs) return { v: buf[i].v, q: 'good' as Quality, ts: new Date(buf[i].t).toISOString() };
  }
  return undefined;
}

/** latest displayed value for a tag: live first, then history tail */
function useLatest(w: Widget, tag: string | undefined) {
  const win = useBoardWindow(15);
  const { endMs } = useContext(BoardCtx);
  const hist = useSeries(tag ? [tag] : [], { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  useStore(() => live.version);
  const tv = tag ? latestAt(tag, endMs) : undefined;
  const raw = tv ? num(tv.v) : hist.series[0]?.stats.last ?? null;
  return { tv, hist, raw, v: raw == null || !tag ? null : scaleFor(w, tag)(raw) };
}

const LVL_COLOR: Record<Level, string> = {
  ok: 'var(--color-blue)', warn: 'var(--color-caution)', crit: 'var(--color-danger)',
};

const LEVEL_STYLE: Record<Level, string> = {
  crit: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] ring-1 ring-inset ring-[var(--color-danger)]/40',
  warn: 'bg-[var(--color-caution-soft)] text-[var(--color-caution)] ring-1 ring-inset ring-[var(--color-caution)]/40',
  ok: '',
};

const FILL_STYLE: Record<Level, string> = {
  ok: 'bg-[var(--color-ok)] text-white',
  warn: 'bg-sev-medium text-sev-ink',
  crit: 'bg-[var(--color-danger-bright)] text-white',
};

function ValueBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t, i18n } = useTranslation();
  const now = useBoardNow();
  const { endMs } = useContext(BoardCtx);
  useStore(() => live.version);
  const tag = w.tags[0];
  const win = useBoardWindow(w.agg === 'last' ? 15 : minutes);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  const tv = latestAt(tag, endMs);
  const st = hist.series[0]?.stats;
  const raw = w.agg === 'last'
    ? (tv ? num(tv.v) : st?.last ?? null)
    : st ? st[w.agg] : null;
  if (raw == null && hist.isLoading) return <Skeleton h={40} />;
  if (raw == null && hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const v = raw == null ? null : scaleFor(w, tag)(raw);
  const lvl = levelOf(v, w);
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  const unit = unitOfWidget(w);
  if (w.fill) {
    // solid tile: the threshold colour is the background (dd conditional format)
    return (
      <div className={`flex h-full flex-col items-center justify-center rounded text-center ${FILL_STYLE[lvl]}`}>
        <span className={`font-mono text-[clamp(32px,5vw,60px)] font-bold leading-none tabular-nums ${stale ? 'opacity-60' : ''}`}>{fmtNum(v, w.decimals, i18n.language)}</span>
        <span className="mt-1 text-[clamp(13px,1.6vw,20px)]">{unit}</span>
        {(lvl !== 'ok' || stale) && (
          <span className="mt-1 text-[11px] font-semibold">{stale ? t('viz.staleFor', { age: tv ? fmtAge(tv.ts, now) : '—' }) : lvl === 'crit' ? `▲ ${t('alarms.critical')}` : `◆ ${t('alarms.warning')}`}</span>
        )}
      </div>
    );
  }
  return (
    <div className={`flex h-full flex-col justify-center rounded px-2 ${LEVEL_STYLE[lvl]}`}>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-[34px] font-semibold leading-none ${stale ? 'text-ink-46' : ''}`}>{fmtNum(v, w.decimals, i18n.language)}</span>
        <span className="text-[13px] opacity-70">{unit}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] opacity-90">
        <span>{t(`dash.agg.${w.agg}`)} · {SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : short(tag)}</span>
        {lvl !== 'ok' && <span className="font-semibold">{lvl === 'crit' ? `▲ ${t('alarms.critical')}` : `◆ ${t('alarms.warning')}`}</span>}
        <QualityMark q={tv?.q} stale={stale} />
        {stale && tv && <span className="text-ink-46">{t('viz.staleFor', { age: fmtAge(tv.ts, now) })}</span>}
      </div>
    </div>
  );
}

/** Linear least-squares projection for `w.forecast` — the same estimator the
 *  backend 'forecast' rule evaluator uses (seconds-since-window-start → value),
 *  extended 25 % past the window end. Honest estimate styling: thin neutral
 *  line labelled "estimate", no invented confidence band. */
function forecastPts(pts: Pt[], from: number, to: number): Pt[] {
  if (pts.length < 3) return [];
  const n = pts.length;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const p of pts) {
    const x = (p.t - from) / 1e3;
    sx += x; sy += p.v; sxx += x * x; sxy += x * p.v;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return [];
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const out: Pt[] = [];
  const STEPS = 16;
  for (let i = 1; i <= STEPS; i++) {
    const t = to + ((to - from) * 0.25 * i) / STEPS;
    out.push({ t, v: a + b * ((t - from) / 1e3) });
  }
  return out;
}

const FORECAST_COLOR = '#828ba4'; // muted neutral — estimates never take a state colour
const SEV_BAR: Record<string, string> = {
  critical: 'bg-[var(--color-danger)]', warning: 'bg-[var(--color-caution)]',
  info: 'bg-[var(--color-blue)]', ok: 'bg-line',
};

/** Thin alarm-event strip under a timeseries — dd-style overlay marking when
 *  alarms on the graphed tags fired inside the visible window. */
function OverlayStrip({ from, to, tags }: { from: number; to: number; tags: string[] }) {
  const { t } = useTranslation();
  const { varDefs, vars } = useContext(BoardCtx);
  const { all } = useAlarms();
  const marks = useMemo(() => {
    const sel = new Set(tags);
    return all
      .filter((a) => (!sel.size || sel.has(a.tag)) && alarmMatchesVars(a.tag, varDefs, vars))
      .flatMap((a) => {
        const at = Date.parse(a.ts);
        return Number.isFinite(at) && at >= from && at <= to ? [{ t: at, sev: normSeverity(a.severity), rule: a.rule }] : [];
      })
      .sort((x, y) => x.t - y.t).slice(0, 60);
  }, [all, tags, varDefs, vars, from, to]);
  if (!from || !to || to <= from) return null;
  const span = to - from;
  return (
    <div className="relative mt-0.5 h-2 shrink-0 rounded bg-subtle/50" role="img" aria-label={t('ddb.overlayLabel')}>
      {marks.map((m, i) => (
        <span key={i} title={`${fmtClock(new Date(m.t).toISOString())} · ${m.rule}`}
          className={`absolute top-0 h-full w-[3px] rounded-full ${SEV_BAR[m.sev] ?? 'bg-[var(--color-blue)]'}`}
          style={{ left: `calc(${((m.t - from) / span) * 100}% - 1px)` }} />
      ))}
      {!marks.length && <span className="absolute inset-0 grid place-items-center text-[8px] leading-none text-ink-46">{t('ddb.noOverlays')}</span>}
    </div>
  );
}

function TimeseriesBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t } = useTranslation();
  const { overlays } = useContext(BoardCtx);
  const win = useBoardWindow(minutes);
  const data = useSeries(w.tags, { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  const unit = unitOfWidget(w);
  const limits = useMemo(() => {
    const l: Limit[] = [];
    if (w.warn != null) l.push({ v: w.warn, kind: 'warn', severity: 'warning' });
    if (w.crit != null) l.push({ v: w.crit, kind: 'crit', severity: 'critical' });
    return l;
  }, [w.warn, w.crit]);
  const series = useMemo(() => {
    const base = data.series.map((s, i) => ({
      key: s.tag,
      label: SIGNALS[s.tag] ? t(SIGNALS[s.tag].labelKey) : short(s.tag),
      color: seriesColor(w, i),
      unit,
      decimals: w.decimals,
      width: w.lineWidth,
      pts: w.unit ? s.pts : s.pts.map((p) => ({ t: p.t, v: displayNumber(s.tag, p.v) })),
    }));
    if (!w.forecast) return base;
    return [...base, ...base.map((s) => ({
      ...s, key: `${s.key}#fc`, label: `${s.label} · ${t('ddb.estimate')}`,
      color: FORECAST_COLOR, width: 1, pts: forecastPts(s.pts, data.from, data.to),
    }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow the active language
  }, [data.series, data.from, data.to, w, unit, t]);
  if (!w.tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  const horizon = w.forecast ? (data.to - data.from) * 0.25 : 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TimeChart
        fill
        compact
        series={series}
        limits={limits}
        unit={unit}
        yMin={w.yMin}
        yMax={w.yMax}
        legend={w.legend}
        xRange={[data.from, data.to + horizon]}
        loading={data.isLoading}
        error={data.isError}
        onRetry={data.refetch}
      />
      {overlays && <OverlayStrip from={data.from} to={data.to} tags={w.tags} />}
      {(minutes * 60e3 > RETENTION_MS || data.truncated || w.forecast) && (
        <p className="shrink-0 px-1 text-[10px] text-ink-46">
          {[
            minutes * 60e3 > RETENTION_MS || data.truncated ? t(data.truncated ? 'viz.truncated' : 'viz.retention') : null,
            w.forecast ? t('ddb.forecastNote') : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

function ToplistBody({ w }: { w: Widget }) {
  const { t } = useTranslation();
  const { open } = useVarAlarms();
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of open) m.set(alarmGroupKey(w, a), (m.get(alarmGroupKey(w, a)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [open, w]);
  if (!rows.length) return <EmptyState title={t('alarms.emptyActive')} />;
  const max = rows[0][1];
  return (
    <ol className="space-y-1.5 overflow-auto">
      {rows.map(([k, n]) => (
        <li key={k} className="text-[12px]">
          <div className="flex justify-between gap-2"><span className="truncate">{alarmGroupLabel(w, k, t)}</span><span className="font-mono">{n}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-[var(--color-blue)]" style={{ width: `${(n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

function AlarmsBody() {
  const { t } = useTranslation();
  const { open } = useVarAlarms();
  const now = useNow();
  if (!open.length) return <EmptyState title={t('alarms.emptyActive')} body={t('alarms.emptyActiveBody')} />;
  return (
    <ul className="h-full overflow-auto">
      {open.slice(0, 20).map((a) => (
        <li key={a.id} className="border-b border-line last:border-0">
          <Link to={`/alarms/${a.id}`} className="flex min-h-8 items-center gap-2 py-1.5 text-[12px] hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none">
            <SeverityBadge severity={a.severity} />
            <span className="min-w-0 flex-1 truncate">{a.rule}</span>
            <span className="shrink-0 text-ink-46">{fmtAge(a.ts, now)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- change — first→last delta over the range -------------------- */
function ChangeBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t, i18n } = useTranslation();
  const tag = w.tags[0];
  const win = useBoardWindow(minutes);
  const hist = useSeries(tag ? [tag] : [], { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (hist.isLoading) return <Skeleton h={40} />;
  if (hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const pts = hist.series[0]?.pts ?? [];
  if (pts.length < 2) return <EmptyState title={t('dash.noChange')} />;
  const f = scaleFor(w, tag);
  const a = f(pts[0].v); const b = f(pts[pts.length - 1].v);
  const d = b - a;
  const pct = a === 0 ? null : (d / Math.abs(a)) * 100;
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="font-mono text-[28px] leading-none">{d > 0 ? '▲' : d < 0 ? '▼' : '■'} {fmtNum(Math.abs(d), w.decimals, i18n.language)} <span className="text-[13px] text-ink-46">{unitOfWidget(w)}</span></div>
      <div className="mt-1 text-[11px] text-ink-46">{pct == null ? '' : `${fmtNum(pct, 1, i18n.language)} % · `}{t('viz.pastMin', { m: minutes })}</div>
    </div>
  );
}

/* ---------- slo — status counts over the 30-day availability window ------ */
function SloBody() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const defs = useQuery({ queryKey: ['slos', orgId], queryFn: () => sloApi.list(orgId!), enabled: !!orgId, staleTime: 60_000 });
  const n0 = defs.data?.items.length ?? 0;
  const stat = useQuery({ queryKey: ['slo-status', orgId, '30d', n0], queryFn: () => sloApi.status(orgId!, 30), enabled: !!orgId && n0 > 0, staleTime: 60_000 });
  if (defs.isLoading || stat.isLoading) return <Skeleton h={40} />;
  const n = { breached: 0, warning: 0, ok: 0, nodata: 0 };
  const sliOf = new Map((stat.data?.items ?? []).map((x) => [x.id, x.sli]));
  (defs.data?.items ?? []).forEach((s) => { n[sloStatus(sliOf.get(s.id) ?? null, s.target, s.warning)]++; });
  return <Counts link="/slos" items={STATUS_ORDER.map((s: Status) => ({
    label: t(`slos.status.${s}`), glyph: STATUS_GLYPH[s], count: n[s], cls: STATUS_TILE[s].split(' ')[1],
  }))} />;
}

/* ---------- monitors — signal feed health: alarming / stale / ok --------- */
function MonitorsBody() {
  const { t } = useTranslation();
  const { open } = useVarAlarms();
  const now = useBoardNow();
  useStore(() => live.version);
  const alarming = new Set(open.map((a) => a.tag));
  let a = 0; let s = 0; let ok = 0;
  for (const tag of Object.keys(SIGNALS)) {
    const tv = live.latest.get(tag);
    if (alarming.has(tag)) a++;
    else if (!tv || now - Date.parse(tv.ts) > STALE_MS) s++;
    else ok++;
  }
  return <Counts items={[
    { label: t('dash.mon.alarm'), glyph: '▲', count: a },
    { label: t('dash.mon.stale'), glyph: '○', count: s },
    { label: t('dash.mon.ok'), glyph: '●', count: ok },
  ]} link="/alarms" />;
}

function Counts({ items, link }: { items: { label: string; glyph: string; count: number; cls?: string }[]; link: string }) {
  return (
    <Link to={link} className="flex h-full items-center justify-around gap-2 focus-visible:outline-2 focus-visible:outline-blue">
      {items.map((i) => (
        <div key={i.label} className="text-center">
          <div className={`font-mono text-[24px] leading-none ${i.cls ?? ''}`}>{i.count}</div>
          <div className="mt-1 text-[11px] text-ink-46"><span aria-hidden>{i.glyph}</span> {i.label}</div>
        </div>
      ))}
    </Link>
  );
}

/* ---------- gauge — semicircle dial w/ threshold bands (Grafana gauge) ---- */
function GaugeBody({ w }: { w: Widget }) {
  const { t, i18n } = useTranslation();
  const now = useBoardNow();
  const tag = w.tags[0];
  const { tv, hist, v } = useLatest(w, tag);
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (v == null && hist.isLoading) return <Skeleton h={40} />;
  if (v == null && hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const [lo, hi] = rangeOf(w, tag);
  const frac = v == null ? 0 : clamp01((v - lo) / (hi - lo));
  const lvl = levelOf(v, w);
  const pt = (f: number, r: number) => {
    const a = Math.PI * (1 - f);
    return `${80 - r * Math.cos(a)} ${74 - r * Math.sin(a)}`;
  };
  const arc = (f0: number, f1: number, r: number) => `M ${pt(f0, r)} A ${r} ${r} 0 0 1 ${pt(f1, r)}`;
  const wf = w.warn == null ? null : clamp01((w.warn - lo) / (hi - lo));
  const cf = w.crit == null ? null : clamp01((w.crit - lo) / (hi - lo));
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg viewBox="0 0 160 88" className="w-full max-w-[230px]">
        <path d={arc(0, 1, 62)} fill="none" stroke="var(--color-line)" strokeWidth="9" strokeLinecap="round" />
        {wf != null && <path d={arc(wf, cf ?? 1, 62)} fill="none" stroke="var(--color-caution)" strokeWidth="9" opacity=".4" />}
        {cf != null && <path d={arc(cf, 1, 62)} fill="none" stroke="var(--color-danger)" strokeWidth="9" opacity=".55" />}
        {frac > 0.004 && <path d={arc(0, frac, 62)} fill="none" stroke={LVL_COLOR[lvl]} strokeWidth="9" strokeLinecap="round" />}
        <text x="80" y="64" textAnchor="middle" fontSize="25" fontWeight="600" fill="currentColor"
          fontFamily="IBM Plex Mono, monospace">{fmtNum(v, w.decimals, i18n.language)}</text>
        <text x="80" y="81" textAnchor="middle" fontSize="9.5" fill="currentColor" opacity=".6">{unitOfWidget(w)}</text>
        <text x="14" y="86" fontSize="8" fill="currentColor" opacity=".5" fontFamily="IBM Plex Mono, monospace">{fmtNum(lo, 0, 'en')}</text>
        <text x="146" y="86" textAnchor="end" fontSize="8" fill="currentColor" opacity=".5" fontFamily="IBM Plex Mono, monospace">{fmtNum(hi, 0, 'en')}</text>
      </svg>
      <div className="flex items-center gap-2 text-[11px] opacity-80">
        <QualityMark q={tv?.q} stale={stale} />
        {stale && tv && <span className="text-ink-46">{t('viz.staleFor', { age: fmtAge(tv.ts, now) })}</span>}
      </div>
    </div>
  );
}

/* ---------- bar gauge — retro LCD bars, one per tag (Grafana bar gauge) --- */
function BarGaugeBody({ w }: { w: Widget }) {
  const { t, i18n } = useTranslation();
  useStore(() => live.version);
  const now = useBoardNow();
  const { endMs } = useContext(BoardCtx);
  const tags = w.tags.slice(0, SERIES_COLORS.length);
  if (!tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 overflow-auto">
      {tags.map((tag) => {
        const tv = latestAt(tag, endMs);
        const v = tv ? scaleFor(w, tag)(num(tv.v)) : null;
        const [lo, hi] = rangeOf(w, tag);
        const frac = v == null ? 0 : clamp01((v - lo) / (hi - lo));
        const lvl = levelOf(v, w);
        const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
        const tick = (x: number | null) => x == null ? null : `${clamp01((x - lo) / (hi - lo)) * 100}%`;
        return (
          <div key={tag} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`truncate ${stale ? 'text-ink-46' : ''}`}>{SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : short(tag)}</span>
              <span className={`shrink-0 font-mono ${stale ? 'text-ink-46' : ''}`}>{fmtNum(v, w.decimals, i18n.language)} {unitOfWidget(w) || SIGNALS[tag]?.unit || ''}</span>
            </div>
            <div className="relative mt-1 h-2.5 overflow-visible rounded-sm bg-subtle">
              <div className="h-full rounded-sm" style={{ width: `${frac * 100}%`, background: LVL_COLOR[lvl] }} />
              {[w.warn, w.crit].map((x, i) => tick(x) && (
                <span key={i} className="absolute -top-0.5 bottom-0 w-px bg-ink-46" style={{ left: tick(x)! }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- stat — big number + sparkline context (Grafana stat) ---------- */
function StatBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t, i18n } = useTranslation();
  const now = useBoardNow();
  const { endMs } = useContext(BoardCtx);
  useStore(() => live.version);
  const tag = w.tags[0];
  const win = useBoardWindow(w.agg === 'last' ? 15 : minutes);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  const tv = latestAt(tag, endMs);
  const st = hist.series[0]?.stats;
  const raw = w.agg === 'last' ? (tv ? num(tv.v) : st?.last ?? null) : st ? st[w.agg] : null;
  if (raw == null && hist.isLoading) return <Skeleton h={40} />;
  if (raw == null && hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const v = raw == null ? null : scaleFor(w, tag)(raw);
  const lvl = levelOf(v, w);
  const pts = hist.series[0]?.pts ?? [];
  const vals = pts.map((p) => (w.unit ? p.v : displayNumber(tag, p.v)));
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
  const spark = vals.length > 1
    ? vals.map((x, i) => `${(i / (vals.length - 1)) * 100},${26 - ((x - lo) / (hi - lo)) * 24}`).join(' ')
    : '';
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  return (
    <div className={`relative flex h-full flex-col justify-center overflow-hidden rounded px-2 ${LEVEL_STYLE[lvl]}`}>
      {spark && (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-25" aria-hidden>
          <polyline points={spark} fill="none" stroke={LVL_COLOR[lvl]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="relative flex items-baseline gap-1.5">
        <span className={`font-mono text-[34px] font-semibold leading-none ${stale ? 'text-ink-46' : ''}`}>{fmtNum(v, w.decimals, i18n.language)}</span>
        <span className="text-[13px] opacity-70">{unitOfWidget(w)}</span>
      </div>
      <div className="relative mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] opacity-90">
        <span>{t(`dash.agg.${w.agg}`)} · {SIGNALS[tag] ? t(SIGNALS[tag].labelKey) : short(tag)}</span>
        {lvl !== 'ok' && <span className="font-semibold">{lvl === 'crit' ? `▲ ${t('alarms.critical')}` : `◆ ${t('alarms.warning')}`}</span>}
        <QualityMark q={tv?.q} stale={stale} />
      </div>
    </div>
  );
}

function StateLineBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t } = useTranslation();
  const tag = w.tags[0];
  const win = useBoardWindow(minutes);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (hist.isLoading && !hist.series.length) return <Skeleton h={40} />;
  if (hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const pts = hist.series[0]?.pts ?? [];
  if (!pts.length) return <EmptyState title={t('viz.noData')} />;
  const CELLS = 56;
  const cells: (Level | null)[] = Array(CELLS).fill(null);
  for (const p of pts) {
    const i = Math.min(CELLS - 1, Math.max(0, Math.floor(((p.t - hist.from) / Math.max(1, hist.to - hist.from)) * CELLS)));
    cells[i] = levelOf(w.unit ? p.v : displayNumber(tag, p.v), w);
  }
  const last = cells.reduce<Level | null>((acc, c) => c ?? acc, null);
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex h-7 gap-px" role="img" aria-label={w.title || t('dash.kind.stateline')}>
        {cells.map((c, i) => (
          <span key={i} className="flex-1 rounded-[1px]" style={{ background: c ? LVL_COLOR[c] : 'var(--color-line)', opacity: c ? 1 : .35 }} />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-ink-46">
        <span>{t('viz.pastMin', { m: minutes })}</span>
        <span className="font-semibold" style={{ color: last ? LVL_COLOR[last] : undefined }}>
          {last === 'crit' ? `▲ ${t('alarms.critical')}` : last === 'warn' ? `◆ ${t('alarms.warning')}` : t('slos.status.ok')}
        </span>
      </div>
    </div>
  );
}

/* ---------- histogram — value distribution over the window (Grafana hist) - */
function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const PCTS: [string, number][] = [['p50', 0.5], ['p75', 0.75], ['p90', 0.9], ['p95', 0.95], ['p99', 0.99]];

/** Distribution of the signal over the window with dashed percentile markers
 *  and a stats column (dd "time saved distribution"). The column hides on
 *  narrow tiles so a 4-wide widget stays a plain histogram. */
function HistogramBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t, i18n } = useTranslation();
  const tag = w.tags[0];
  const win = useBoardWindow(minutes);
  const hist = useSeries(tag ? [tag] : [], { fromMs: win.fromMs, toMs: win.toMs, spanMs: win.spanMs });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  if (hist.isLoading && !hist.series.length) return <Skeleton h={40} />;
  if (hist.isError) return <ErrorState onRetry={hist.refetch} />;
  const vals = (hist.series[0]?.pts ?? []).map((p) => (w.unit ? p.v : displayNumber(tag, p.v)));
  if (!vals.length) return <EmptyState title={t('viz.noData')} />;
  // author range wins; otherwise fit the data so a signal that lives in a narrow
  // band of its full scale still fills the plot
  const dMin = Math.min(...vals), dMax = Math.max(...vals);
  const pad = (dMax - dMin || Math.abs(dMax) || 1) * 0.05;
  const [lo, hi] = w.yMin != null || w.yMax != null ? rangeOf(w, tag) : [dMin - pad, dMax + pad];
  const wide = w.w >= 5;
  const BINS = wide ? 24 : 12;
  const bins = Array(BINS).fill(0) as number[];
  for (const x of vals) bins[Math.min(BINS - 1, Math.max(0, Math.floor(((x - lo) / (hi - lo)) * BINS)))]++;
  const max = Math.max(...bins, 1);
  const sorted = [...vals].sort((a, b) => a - b);
  const stats = [...PCTS.map(([k, q]) => [k, quantile(sorted, q)] as const), ['max', sorted[sorted.length - 1]] as const].reverse();
  const at = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
  const fmt = (x: number) => fmtNum(x, w.decimals, i18n.language);
  return (
    <div className="flex h-full gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 items-end gap-px border-b border-line">
          {wide && PCTS.filter(([k]) => k !== 'p99' && k !== 'p95').map(([k, q]) => (
            <span key={k} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-35" style={{ left: at(quantile(sorted, q)) }}>
              <span className="absolute -top-0.5 left-1 text-[10px] text-ink-46">{k}</span>
            </span>
          ))}
          {bins.map((n, i) => (
            <div key={i} className="flex-1 bg-[var(--color-blue)] opacity-90"
              style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }}
              title={`${fmt(lo + (i / BINS) * (hi - lo))}–${fmt(lo + ((i + 1) / BINS) * (hi - lo))}: ${n}`} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-46">
          <span className="font-mono">{fmtNum(lo, w.decimals, 'en')}</span>
          <span>{unitOfWidget(w)}</span>
          <span className="font-mono">{fmtNum(hi, w.decimals, 'en')}</span>
        </div>
      </div>
      {wide && (
        <dl className="w-40 shrink-0 self-stretch overflow-auto border-l border-line pl-3 text-[12px]">
          <dt className="mb-1 text-ink-68">{t('dash.samples', { count: vals.length })}</dt>
          {stats.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 py-0.5">
              <dt className="text-ink-68">{k}</dt>
              <dd className="font-mono tabular-nums">{fmt(v)} <span className="text-[11px] text-ink-46">{unitOfWidget(w)}</span></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ---------- treemap — alarm volume by group, area = count (dd treemap) ------ */
interface Cell { k: string; n: number; x: number; y: number; w: number; h: number }
/** Squarified treemap (Bruls et al.) over a 100×100 box. */
function squarify(items: [string, number][]): Cell[] {
  const total = items.reduce((s, [, n]) => s + n, 0);
  const out: Cell[] = [];
  let box = { x: 0, y: 0, w: 100, h: 100 };
  let rest = items.map(([k, n]) => ({ k, n, a: (n / total) * 100 * 100 }));
  const worst = (row: typeof rest, side: number) => {
    const s = row.reduce((t, r) => t + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(box.w, box.h);
    let row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row = [...row, rest[i++]];
    const s = row.reduce((t, r) => t + r.a, 0);
    const horiz = box.w >= box.h; // lay the row along the short side
    const thick = s / side;
    let off = 0;
    for (const r of row) {
      const len = r.a / thick;
      out.push(horiz ? { k: r.k, n: r.n, x: box.x, y: box.y + off, w: thick, h: len } : { k: r.k, n: r.n, x: box.x + off, y: box.y, w: len, h: thick });
      off += len;
    }
    box = horiz ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    rest = rest.slice(row.length);
  }
  return out;
}
const TREEMAP_FILLS = ['#00bdfd', '#d68cd9', '#fcd23a', '#2fc9a3', '#f2707e', '#17d0e8', '#a490ee'];

function TreemapBody({ w }: { w: Widget }) {
  const { t } = useTranslation();
  const { all } = useVarAlarms();
  const items = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all) m.set(alarmGroupKey(w, a), (m.get(alarmGroupKey(w, a)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [all, w]);
  if (!items.length) return <EmptyState title={t('alarms.empty')} />;
  const total = items.reduce((s, [, n]) => s + n, 0);
  const cells = squarify(items);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex justify-between text-[12px]"><span className="font-semibold">{t('dash.total')}</span><span className="font-mono">{total}</span></div>
      <div className="relative min-h-0 flex-1">
        {cells.map((c, i) => (
          <div
            key={c.k} title={`${c.k}: ${c.n}`}
            className="absolute overflow-hidden p-1 text-center text-[11px] leading-tight text-[#0b1b2b]"
            style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`, background: TREEMAP_FILLS[i % TREEMAP_FILLS.length], outline: '1px solid #fff', outlineOffset: -1 }}
          >
            <span className="block truncate">{alarmGroupLabel(w, c.k, t)}</span>
            <span className="block font-mono font-semibold">{c.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- table — latest values of many tags (Grafana table) ------------ */
function TableBody({ w }: { w: Widget }) {
  const { t, i18n } = useTranslation();
  useStore(() => live.version);
  const now = useBoardNow();
  const { endMs } = useContext(BoardCtx);
  const tags = w.tags.slice(0, 10);
  if (!tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-line text-left text-ink-46">
            <th className="py-1 pr-2 font-medium">{t('dash.colSignal')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('dash.colValue')}</th>
            <th className="w-16 py-1 font-medium">{t('dash.colAge')}</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => {
            const tv = latestAt(tag, endMs);
            const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
            return (
              <tr key={tag} className="border-b border-line/60 last:border-0">
                <td className="max-w-0 truncate py-1.5 pr-2 font-mono">{short(tag)}</td>
                <td className={`py-1.5 pr-2 text-right font-mono ${stale ? 'text-ink-46' : ''}`}>
                  {tv ? `${fmtNum(scaleFor(w, tag)(num(tv.v)), w.decimals, i18n.language)} ${unitOfWidget(w) || SIGNALS[tag]?.unit || ''}` : '—'}
                </td>
                <td className="py-1.5">{tv ? <span className="text-ink-46">{fmtAge(tv.ts, now)}</span> : <QualityMark q={undefined} stale />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- donut — alarm share by group (Grafana pie chart) --------------- */
function PieBody({ w }: { w: Widget }) {
  const { t } = useTranslation();
  const { open } = useVarAlarms();
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of open) m.set(alarmGroupKey(w, a), (m.get(alarmGroupKey(w, a)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [open, w]);
  if (!rows.length) return <EmptyState title={t('alarms.emptyActive')} />;
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const R = 30, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex h-full items-center gap-4 overflow-auto">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          {rows.map(([k, n], i) => {
            const frac = n / total;
            const el = (
              <circle key={k} cx="50" cy="50" r={R} fill="none" strokeWidth="16"
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeDasharray={`${frac * C} ${C - frac * C}`} strokeDashoffset={-acc * C} />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <span className="absolute inset-0 grid place-items-center font-mono text-[16px] font-bold">{total}</span>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-[12px]">
        {rows.slice(0, 6).map(([k, n], i) => (
          <li key={k} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{alarmGroupLabel(w, k, t)}</span>
            <span className="font-mono text-ink-46">{Math.round((n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- incidents — KPI tiles + weekly rate strip (dd incidents) ------ */
function IncidentsBody() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const now = useNow();
  const q = useQuery({
    queryKey: ['incidents', orgId],
    queryFn: () => incidentApi.list(orgId!),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
  if (q.isLoading) return <Skeleton h={40} />;
  if (q.isError) return <ErrorState onRetry={q.refetch} />;
  const inc: IncidentRow[] = q.data?.incidents ?? [];
  if (!inc.length) return <EmptyState title={t('ddb.noIncidents')} icon="check" />;
  const open = inc.filter((i) => i.status !== 'resolved');
  const meanMs = (rows: IncidentRow[], f: (i: IncidentRow) => string | null, g: (i: IncidentRow) => string) => {
    const ms = rows.map((i) => { const a = f(i); return a ? Date.parse(a) - Date.parse(g(i)) : NaN; }).filter(Number.isFinite);
    return ms.length ? ms.reduce((x, y) => x + y, 0) / ms.length : null;
  };
  const mtta = meanMs(inc, (i) => i.acked_at, (i) => i.created_at);
  const mttr = meanMs(inc, (i) => i.resolved_at, (i) => i.created_at);
  const week = inc.filter((i) => now - Date.parse(i.created_at) < 7 * 86400e3).length;
  const tiles: { label: string; v: string; hot?: boolean }[] = [
    { label: t('ddb.incOpen'), v: String(open.length), hot: open.length > 0 },
    { label: t('alarms.critical'), v: String(open.filter((i) => i.severity === 'critical').length), hot: open.some((i) => i.severity === 'critical') },
    { label: 'MTTA', v: mtta == null ? '—' : fmtUptime(mtta / 1000) },
    { label: 'MTTR', v: mttr == null ? '—' : fmtUptime(mttr / 1000) },
    { label: t('ddb.incWeek'), v: String(week) },
  ];
  // 8 weekly buckets of declared incidents, oldest → newest
  const WEEKS = 8;
  const buckets = new Array<number>(WEEKS).fill(0);
  for (const i of inc) {
    const w = Math.floor((now - Date.parse(i.created_at)) / (7 * 86400e3));
    if (w >= 0 && w < WEEKS) buckets[WEEKS - 1 - w]++;
  }
  const bMax = Math.max(...buckets, 1);
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-3 content-center gap-2 min-[480px]:grid-cols-5">
        {tiles.map((x) => (
          <Link key={x.label} to="/incidents" className="block text-center focus-visible:outline-2 focus-visible:outline-blue">
            <div className={`font-mono text-[20px] font-semibold leading-none tabular-nums ${x.hot ? 'text-[var(--color-danger)]' : ''}`}>{x.v}</div>
            <div className="mt-1 text-[10px] text-ink-46">{x.label}</div>
          </Link>
        ))}
      </div>
      <div className="mt-2 shrink-0">
        <div className="flex h-9 items-end gap-1" role="img" aria-label={t('ddb.incWeekly')}>
          {buckets.map((n, i) => (
            <span key={i} className={`flex-1 rounded-t-[2px] ${open.length ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-ok)]'}`}
              style={{ height: `${(n / bMax) * 100}%`, minHeight: n ? 2 : 0, opacity: n ? 0.85 : 0.15 }} title={`${n}`} />
          ))}
        </div>
        <p className="mt-0.5 text-[10px] text-ink-46">{t('ddb.incWeekly')}</p>
      </div>
    </div>
  );
}

/* ---------- alarm KPIs — ISA-18.2 load, floods, standing (dd alarm bars) - */
const SEV_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };
const KPI_WINDOW_MS = 4 * 60 * 60e3;
const KPI_BUCKETS = 24; // 10-minute buckets — the ISA-18.2 reporting interval

function AlarmKpiBody() {
  const { t } = useTranslation();
  const now = useBoardNow();
  const a = useVarAlarms();
  const stats = useMemo(() => {
    const end = now;
    const from = end - KPI_WINDOW_MS;
    const bucket = KPI_WINDOW_MS / KPI_BUCKETS;
    const counts = new Array<number>(KPI_BUCKETS).fill(0);
    const worst = new Array<number>(KPI_BUCKETS).fill(-1);
    let total = 0;
    for (const x of a.all) {
      const at = Date.parse(x.ts);
      if (!Number.isFinite(at) || at < from || at > end) continue;
      const i = Math.min(KPI_BUCKETS - 1, Math.floor((at - from) / bucket));
      counts[i]++;
      worst[i] = Math.max(worst[i], SEV_RANK[normSeverity(x.severity)] ?? 0);
      total++;
    }
    return {
      rate: total / KPI_BUCKETS,
      peak: Math.max(...counts, 0),
      floods: counts.filter((n) => n >= FLOOD_THRESHOLD).length,
      standing: a.open.length,
      unacked: a.open.filter((x) => x.state === 'active').length,
      counts, worst,
    };
  }, [a, now]);
  const tiles: { label: string; v: string; hot?: boolean }[] = [
    { label: t('ddb.kpiRate'), v: stats.rate.toFixed(1), hot: stats.rate >= FLOOD_THRESHOLD },
    { label: t('ddb.kpiPeak'), v: String(stats.peak), hot: stats.peak >= FLOOD_THRESHOLD },
    { label: t('ddb.kpiFloods'), v: String(stats.floods), hot: stats.floods > 0 },
    { label: t('ddb.kpiStanding'), v: String(stats.standing), hot: stats.standing > 0 },
    { label: t('ddb.kpiUnacked'), v: String(stats.unacked), hot: stats.unacked > 0 },
  ];
  const barClass = (w: number) =>
    w >= 2 ? 'bg-[var(--color-danger)]' : w === 1 ? 'bg-[var(--color-caution)]' : w === 0 ? 'bg-[var(--color-blue)]' : 'bg-ink-46';
  if (!a.all.length) {
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-5">
          {tiles.map((x) => (
            <div key={x.label} className="text-center">
              <div className="font-mono text-[20px] font-semibold leading-none tabular-nums">{x.v}</div>
              <div className="mt-1 text-[10px] text-ink-46">{x.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-ink-46">{t('alarms.emptyBody')}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-3 content-center gap-2 min-[480px]:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className="text-center">
            <div className={`font-mono text-[20px] font-semibold leading-none tabular-nums ${x.hot ? 'text-[var(--color-danger)]' : ''}`}>{x.v}</div>
            <div className="mt-1 text-[10px] text-ink-46">{x.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 shrink-0">
        <div className="flex h-9 items-end gap-px" role="img" aria-label={t('ddb.kpiDensity')}>
          {stats.counts.map((n, i) => (
            <span key={i} className={`flex-1 rounded-t-[1px] ${barClass(stats.worst[i])}`}
              style={{ height: `${(n / Math.max(stats.peak, 1)) * 100}%`, minHeight: n ? 2 : 0, opacity: n ? 0.9 : 0.15 }}
              title={`${fmtClock(new Date(now - KPI_WINDOW_MS + (i * KPI_WINDOW_MS) / KPI_BUCKETS).toISOString())} · ${n}`} />
          ))}
        </div>
        <p className="mt-0.5 text-[10px] text-ink-46">{t('ddb.kpiDensity')} · {t('ddb.kpiSession')}</p>
      </div>
    </div>
  );
}
