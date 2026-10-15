// Widget renderers. Data comes from the real API surface (history, latest)
// and the live alarm store; no widget fetches anything the backend lacks.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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
    case 'toplist': return <ToplistBody w={w} />;
    case 'alarms': return <AlarmsBody />;
    case 'note': return <p className="h-full overflow-auto whitespace-pre-wrap text-[13px] leading-5 text-ink">{w.note}</p>;
  }
}

const LEVEL_STYLE: Record<Level, string> = {
  crit: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-l-4 border-[var(--color-danger)]',
  warn: 'bg-[var(--color-caution-soft)] text-[var(--color-caution)] border-l-4 border-[var(--color-caution)]',
  ok: '',
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
