// Chart grammar shared by every uPlot surface in the operator app (Trends,
// dashboard widgets, faceplates). One place decides colour, axes, limit
// lines and the tooltip so a technician reads every chart the same way.
//
// ISA-101 colour discipline: series hues are cool/neutral (blue, magenta,
// violet, teal, navy, purple) and never red / orange / amber / green, which
// stay reserved for abnormal state and alarm limits. The order below was run
// through the dataviz validator against the white chart surface:
//   lightness band PASS · chroma PASS · contrast >= 3:1 PASS ·
//   normal-vision adjacent ΔE >= 18.9 PASS · CVD adjacent ΔE 6.6 (slots 5↔6,
//   WARN band) — legal only with secondary encoding, which every chart has:
//   an HTML legend with names + the stats table on Trends.

import { useQuery } from '@tanstack/react-query';
import type uPlot from 'uplot';
import { api } from '../../lib/api';
import { normSeverity, type Severity } from '../../shared/ui/Status';
import type { AlarmRule } from '../../types';
import './vizI18n';

/** Fixed categorical order — assign in order, never cycle past it. */
export const SERIES_PALETTE = ['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#1d5a9e', '#9b4fc4'] as const;
export const MAX_SERIES = SERIES_PALETTE.length;

/** Limit-line strokes — the reserved abnormal hues, darker steps so a
 *  dashed 1.5px line still reads on a bright control-room screen. */
export const LIMIT_STROKE: Record<Severity, string> = {
  critical: '#b83d44',
  warning: '#b5740a',
  info: '#5d6670',
};

const INK_68 = '#4f5b65';
const GRID = '#e9ecf1';
const TICK = '#d5dae2';

/* ------------------------------------------------------------------ */
/* limits from alarm rules                                             */
/* ------------------------------------------------------------------ */

export interface Limit {
  v: number;
  /** hi / hihi / lo / lolo, or 'warn' / 'crit' for widget thresholds */
  kind: string;
  severity: Severity;
}

const LIMIT_KINDS = new Set(['hi', 'hihi', 'lo', 'lolo']);

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

/* ------------------------------------------------------------------ */
/* number + time formatting                                            */
/* ------------------------------------------------------------------ */

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

export function fmtRange(fromMs: number, toMs: number, locale?: string): string {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  const sameDay = a.toDateString() === b.toDateString();
  const day = (d: Date) => d.toLocaleDateString(locale?.startsWith('th') ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
  return sameDay
    ? `${day(a)} ${fmtTime(fromMs)}–${fmtTime(toMs)}`
    : `${day(a)} ${fmtTime(fromMs)} – ${day(b)} ${fmtTime(toMs)}`;
}

/* ------------------------------------------------------------------ */
/* uPlot options                                                       */
/* ------------------------------------------------------------------ */

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
}

const AXIS_FONT = '11px "IBM Plex Mono", "Roboto Mono", monospace';

export function chartOptions(spec: ChartSpec): uPlot.Options {
  const { series, limits = [], unit, locale } = spec;
  const decimals = series[0]?.decimals;
  return {
    width: spec.width,
    height: spec.height,
    legend: { show: false }, // HTML legend + tooltip own identity and values
    padding: [8, 8, 0, 0],
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
        stroke: INK_68, font: AXIS_FONT,
        grid: { stroke: GRID, width: 1 }, ticks: { stroke: TICK, width: 1, size: 4 },
        values: (u, splits) => {
          const span = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0);
          return splits.map((s) => fmtTime(s * 1000, span < 600));
        },
      },
      {
        stroke: INK_68, font: AXIS_FONT,
        grid: { stroke: GRID, width: 1 }, ticks: { stroke: TICK, width: 1, size: 4 },
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
        stroke: s.color,
        width: s.width ?? 2,
        spanGaps: false, // an outage is a gap, never a flat line
        points: { show: false },
      })),
    ],
    plugins: [limitPlugin(limits, unit, locale, decimals), tooltipPlugin(series, locale)],
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

function axisDecimals(splits: number[], fallback?: number): number {
  if (splits.length < 2) return fallback ?? 1;
  const step = Math.abs(splits[1] - splits[0]);
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

/* ------------------------------------------------------------------ */
/* plugins                                                             */
/* ------------------------------------------------------------------ */

/** Dashed limit lines with a right-aligned "HI 80 °C" tag. The tag text is
 *  ink, not the limit hue (text wears text tokens); the dash carries hue. */
function limitPlugin(limits: Limit[], unit?: string, locale?: string, decimals?: number): uPlot.Plugin {
  return {
    hooks: {
      draw: [(u) => {
        if (!limits.length) return;
        const ctx = u.ctx;
        const dpr = devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        for (const l of limits) {
          const y = Math.round(u.valToPos(l.v, 'y', true));
          if (y < top - 1 || y > top + height + 1) continue;
          ctx.save();
          ctx.strokeStyle = LIMIT_STROKE[l.severity];
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
          const by = y - 14 * dpr < top ? y + 2 * dpr : y - 14 * dpr;
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillRect(bx - 3 * dpr, by, tw + 6 * dpr, 12 * dpr);
          ctx.fillStyle = l.severity === 'info' ? INK_68 : LIMIT_STROKE[l.severity];
          ctx.textBaseline = 'top';
          ctx.fillText(text, bx, by + 1 * dpr);
          ctx.restore();
        }
      }],
    },
  };
}

/** Crosshair tooltip: time on top, one row per series (swatch + name +
 *  value + unit). Built from DOM nodes — labels are never parsed as HTML. */
function tooltipPlugin(series: SeriesSpec[], locale?: string): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  return {
    hooks: {
      init: [(u) => {
        tip = document.createElement('div');
        Object.assign(tip.style, {
          position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '5',
          background: '#fff', border: '1px solid #c8cdd5', borderRadius: '4px',
          boxShadow: '0 3px 11px rgb(36 41 49 / .2)', padding: '6px 8px',
          font: '12px "IBM Plex Sans", "NotoSans", sans-serif', color: 'rgb(28 43 52)',
          minWidth: '140px', whiteSpace: 'nowrap',
        });
        u.over.appendChild(tip);
      }],
      setCursor: [(u) => {
        if (!tip) return;
        const { left, top, idx } = u.cursor;
        if (idx == null || left == null || left < 0 || top == null) { tip.style.display = 'none'; return; }
        const x = u.data[0][idx];
        tip.replaceChildren();
        const head = document.createElement('div');
        head.textContent = fmtTime(x * 1000, true);
        Object.assign(head.style, { font: '600 11px "IBM Plex Mono", monospace', color: '#4f5b65', marginBottom: '4px' });
        tip.appendChild(head);
        series.forEach((s, i) => {
          const v = u.data[i + 1]?.[idx];
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', lineHeight: '18px' });
          const sw = document.createElement('span');
          Object.assign(sw.style, { width: '10px', height: '3px', borderRadius: '2px', background: s.color, flex: 'none' });
          const name = document.createElement('span');
          name.textContent = s.label;
          Object.assign(name.style, { flex: '1', color: '#4f5b65', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' });
          const val = document.createElement('span');
          val.textContent = v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, s.decimals, locale)}${s.unit ? ` ${s.unit}` : ''}`;
          Object.assign(val.style, { font: '600 12px "IBM Plex Mono", monospace', marginLeft: '8px' });
          row.append(sw, name, val);
          tip!.appendChild(row);
        });
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

/* ------------------------------------------------------------------ */
/* data shaping                                                        */
/* ------------------------------------------------------------------ */

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

function medianStep(pts: Pt[]): number {
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
export function joinSeries(series: Pt[][]): uPlot.AlignedData {
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
