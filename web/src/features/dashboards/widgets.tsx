// Widget renderers. Data comes from the real API surface (history, latest)
// and the live alarm store; no widget fetches anything the backend lacks.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sloStatus } from '../slo/SloPage';
import { sloApi } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Markdown from 'react-markdown';
import { SIGNALS, displayNumber } from '../../lib/plant';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { useAlarms } from '../alarms/alarms';
import { QualityMark, SeverityBadge, normSeverity } from '../../shared/ui/Status';
import { EmptyState, ErrorState, Skeleton } from '../../shared/ui/Feedback';
import { TimeChart } from '../trends/TimeChart';
import { useSeries, RETENTION_MS } from '../trends/useSeries';
import { fmtNum, type Limit } from '../trends/viz';
import { LEGACY_SERIES_COLORS, RANGE_MIN, SERIES_COLORS, type RangeKey, type Widget } from './model';

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
  const minutes = RANGE_MIN[w.range === 'inherit' ? range : w.range];
  switch (w.kind) {
    case 'timeseries': return <TimeseriesBody w={w} minutes={minutes} />;
    case 'value': return <ValueBody w={w} minutes={minutes} />;
    case 'stat': return <StatBody w={w} minutes={minutes} />;
    case 'gauge': return <GaugeBody w={w} />;
    case 'bargauge': return <BarGaugeBody w={w} />;
    case 'stateline': return <StateLineBody w={w} minutes={minutes} />;
    case 'histogram': return <HistogramBody w={w} minutes={minutes} />;
    case 'table': return <TableBody w={w} />;
    case 'toplist': return <ToplistBody w={w} />;
    case 'pie': return <PieBody w={w} />;
    case 'alarms': return <AlarmsBody />;
    case 'change': return <ChangeBody w={w} minutes={minutes} />;
    case 'slo': return <SloBody />;
    case 'monitors': return <MonitorsBody />;
    case 'treemap': return <TreemapBody w={w} />;
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
/** latest displayed value for a tag: live first, then history tail */
function useLatest(w: Widget, tag: string | undefined) {
  const hist = useSeries(tag ? [tag] : [], { fromMs: 0, toMs: null, spanMs: 15 * 60e3 });
  useStore(() => live.version);
  const tv = tag ? live.latest.get(tag) : undefined;
  const raw = tv ? num(tv.v) : hist.series[0]?.stats.last ?? null;
  return { tv, hist, raw, v: raw == null || !tag ? null : scaleFor(w, tag)(raw) };
}

const LVL_COLOR: Record<Level, string> = {
  ok: 'var(--color-blue)', warn: 'var(--color-caution)', crit: 'var(--color-danger)',
};

const LEVEL_STYLE: Record<Level, string> = {
  crit: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-l-4 border-[var(--color-danger)]',
  warn: 'bg-[var(--color-caution-soft)] text-[var(--color-caution)] border-l-4 border-[var(--color-caution)]',
  ok: '',
};

const FILL_STYLE: Record<Level, string> = {
  ok: 'bg-[var(--color-ok)] text-white',
  warn: 'bg-[var(--color-warn)] text-[#2b1d00]',
  crit: 'bg-[var(--color-danger-bright)] text-white',
};

function ValueBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const tag = w.tags[0];
  // 'last' needs only a short tail; aggregates read the whole retained window
  const span = w.agg === 'last' ? 15 * 60e3 : Math.min(minutes * 60e3, RETENTION_MS);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: 0, toMs: null, spanMs: span });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  const tv = live.latest.get(tag);
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

function TimeseriesBody({ w, minutes }: { w: Widget; minutes: number }) {
  const { t } = useTranslation();
  const span = Math.min(minutes * 60e3, RETENTION_MS);
  const data = useSeries(w.tags, { fromMs: 0, toMs: null, spanMs: span });
  const unit = unitOfWidget(w);
  const limits = useMemo(() => {
    const l: Limit[] = [];
    if (w.warn != null) l.push({ v: w.warn, kind: 'warn', severity: 'warning' });
    if (w.crit != null) l.push({ v: w.crit, kind: 'crit', severity: 'critical' });
    return l;
  }, [w.warn, w.crit]);
  if (!w.tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TimeChart
        fill
        compact
        series={data.series.map((s, i) => ({
          key: s.tag,
          label: SIGNALS[s.tag] ? t(SIGNALS[s.tag].labelKey) : short(s.tag),
          color: seriesColor(w, i),
          unit,
          decimals: w.decimals,
          width: w.lineWidth,
          pts: w.unit ? s.pts : s.pts.map((p) => ({ t: p.t, v: displayNumber(s.tag, p.v) })),
        }))}
        limits={limits}
        unit={unit}
        yMin={w.yMin}
        yMax={w.yMax}
        legend={w.legend}
        xRange={[data.from, data.to]}
        loading={data.isLoading}
        error={data.isError}
        onRetry={data.refetch}
      />
      {(minutes * 60e3 > RETENTION_MS || data.truncated) && (
        <p className="shrink-0 px-1 text-[10px] text-ink-46">{t(data.truncated ? 'viz.truncated' : 'viz.retention')}</p>
      )}
    </div>
  );
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
  const hist = useSeries(tag ? [tag] : [], { fromMs: 0, toMs: null, spanMs: Math.min(minutes * 60e3, RETENTION_MS) });
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
  return <Counts items={[['breached', '▲', n.breached], ['warning', '◆', n.warning], ['ok', '●', n.ok], ['nodata', '○', n.nodata]].map(([k, g, c]) => ({ label: t(`slos.status.${k}`), glyph: g as string, count: c as number }))} link="/slo" />;
}

/* ---------- monitors — signal feed health: alarming / stale / ok --------- */
function MonitorsBody() {
  const { t } = useTranslation();
  const { open } = useAlarms();
  const now = useNow();
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

function Counts({ items, link }: { items: { label: string; glyph: string; count: number }[]; link: string }) {
  return (
    <Link to={link} className="flex h-full items-center justify-around gap-2 focus-visible:outline-2 focus-visible:outline-blue">
      {items.map((i) => (
        <div key={i.label} className="text-center">
          <div className="font-mono text-[24px] leading-none">{i.count}</div>
          <div className="mt-1 text-[11px] text-ink-46"><span aria-hidden>{i.glyph}</span> {i.label}</div>
        </div>
      ))}
    </Link>
  );
}

/* ---------- gauge — semicircle dial w/ threshold bands (Grafana gauge) ---- */
function GaugeBody({ w }: { w: Widget }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
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
  const now = useNow();
  const tags = w.tags.slice(0, SERIES_COLORS.length);
  if (!tags.length) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 overflow-auto">
      {tags.map((tag) => {
        const tv = live.latest.get(tag);
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
  const now = useNow();
  useStore(() => live.version);
  const tag = w.tags[0];
  const span = w.agg === 'last' ? 15 * 60e3 : Math.min(minutes * 60e3, RETENTION_MS);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: 0, toMs: null, spanMs: span });
  if (!tag) return <EmptyState title={t('dash.pickMetric')} icon="search" />;
  const tv = live.latest.get(tag);
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
  const span = Math.min(minutes * 60e3, RETENTION_MS);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: 0, toMs: null, spanMs: span });
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
  const span = Math.min(minutes * 60e3, RETENTION_MS);
  const hist = useSeries(w.tags.slice(0, 1), { fromMs: 0, toMs: null, spanMs: span });
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
  const { all } = useAlarms();
  const items = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all) {
      const k = w.groupBy === 'rule' ? a.rule : w.groupBy === 'severity' ? normSeverity(a.severity) : short(a.tag);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [all, w.groupBy]);
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
            <span className="block truncate">{w.groupBy === 'severity' ? t(`alarms.${c.k}`) : c.k}</span>
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
  const now = useNow();
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
            const tv = live.latest.get(tag);
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
  const { open } = useAlarms();
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of open) {
      const k = w.groupBy === 'rule' ? a.rule : w.groupBy === 'severity' ? normSeverity(a.severity) : short(a.tag);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [open, w.groupBy]);
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
            <span className="min-w-0 flex-1 truncate">{w.groupBy === 'severity' ? t(`alarms.${k}`) : k}</span>
            <span className="font-mono text-ink-46">{Math.round((n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
