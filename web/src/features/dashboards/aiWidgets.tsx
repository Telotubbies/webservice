// Aggregate-AI widgets: live CCTV with the truck decision, decision tile and
// log, class mix, margin distribution, and the inference health of the models
// behind them. Data comes from the material API (backend/app/vision/material.py);
// nothing is estimated client-side.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminOrg } from '../admin/admin';
import { camApi } from '../cameras/api';
import { streamRefreshMs } from '../cameras/logic';
import {
  GRAVEL_COLOR, SAND_COLOR, colorOfDecision, decisionOf, useMatCameras, useMatEvents, useMatMetrics, useMatSummary,
  type MatCamera,
} from '../material/api';
import { EmptyState, Skeleton } from '../../shared/ui/Feedback';
import { TimeChart } from '../trends/TimeChart';
import { fmtAge } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { RANGE_MIN, type RangeKey, type Widget } from './model';
import '../material/i18n';

export const AI_KINDS = ['matlive', 'matdecision', 'matkpi', 'matmix', 'matmargin', 'matlog', 'ailatency', 'aithroughput'] as const;

const minutesOf = (range: RangeKey) => RANGE_MIN[range];
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function useMainCamera(): MatCamera | undefined {
  const cams = useMatCameras().data;
  return cams?.find((c) => c.material?.enabled && c.enabled) ?? cams?.[0];
}

/** MJPEG <img> behind a 60 s signed URL, re-opened before the server cap (same as CameraTile). */
function LiveFrame({ cam }: { cam: MatCamera }) {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!orgId || !cam.enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const open = async () => {
      try { const r = await camApi.streamUrl(orgId, cam.id); if (alive) { setSrc(r.url); setBroken(false); } } catch { if (alive) setBroken(true); }
      if (alive) timer = setTimeout(open, streamRefreshMs());
    };
    void open();
    return () => { alive = false; clearTimeout(timer); };
  }, [orgId, cam.id, cam.enabled]);
  return (
    <div className="relative h-full min-h-0 w-full bg-ink/90">
      {src && <img src={src} alt={cam.name} className="h-full w-full object-contain" onError={() => setBroken(true)} onLoad={() => setBroken(false)} />}
      {(!src || broken) && <p className="absolute inset-0 grid place-items-center text-[12px] text-white/80" role="status">{broken ? t('cam.streamLost') : t('cam.waiting')}</p>}
    </div>
  );
}

function GateChip({ cam }: { cam: MatCamera }) {
  const { t } = useTranslation();
  const live = cam.material_live;
  const present = live?.gate === 'present';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold ${present ? 'bg-info-soft text-blue' : 'bg-subtle text-ink-68'}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${present ? 'bg-blue' : 'bg-ink-35'}`} />
      {present ? t('mat.gatePresent') : t('mat.gateEmpty')}
    </span>
  );
}

/** Running sand/gravel split of the truck that is dumping now. */
function MixBar({ frac }: { frac: number | undefined }) {
  const { t } = useTranslation();
  if (frac == null) return <p className="text-[11px] text-ink-46">{t('mat.noTruck')}</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-sm" role="img" aria-label={`${t('mat.sand')} ${pct(frac)}, ${t('mat.gravel')} ${pct(1 - frac)}`}>
        <div style={{ width: `${(1 - frac) * 100}%`, background: GRAVEL_COLOR }} />
        <div style={{ width: `${frac * 100}%`, background: SAND_COLOR }} />
      </div>
      <p className="mt-1 flex justify-between text-[11px]"><span>{t('mat.gravel')} {pct(1 - frac)}</span><span>{t('mat.sand')} {pct(frac)}</span></p>
    </div>
  );
}

export function MatLiveBody() {
  const { t } = useTranslation();
  const cam = useMainCamera();
  if (!cam) return <Skeleton h={40} />;
  const live = cam.material_live;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-[4px]"><LiveFrame cam={cam} /></div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-[12px] font-semibold">{cam.name}</p>
          <p className="text-[11px] text-ink-46">{cam.engine ?? '—'}{cam.latency_ms != null ? ` · ${Math.round(cam.latency_ms)} ms` : ''}{cam.material?.dry_run ? ` · ${t('mat.dryRun')}` : ''}</p></div>
        <GateChip cam={cam} />
      </div>
      <MixBar frac={live?.gate === 'present' ? live.sand_frac : undefined} />
    </div>
  );
}

export function MatDecisionBody() {
  const { t } = useTranslation();
  const now = useNow();
  const cam = useMainCamera();
  const ev = useMatEvents(1).data?.[0];
  const d = ev ? decisionOf(ev) : null;
  if (!d || !ev) return <EmptyState title={t('mat.noDecisions')} />;
  const bg = colorOfDecision(d.decision);
  return (
    <div className="flex h-full flex-col justify-center rounded-[4px] px-4 text-white" style={{ background: bg }}>
      <p className="text-[12px] uppercase tracking-wide opacity-90">{t('mat.lastTruck')}</p>
      <p className="text-[40px] font-semibold leading-none">{t(`mat.${d.decision === 'no-material' ? 'none' : d.decision}`)}</p>
      <p className="mt-1 text-[12px] opacity-95">
        {t('mat.margin')} {pct(d.margin)} · {d.frames} {t('mat.frames')} · {fmtAge(ev.fired_at, now)}
        {d.uncertain && <b className="ml-2 rounded bg-white/25 px-1.5">{t('mat.review')}</b>}
      </p>
      {cam?.material?.dry_run && <p className="mt-1 text-[11px] opacity-90">{t('mat.dryRun')}</p>}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center rounded border border-line px-3 py-2">
      <p className="truncate text-[11px] text-ink-46">{label}</p>
      <p className="text-[28px] font-semibold leading-tight tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] text-ink-46">{sub}</p>}
    </div>
  );
}

export function MatKpiBody({ range }: { range: RangeKey }) {
  const { t } = useTranslation();
  const min = minutesOf(range);
  const sum = useMatSummary(min).data;
  const met = useMatMetrics(Math.min(min, 60)).data;
  const last = met?.items.at(-1);
  const inferPerMin = met && met.items.length ? Math.round(met.items.reduce((s, p) => s + (p.infer_n ?? 0), 0) / Math.max(1, (met.items.length * met.step_s) / 60)) : null;
  const lat = met?.items.map((p) => p.lat_p95).filter((x): x is number => x != null);
  return (
    <div className="flex h-full gap-2">
      <Kpi label={t('mat.kpiTrucks')} value={sum ? String(sum.total) : '—'} sub={sum ? `${sum.by_decision.gravel ?? 0} ${t('mat.gravel')} · ${sum.by_decision.sand ?? 0} ${t('mat.sand')}` : undefined} />
      <Kpi label={t('mat.kpiUncertain')} value={sum && sum.total ? pct(sum.uncertain / sum.total) : '—'} sub={sum ? `${sum.uncertain} ${t('mat.kpiForReview')}` : undefined} />
      <Kpi label={t('mat.kpiLatency')} value={lat?.length ? `${Math.round(lat[lat.length - 1])} ms` : '—'} sub={last ? `${last.fps ?? '—'} fps` : undefined} />
      <Kpi label={t('mat.kpiInfer')} value={inferPerMin != null ? String(inferPerMin) : '—'} sub={t('mat.kpiPerMin')} />
    </div>
  );
}

export function MatMixBody({ range }: { range: RangeKey }) {
  const { t } = useTranslation();
  const sum = useMatSummary(minutesOf(range)).data;
  if (!sum) return <Skeleton h={40} />;
  const g = sum.by_decision.gravel ?? 0, s = sum.by_decision.sand ?? 0;
  if (!g && !s) return <EmptyState title={t('mat.noDecisions')} />;
  const cells = [
    { k: 'gravel', n: g, c: GRAVEL_COLOR, mass: sum.mass.gravel },
    { k: 'sand', n: s, c: SAND_COLOR, mass: sum.mass.sand },
  ].filter((x) => x.n > 0);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex justify-between text-[12px]"><span className="font-semibold">{t('dash.total')}</span><span className="font-mono">{g + s}</span></div>
      <div className="flex min-h-0 flex-1 gap-px">
        {cells.map((x) => (
          <div key={x.k} className="flex flex-col justify-center p-2 text-center text-white" style={{ background: x.c, flex: x.n }}>
            <span className="text-[13px] font-semibold">{t(`mat.${x.k}`)}</span>
            <span className="font-mono text-[18px] font-semibold">{x.n}</span>
            <span className="text-[11px] opacity-90">{pct(x.n / (g + s))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MatMarginBody({ range }: { range: RangeKey }) {
  const { t } = useTranslation();
  const sum = useMatSummary(minutesOf(range)).data;
  const cam = useMainCamera();
  if (!sum) return <Skeleton h={40} />;
  if (!sum.total) return <EmptyState title={t('mat.noDecisions')} />;
  const max = Math.max(...sum.margin_hist, 1);
  const thr = cam?.material?.min_margin ?? 0.3;
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-end gap-px border-b border-line">
        {sum.margin_hist.map((n, i) => (
          <div key={i} className="flex-1 opacity-90" title={`${i * 10}–${i * 10 + 10}%: ${n}`}
            style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, background: (i + 1) / 10 <= thr ? '#8a94a0' : 'var(--color-blue)' }} />
        ))}
        <span className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-35" style={{ left: `${thr * 100}%` }}>
          <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] text-ink-46">{t('mat.threshold')} {pct(thr)}</span>
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-46"><span>0%</span><span>{t('mat.margin')}</span><span>100%</span></div>
    </div>
  );
}

export function MatLogBody() {
  const { t, i18n } = useTranslation();
  const events = useMatEvents(15).data;
  if (!events) return <Skeleton h={40} />;
  if (!events.length) return <EmptyState title={t('mat.noDecisions')} />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-white text-left text-[11px] uppercase text-ink-46">
          <tr><th className="py-1 pr-2 font-medium">{t('mat.time')}</th><th className="pr-2 font-medium">{t('mat.decision')}</th><th className="pr-2 font-medium">{t('mat.margin')}</th><th className="pr-2 font-medium">{t('mat.frames')}</th><th className="font-medium">{t('mat.plc')}</th></tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const d = decisionOf(e);
            if (!d) return null;
            const wrote = d.outputs?.filter((o) => o.result === 'submitted').length ?? 0;
            const blocked = d.outputs?.find((o) => o.result === 'blocked');
            return (
              <tr key={e.id} className="border-t border-line">
                <td className="py-1 pr-2 font-mono text-ink-68">{new Date(e.fired_at).toLocaleTimeString(i18n.language, { hour12: false })}</td>
                <td className="pr-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: colorOfDecision(d.decision) }} />{t(`mat.${d.decision === 'no-material' ? 'none' : d.decision}`)}{d.uncertain && <b className="rounded bg-subtle px-1 text-[10px] text-ink-68">{t('mat.review')}</b>}</span></td>
                <td className="pr-2">
                  <span className="inline-block h-1.5 w-12 rounded-full bg-line align-middle"><span className="block h-full rounded-full bg-[var(--color-blue)]" style={{ width: pct(d.margin) }} /></span>
                  <span className="ml-1 font-mono">{pct(d.margin)}</span></td>
                <td className="pr-2 font-mono">{d.frames}</td>
                <td className="text-ink-68">{d.dry_run ? t('mat.dryRun') : blocked ? `${t('mat.blocked')}: ${blocked.reason}` : wrote ? t('mat.written', { n: wrote }) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function usePerf(range: RangeKey) {
  const min = minutesOf(range);
  const q = useMatMetrics(min);
  const to = Date.now(), from = to - min * 60_000;
  const pts = (key: 'lat_p50' | 'lat_p95' | 'infer_n' | 'det_n', scale = 1) =>
    (q.data?.items ?? []).filter((p) => p[key] != null).map((p) => ({ t: Date.parse(p.t), v: (p[key] as number) * scale }));
  return { q, from, to, pts, step: q.data?.step_s ?? 60 };
}

export function AiLatencyBody({ w, range }: { w: Widget; range: RangeKey }) {
  const { t } = useTranslation();
  const { q, from, to, pts } = usePerf(range);
  const series = useMemo(() => [
    { key: 'p50', label: 'p50', color: '#2a78d6', unit: 'ms', decimals: 0, width: w.lineWidth, pts: pts('lat_p50') },
    { key: 'p95', label: 'p95', color: '#6250d6', unit: 'ms', decimals: 0, width: w.lineWidth, pts: pts('lat_p95') },
  ], [q.data, w.lineWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.data && !q.data.items.length) return <EmptyState title={t('mat.noMetrics')} />;
  return <TimeChart fill compact series={series} unit="ms" xRange={[from, to]} yMin={0} loading={q.isLoading} error={q.isError} onRetry={() => void q.refetch()} />;
}

export function AiThroughputBody({ w, range }: { w: Widget; range: RangeKey }) {
  const { t } = useTranslation();
  const { q, from, to, pts, step } = usePerf(range);
  const perMin = 60 / step;
  const series = useMemo(() => [
    { key: 'inf', label: t('mat.kpiInfer'), color: '#2a78d6', unit: '/min', decimals: 0, width: w.lineWidth, pts: pts('infer_n', perMin) },
    { key: 'det', label: t('mat.detections'), color: '#0b9a9a', unit: '/min', decimals: 0, width: w.lineWidth, pts: pts('det_n', perMin) },
  ], [q.data, w.lineWidth, perMin, t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.data && !q.data.items.length) return <EmptyState title={t('mat.noMetrics')} />;
  return <TimeChart fill compact series={series} unit="/min" xRange={[from, to]} yMin={0} loading={q.isLoading} error={q.isError} onRetry={() => void q.refetch()} />;
}
