// MetricTile — Moving-Analog-Indicator tile (spec §3.3-A, Ignition-style):
// label, mono PV (tnum), horizontal range band with the normal zone drawn
// between configured lo/hi alarm edges and alarm shading outside them, a
// pointer at the PV position, an SP tick on writable signals, and a sparkline.
// Replaces the old Kpi card but keeps the .tile contract the UAT asserts on:
// article.kpi.tile, .kpi-head, .kpi-value.tile-val .num + .kpi-unit,
// .kpi-spark, .kpi-foot, .tile-stub-badge, data-signal.

import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { SIGNALS, T, displayNumber, formatSignal } from '../../lib/plant';
import { Sparkline } from '../../shared/ui/Sparkline';
import { QualityMark, SeverityBadge } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';

/** Alarm-zone edges for one tag, in raw units. `lo` = max lo/lolo, `hi` = min
 *  hi/hihi across enabled rules (see useLimits in OverviewPage). */
export interface TileBand {
  lo?: number;
  hi?: number;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export function MetricTile({ name, band, now }: { name: string; band?: TileBand; now: number }) {
  const { t, i18n } = useTranslation();
  const { openFaceplate } = useFaceplate();
  const v = useStore(() => live.latest.get(name));
  useStore(() => live.version);
  useStore(() => live.alarmRev);
  useStore(() => live.insightRev);
  useStore(() => live.tagRev);
  const meta = SIGNALS[name];
  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
  const num = typeof v?.v === 'number' ? displayNumber(name, v.v) : undefined;
  const [rMin, rMax] = meta.range ?? [0, 100];
  const span = rMax - rMin || 1;
  // thresholds arrive in raw units; convert to display units so they sit
  // correctly on the display range (ratio tags render as percent)
  const pct = (raw: number) => clampPct(((displayNumber(name, raw) - rMin) / span) * 100);
  const pvPct = num === undefined ? undefined : clampPct(((num - rMin) / span) * 100);
  const loPct = band?.lo !== undefined ? pct(band.lo) : 0;
  const hiPct = band?.hi !== undefined ? pct(band.hi) : 100;
  // SP tick: only on writable numeric signals (speed_sp) — the tag's own value
  // is the setpoint, drawn as a tick so it stays distinct from the PV pointer.
  const writable =
    (live.tags.find((ti) => ti.name === name)?.writable ?? name === T.speedSp) &&
    typeof v?.v === 'number';
  const inAlarm = live.alarms.some((a) => a.tag === name && a.state !== 'cleared');
  const anomaly = live.insights.some((i) => i.tag === name && i.state === 'open');
  const scale = name === T.gravel ? 100 : 1;
  const hiDisp = band?.hi !== undefined ? displayNumber(name, band.hi) : undefined;

  return (
    <article
      className={`kpi tile${stale ? ' is-stale' : ''}${inAlarm ? ' is-alarm' : ''}${anomaly ? ' is-anomaly' : ''}`}
      data-signal={name}
      role="button" tabIndex={0} aria-label={t(meta.labelKey)}
      onClick={() => openFaceplate(name)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaceplate(name); } }}
    >
      <header className="kpi-head">
        <h3>{t(meta.labelKey)}</h3>
        {anomaly && <span className="ai-dot" title={t('insights.title')} aria-hidden>✦</span>}
        {meta.stub && <span className="badge badge-stub tile-stub-badge" title={t('overview.stubTitle')}>{t('overview.stub')}</span>}
        {inAlarm && <SeverityBadge severity="critical" />}
      </header>
      <p className="kpi-value tile-val">
        <span className="num">{stale ? '—' : formatSignal(name, v?.v, i18n.language)}</span>
        {meta.unit && <span className="kpi-unit">{meta.unit}</span>}
      </p>
      <div className="kpi-band" aria-hidden>
        {band?.lo !== undefined && loPct > 0 && (
          <span className="kpi-band-alarm" style={{ left: 0, width: `${loPct}%` }} />
        )}
        <span
          className="kpi-band-normal"
          style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }}
        />
        {band?.hi !== undefined && hiPct < 100 && (
          <span className="kpi-band-alarm" style={{ left: `${hiPct}%`, width: `${100 - hiPct}%` }} />
        )}
        {writable && pvPct !== undefined && !stale && (
          <span className="kpi-sp-tick" style={{ left: `${pvPct}%` }} />
        )}
        {pvPct !== undefined && !stale && (
          <span className="kpi-pointer tile-pointer" style={{ left: `${pvPct}%` }} />
        )}
      </div>
      <div className="kpi-spark"><Sparkline tag={name} limit={band?.hi} scale={scale} /></div>
      <footer className="kpi-foot">
        <span>{v ? t('state.updated', { age: fmtAge(v.ts, now) }) : t('state.never')}</span>
        {hiDisp !== undefined && <span>{t('overview.limit', { v: `${hiDisp} ${meta.unit ?? ''}`.trim() })}</span>}
        <QualityMark q={v?.q} stale={stale && !!v} />
      </footer>
    </article>
  );
}
