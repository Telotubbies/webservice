// MetricTile — analog panel-meter tile (spec §3.3-A, industrial gauge):
// a 240° SVG arc with major+minor ticks auto-derived from the tag's display
// range, a raised-neutral normal zone between configured lo/hi alarm edges,
// red arc segments out of them, a crisp needle that SNAPS to the PV (PVs
// never tween — motion grammar, SDLC 20 §3.0), a hub cap, an SP diamond on
// writable signals, the digital PV + unit under the dial, and a sparkline.
// Stale data parks the needle below scale and shows "—".
// Keeps the .tile contract the UAT asserts on: article.kpi.tile, .kpi-head,
// .kpi-value.tile-val .num + .kpi-unit, .kpi-spark, .kpi-foot,
// .tile-stub-badge, data-signal.

import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { fmtAge } from '../../lib/format';
import { SIGNALS, T, displayNumber, formatSignal } from '../../lib/plant';
import { Sparkline } from '../../shared/ui/Sparkline';
import { normSeverity, QualityMark, SeverityBadge, type Severity } from '../../shared/ui/Status';
import { useFaceplate } from '../faceplate/FaceplateContext';

/** Alarm-zone edges for one tag, in raw units. `lo` = max lo/lolo, `hi` = min
 *  hi/hihi across enabled rules (see useLimits in OverviewPage). */
export interface TileBand {
  lo?: number;
  hi?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* ---- dial geometry (viewBox units) -------------------------------------
   240° sweep opening at the bottom — the classic panel-meter arc from the
   lower-left stop, over the crown, to the lower-right stop. Angle 0 = east,
   clockwise-positive (SVG y-down), so the scale runs 150° → 390°. */
const CX = 70, CY = 56, R = 46;
const A0 = 150, SWEEP = 240;
const ZONE_R = R;          // zone bands ride the scale radius
const TICK_OUT = R + 8;    // outer extent of a major tick

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.round((CX + r * Math.cos(a)) * 100) / 100,
          Math.round((CY + r * Math.sin(a)) * 100) / 100];
};

/** Arc segment on radius `r` from angle `a` to `b` (deg, a < b). */
function arcPath(r: number, a: number, b: number) {
  const [x1, y1] = polar(r, a);
  const [x2, y2] = polar(r, b);
  return `M${x1} ${y1} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const ang = (f: number) => A0 + f * SWEEP;

/** "Nice" major-tick step: ~4–6 majors across the span (1/2/5 × 10^n). */
function majorStep(span: number): number {
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n >= 7.5 ? 10 : n >= 3 ? 5 : n >= 1.5 ? 2 : 1) * mag;
}

/** Tapered needle polygon: sharp tip just under the zone band, short
 *  counterweight tail behind the hub. */
function needlePath(deg: number) {
  const tip = polar(R - 6, deg);
  const tail = polar(-13, deg);
  const s1 = polar(2.4, deg + 90);
  const s2 = polar(2.4, deg - 90);
  return `${tip} ${s1} ${tail} ${s2}`;
}

/** Small diamond set on the zone band — the writable signal's SP marker. */
function diamondPath(deg: number) {
  const [x, y] = polar(ZONE_R, deg);
  return `M${x} ${y - 3.4} L${x + 3.4} ${y} L${x} ${y + 3.4} L${x - 3.4} ${y} Z`;
}

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
  const frac = (raw: number) => clamp01((displayNumber(name, raw) - rMin) / span);
  const pvF = num === undefined ? undefined : clamp01((num - rMin) / span);
  const loF = band?.lo !== undefined ? frac(band.lo) : 0;
  const hiF = band?.hi !== undefined ? frac(band.hi) : 1;
  // ticks: majors on the nice step, minors at step/5 — auto from the range
  const step = majorStep(span);
  const minorStep = step / 5;
  const tickCount = Math.round(span / minorStep);
  const ticks: { deg: number; major: boolean }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const f = i / tickCount;
    ticks.push({ deg: ang(f), major: i % 5 === 0 });
  }
  // SP marker: only on writable numeric signals (speed_sp) — the tag's own
  // value is the setpoint, drawn as a diamond distinct from the PV needle.
  const writable =
    (live.tags.find((ti) => ti.name === name)?.writable ?? name === T.speedSp) &&
    typeof v?.v === 'number';
  // worst open alarm severity on this tag — the badge shows the real level,
  // not a hardcoded critical
  let alarmSev: Severity | null = null;
  for (const a of live.alarms) {
    if (a.tag !== name || a.state === 'cleared') continue;
    const s = normSeverity(a.severity);
    if (s === 'critical') { alarmSev = 'critical'; break; }
    if (s === 'warning' || alarmSev === null) alarmSev = s;
  }
  const inAlarm = alarmSev !== null;
  const anomaly = live.insights.some((i) => i.tag === name && i.state === 'open');
  const scale = name === T.gravel ? 100 : 1;
  const hiDisp = band?.hi !== undefined ? displayNumber(name, band.hi) : undefined;
  const pvText = stale ? '—' : formatSignal(name, v?.v, i18n.language);

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
        {alarmSev && <SeverityBadge severity={alarmSev} />}
      </header>
      <div className="kpi-gauge">
        <svg className="gauge" viewBox="0 0 140 92" role="img">
          <title>{`${t(meta.labelKey)}: ${pvText}${meta.unit ? ` ${meta.unit}` : ''}`}</title>
          {/* zone bands under the scale: alarm arcs out of the edges,
              the normal zone between them in raised-neutral steel */}
          {band?.lo !== undefined && loF > 0 && (
            <path className="gauge-zone gauge-zone-alarm" d={arcPath(ZONE_R, ang(0), ang(loF))} />
          )}
          {band?.hi !== undefined && hiF < 1 && (
            <path className="gauge-zone gauge-zone-alarm" d={arcPath(ZONE_R, ang(hiF), ang(1))} />
          )}
          <path className="gauge-zone gauge-zone-normal" d={arcPath(ZONE_R, ang(loF), ang(hiF))} />
          <path className="gauge-track" d={arcPath(R, A0, A0 + SWEEP)} />
          {ticks.map((tk, i) => {
            const [x1, y1] = polar(R + 1.5, tk.deg);
            const [x2, y2] = polar(tk.major ? TICK_OUT : R + 4.5, tk.deg);
            return (
              <line key={i} className={`gauge-tick${tk.major ? ' gauge-tick-major' : ''}`}
                    x1={x1} y1={y1} x2={x2} y2={y2} />
            );
          })}
          {writable && pvF !== undefined && !stale && (
            <path className="gauge-sp" d={diamondPath(ang(pvF))} />
          )}
          {/* de-energized rest: a stale PV parks the needle just below the
              lower-left stop — the dial never tweened, it simply snapped */}
          <polygon className="gauge-needle" points={needlePath(stale || pvF === undefined ? A0 - 7 : ang(pvF))} />
          <circle className="gauge-hub" cx={CX} cy={CY} r={4.5} />
        </svg>
      </div>
      <p className="kpi-value tile-val">
        <span className="num">{pvText}</span>
        {meta.unit && <span className="kpi-unit">{meta.unit}</span>}
      </p>
      <div className="kpi-spark"><Sparkline tag={name} limit={band?.hi} scale={scale} /></div>
      <footer className="kpi-foot">
        <span>{v ? t('state.updated', { age: fmtAge(v.ts, now) }) : t('state.never')}</span>
        {hiDisp !== undefined && <span>{t('overview.limit', { v: `${hiDisp} ${meta.unit ?? ''}`.trim() })}</span>}
        <QualityMark q={v?.q} stale={stale && !!v} />
      </footer>
    </article>
  );
}
