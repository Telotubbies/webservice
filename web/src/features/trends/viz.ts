// Chart grammar shared by every uPlot surface in the operator app (Trends,
// dashboard widgets, faceplates). One place decides colour, axes, limit
// lines and the tooltip so a technician reads every chart the same way.
//
// ISA-101 colour discipline: series hues are cool/neutral and never red /
// orange / amber / green, which stay reserved for abnormal state and alarm
// limits. The five validated slots live in viz/palette.ts.

import { useQuery } from '@tanstack/react-query';
import type uPlot from 'uplot';
import { api } from '../../lib/api';
import { normSeverity, type Severity } from '../../shared/ui/Status';
import type { AlarmRule } from '../../types';
import { cssVar } from '../../theme/useTheme';
import { SERIES, chartTheme, type ChartTheme } from '../../viz/palette';
import { annotationsPlugin, onsetsPlugin, type Annotation } from '../../viz/annotations';
import './vizI18n';

/** Fixed categorical order — assign in order, never cycle past it. The
 *  palette lives in viz/palette.ts (5 validated slots, light and dark);
 *  these names stay for existing callers. */
export const SERIES_PALETTE = SERIES.light;
export const SERIES_PALETTE_DARK = SERIES.dark;
export const MAX_SERIES = SERIES.light.length;

/** A light-palette series colour → the same slot in the active theme's
 *  palette; any other colour passes through untouched. */
export function seriesStroke(color: string, theme: 'light' | 'dark'): string {
  if (theme === 'light') return color;
  const i = (SERIES.light as readonly string[]).indexOf(color);
  return i < 0 ? color : SERIES.dark[i];
}

/** Limit-line strokes — the reserved abnormal hues, darker steps so a
 *  dashed 1.5px line still reads on a bright control-room screen. */
export const LIMIT_STROKE: Record<Severity, string> = {
  critical: 'var(--color-crit)',
  warning: 'var(--color-warn-ink)',
  info: 'var(--color-info)',
};

/* Light-theme values, used only when a token cannot be read (tests, SSR). */
const FALLBACK: Record<string, string> = {
  '--color-line': '#dfe3e8', '--color-ink-3': '#6b7685', '--color-ink-2': '#4a5563', '--color-panel': '#ffffff',
  '--color-crit': '#c62828', '--color-warn-ink': '#b26a00', '--color-info': '#5b6573',
};

/** The chart theme of the page right now (canvas cannot resolve var(--…), so
 *  a chart reads the tokens when it is built and rebuilds on a theme switch). */
export function currentChartTheme(): ChartTheme {
  const name = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return chartTheme(name, (n) => cssVar(n, FALLBACK[n] ?? '#888'));
}

function canvasColors(t: ChartTheme) {
  return {
    theme: t.name,
    ink: t.text,
    grid: t.grid,
    tick: t.grid,
    paper: t.surface,
    limit: { critical: t.crit, warning: t.warn, info: t.info } as Record<Severity, string>,
  };
}
type CanvasColors = ReturnType<typeof canvasColors>;

// ── Limits from alarm rules ──────────────────────────────────────────────────

export interface Limit {
  v: number;
  /** hi / hihi / lo / lolo, or 'warn' / 'crit' for widget thresholds */
  kind: string;
  severity: Severity;
}

const LIMIT_KINDS = new Set(['hi', 'hihi', 'lo', 'lolo']);

/** Enabled hi/hihi/lo/lolo rules → per-tag limit lines for the chart. */
export function limitsFromRules(rules: AlarmRule[] | undefined): Map<string, Limit[]> {
  const m = new Map<string, Limit[]>();
  for (const r of rules ?? []) {
    if (!r.enabled || r.tag == null || r.threshold == null || !LIMIT_KINDS.has(r.kind)) continue;
    const list = m.get(r.tag) ?? [];
    list.push({ v: r.threshold, kind: r.kind, severity: normSeverity(r.severity) });
    m.set(r.tag, list);
  }
  return m;
}

/** Configured alarm limits per tag. Failing to load (403, offline) simply
 *  means no limit lines — charts never block on it. */
export function useLimits(): Map<string, Limit[]> {
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000, retry: 1 });
  return limitsFromRules(q.data);
}

/** "HI 80 °C" — short, uppercase kind like a P&ID limit tag. */
export function limitLabel(l: Limit, unit?: string, locale?: string, decimals?: number): string {
  return `${l.kind.toUpperCase()} ${fmtNum(l.v, decimals, locale)}${unit ? ` ${unit}` : ''}`;
}

// ── Number + time formatting ─────────────────────────────────────────────────

/** Locale-aware number; decimals follow magnitude (100s → 0, 10s → 1, else 2). */
export function fmtNum(v: number | null | undefined, decimals?: number, locale?: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = decimals ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return v.toLocaleString(locale?.startsWith('th') ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 24-hour clock (control rooms never read am/pm). Seconds only when the
 *  visible span is short enough to need them. */
export function fmtTime(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
}

/** x-axis tick: on ranges of a day or more the tick at local midnight reads
 *  as the date ("5 Nov"), every other tick as a time. */
export function fmtAxisTick(ms: number, spanSec: number, locale?: string): string {
  const d = new Date(ms);
  if (spanSec >= 86400 && d.getHours() === 0 && d.getMinutes() === 0) {
    return d.toLocaleDateString(locale?.startsWith('th') ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
  }
  return fmtTime(ms, spanSec < 600);
}

/** Top edges for limit tags so two never overlap: each sits above its line,
 *  or below when that collides with a tag already placed. */
export function placeLabels(ys: number[], h: number, top: number): number[] {
  const placed: number[] = [];
  const free = (b: number) => placed.every((p) => Math.abs(p - b) >= h);
  return ys.map((y) => {
    const cands = [y - h - 2, y + 2];
    let b = cands.find((c) => c >= top && free(c));
    if (b == null) { b = cands[0]; while (!free(b)) b += h; }
    placed.push(b);
    return b;
  });
}

/** "9 Aug 14:20–14:35" for a same-day window, dates on both ends otherwise. */
export function fmtRange(fromMs: number, toMs: number, locale?: string): string {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  const sameDay = a.toDateString() === b.toDateString();
  const day = (d: Date) => d.toLocaleDateString(locale?.startsWith('th') ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
  return sameDay
    ? `${day(a)} ${fmtTime(fromMs)}–${fmtTime(toMs)}`
    : `${day(a)} ${fmtTime(fromMs)} – ${day(b)} ${fmtTime(toMs)}`;
}

// ── uPlot options ────────────────────────────────────────────────────────────

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  unit?: string;
  decimals?: number;
  width?: number;
}

export interface ChartSpec {
  width: number;
  height: number;
  series: SeriesSpec[];
  limits?: Limit[];
  /** axis unit — one unit per chart, never a second y-axis */
  unit?: string;
  locale?: string;
  yMin?: number | null;
  yMax?: number | null;
  /** cursor sync group: charts in a small-multiple stack share a crosshair */
  syncKey?: string;
  /** called with an epoch-ms window when the user drags to zoom */
  onZoom?: (fromMs: number, toMs: number) => void;
  /** the x window (epoch ms) — fixed so a short history reads as a gap */
  xRange: [number, number];
  /** colours; defaults to the page's current theme */
  theme?: ChartTheme;
  /** events drawn as hairlines with an x-axis tick */
  annotations?: Annotation[];
  /** extra uPlot plugins (min–max band, gap shading) appended after the built-ins */
  plugins?: uPlot.Plugin[];
  /** extra tooltip line for a sample time (epoch s), e.g. the min–max of a rollup point */
  detail?: (tSec: number) => string | null;
}

const AXIS_FONT = '11px "IBM Plex Mono", "Roboto Mono", monospace';

/** Assembles the full uPlot option object for a spec — axes, limit lines,
 *  tooltip, drag-zoom. xRange is fixed in the spec so missing history draws
 *  as empty space instead of stretching the data to fill. */
export function chartOptions(spec: ChartSpec): uPlot.Options {
  const { series, limits = [], unit, locale } = spec;
  const decimals = series[0]?.decimals;
  const ct = spec.theme ?? currentChartTheme();
  const c = canvasColors(ct);
  return {
    width: spec.width,
    height: spec.height,
    legend: { show: false }, // HTML legend + tooltip own identity and values
    padding: [8, 20, 0, 0], // room for the last x tick label
    cursor: {
      drag: { x: true, y: false, setScale: false },
      points: { size: 7, width: 2 },
      ...(spec.syncKey ? { sync: { key: spec.syncKey } } : {}),
    },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
    scales: {
      x: { time: true, range: () => [spec.xRange[0] / 1000, spec.xRange[1] / 1000] },
      y: {
        range: (_u, lo, hi) => {
          let a = spec.yMin ?? lo;
          let b = spec.yMax ?? hi;
          if (spec.yMin == null || spec.yMax == null) {
            // keep the configured limits on screen: distance-to-limit is the
            // first thing an operator reads off a trend
            for (const l of limits) {
              if (spec.yMin == null) a = Math.min(a, l.v);
              if (spec.yMax == null) b = Math.max(b, l.v);
            }
          }
          if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 1];
          if (a === b) { a -= 1; b += 1; }
          const padY = (b - a) * 0.06;
          return [spec.yMin ?? a - padY, spec.yMax ?? b + padY];
        },
      },
    },
    axes: [
      {
        stroke: c.ink, font: AXIS_FONT,
        grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.tick, width: 1, size: 4 },
        values: (u, splits) => {
          const span = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0);
          return splits.map((s) => fmtAxisTick(s * 1000, span, locale));
        },
      },
      {
        stroke: c.ink, font: AXIS_FONT,
        grid: { stroke: c.grid, width: 1 }, ticks: { stroke: c.tick, width: 1, size: 4 },
        label: unit || undefined,
        labelFont: '11px "IBM Plex Sans", "NotoSans", sans-serif',
        labelSize: unit ? 16 : 0,
        labelGap: 2,
        size: (_u, values) => {
          const w = Math.max(3, ...(values ?? []).map((v) => String(v).length));
          return Math.ceil(w * 7 + 14);
        },
        values: (_u, splits) => splits.map((v) => fmtNum(v, axisDecimals(splits, decimals), locale)),
      },
    ],
    series: [
      {},
      ...series.map((s) => ({
        label: s.label,
        stroke: seriesStroke(s.color, c.theme),
        width: s.width ?? 2,
        spanGaps: false, // an outage is a gap, never a flat line
        points: { show: false },
      })),
    ],
    plugins: [
      limitPlugin(limits, c, unit, locale, decimals),
      onsetsPlugin(limits, { axis: ct.axis, crit: ct.crit, warn: ct.warn }),
      annotationsPlugin(spec.annotations ?? [], { axis: ct.axis, crit: ct.crit, warn: ct.warn }),
      tooltipPlugin(series, c.theme, locale, spec.detail),
      ...(spec.plugins ?? []),
    ],
    hooks: spec.onZoom ? {
      setSelect: [(u) => {
        if (u.select.width < 4) return;
        const a = u.posToVal(u.select.left, 'x') * 1000;
        const b = u.posToVal(u.select.left + u.select.width, 'x') * 1000;
        u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        spec.onZoom!(Math.round(a), Math.round(b));
      }],
    } : undefined,
  };
}

// Tick labels get just enough decimals to stay distinct at the current
// split step — 1-unit steps label as integers, sub-0.01 steps get 3.
function axisDecimals(splits: number[], fallback?: number): number {
  if (splits.length < 2) return fallback ?? 1;
  const step = Math.abs(splits[1] - splits[0]);
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

// ── Plugins ──────────────────────────────────────────────────────────────────

/** Dashed limit lines with a right-aligned "HI 80 °C" tag. The tag text is
 *  ink, not the limit hue (text wears text tokens); the dash carries hue. */
function limitPlugin(limits: Limit[], c: CanvasColors, unit?: string, locale?: string, decimals?: number): uPlot.Plugin {
  return {
    hooks: {
      draw: [(u) => {
        if (!limits.length) return;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        const shown = limits.map((l) => ({ l, y: Math.round(u.valToPos(l.v, 'y', true)) }))
          .filter(({ y }) => y >= top - 1 && y <= top + height + 1).sort((a, b) => a.y - b.y);
        const tops = placeLabels(shown.map((s) => s.y), 12 * dpr + 2 * dpr, top);
        shown.forEach(({ l, y }, i) => {
          ctx.save();
          ctx.strokeStyle = c.limit[l.severity];
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([6 * dpr, 4 * dpr]);
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(left + width, y);
          ctx.stroke();
          const text = `${l.severity === 'critical' ? '▲' : l.severity === 'warning' ? '◆' : '●'} ${limitLabel(l, unit, locale, decimals)}`;
          ctx.setLineDash([]);
          ctx.font = `600 ${10 * dpr}px "IBM Plex Sans", "NotoSans", sans-serif`;
          const tw = ctx.measureText(text).width;
          const bx = left + width - tw - 8 * dpr;
          const by = tops[i];
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = c.paper;
          ctx.fillRect(bx - 3 * dpr, by, tw + 6 * dpr, 12 * dpr);
          ctx.globalAlpha = 1;
          ctx.fillStyle = l.severity === 'info' ? c.ink : c.limit[l.severity];
          ctx.textBaseline = 'top';
          ctx.fillText(text, bx, by + 1 * dpr);
          ctx.restore();
        });
      }],
    },
  };
}

/** Crosshair tooltip: time on top, one row per series (swatch + name +
 *  value + unit). Built from DOM nodes — labels are never parsed as HTML. */
function tooltipPlugin(series: SeriesSpec[], theme: 'light' | 'dark', locale?: string, detail?: (tSec: number) => string | null): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  let hovered = false;
  return {
    hooks: {
      init: [(u) => {
        // a synced crosshair moves on every chart of the group, but only the
        // chart under the pointer (or holding keyboard focus) gets a tooltip
        u.over.addEventListener('mouseenter', () => { hovered = true; });
        u.over.addEventListener('mouseleave', () => { hovered = false; if (tip) tip.style.display = 'none'; });
        tip = document.createElement('div');
        Object.assign(tip.style, {
          position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '5',
          background: 'var(--color-paper)', border: '1px solid var(--color-line-strong)', borderRadius: '4px',
          boxShadow: '0 3px 11px rgb(36 41 49 / .2)', padding: '6px 8px',
          font: '12px "IBM Plex Sans", "NotoSans", sans-serif', color: 'var(--color-ink)',
          minWidth: '140px', whiteSpace: 'nowrap',
        });
        u.over.appendChild(tip);
      }],
      setCursor: [(u) => {
        if (!tip) return;
        const { left, top, idx } = u.cursor;
        const focused = !!u.root.parentElement?.contains(document.activeElement);
        if (idx == null || left == null || left < 0 || top == null || !(hovered || focused)) { tip.style.display = 'none'; return; }
        const x = u.data[0][idx];
        tip.replaceChildren();
        const head = document.createElement('div');
        head.textContent = fmtTime(x * 1000, true);
        Object.assign(head.style, { font: '600 11px "IBM Plex Mono", monospace', color: 'var(--color-ink-68)', marginBottom: '4px' });
        tip.appendChild(head);
        series.forEach((s, i) => {
          const v = u.data[i + 1]?.[idx];
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', lineHeight: '18px' });
          const sw = document.createElement('span');
          Object.assign(sw.style, { width: '10px', height: '3px', borderRadius: '2px', background: seriesStroke(s.color, theme), flex: 'none' });
          const name = document.createElement('span');
          name.textContent = s.label;
          Object.assign(name.style, { flex: '1', color: 'var(--color-ink-68)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' });
          const val = document.createElement('span');
          val.textContent = v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, s.decimals, locale)}${s.unit ? ` ${s.unit}` : ''}`;
          Object.assign(val.style, { font: '600 12px "IBM Plex Mono", monospace', marginLeft: '8px' });
          row.append(sw, name, val);
          tip!.appendChild(row);
        });
        const extra = detail?.(x);
        if (extra) {
          const d = document.createElement('div');
          d.textContent = extra;
          Object.assign(d.style, { font: '11px "IBM Plex Mono", monospace', color: 'var(--color-ink-68)', marginTop: '2px' });
          tip.appendChild(d);
        }
        tip.style.display = 'block';
        const ow = u.over.clientWidth;
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const lx = left + 14 + tw > ow ? left - tw - 14 : left + 14;
        const ly = Math.max(0, Math.min(top - th / 2, u.over.clientHeight - th));
        tip.style.transform = `translate(${Math.max(0, lx)}px, ${ly}px)`;
        tip.style.left = '0';
        tip.style.top = '0';
      }],
    },
  };
}

// ── Data shaping ─────────────────────────────────────────────────────────────

export interface Pt { t: number; v: number }

/** Min/max bucket decimation — keeps spikes (a mean would hide them). */
export function decimate(pts: Pt[], maxPts = 1400): Pt[] {
  if (pts.length <= maxPts) return pts;
  const buckets = Math.floor(maxPts / 2);
  const t0 = pts[0].t;
  const span = pts[pts.length - 1].t - t0 || 1;
  const out: Pt[] = [];
  let b = -1;
  let lo: Pt | null = null;
  let hi: Pt | null = null;
  const flush = () => {
    if (!lo || !hi) return;
    if (lo === hi) out.push(lo);
    else if (lo.t < hi.t) out.push(lo, hi);
    else out.push(hi, lo);
  };
  for (const p of pts) {
    const k = Math.min(buckets - 1, Math.floor(((p.t - t0) / span) * buckets));
    if (k !== b) { flush(); b = k; lo = p; hi = p; continue; }
    if (p.v < lo!.v) lo = p;
    if (p.v > hi!.v) hi = p;
  }
  flush();
  return out;
}

// Typical gap between samples, estimated on a strided subset so a long
// series doesn't sort 5 000 deltas. Feeds joinSeries's match tolerance.
function medianStep(pts: { t: number }[]): number {
  if (pts.length < 2) return 1000;
  const steps: number[] = [];
  const stride = Math.max(1, Math.floor(pts.length / 200));
  for (let i = stride; i < pts.length; i += stride) steps.push((pts[i].t - pts[i - stride].t) / stride);
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] || 1000;
}

/** Join series onto a shared time grid. A series contributes a value at a
 *  grid time only when it has a sample close enough — so an outage or a
 *  removed bad-quality sample renders as a gap, never a bridged line. */
export function joinSeries(series: { t: number; v: number | null }[][]): uPlot.AlignedData {
  const times = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort((a, b) => a - b);
  const cols = series.map((pts) => {
    const tol = Math.max(2500, medianStep(pts) * 3);
    let j = 0;
    return times.map((t) => {
      while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
      const p = pts[j];
      if (!p || p.t > t) return null;
      return t - p.t <= tol ? p.v : null;
    });
  });
  return [times.map((t) => t / 1000), ...cols] as uPlot.AlignedData;
}
