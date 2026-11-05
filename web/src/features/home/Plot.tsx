// Panel bodies for time-series panels: line / area / bars with crosshair,
// tooltip, keyboard read-out, thresholds and legend; the big number; and the
// table view every chart offers. Geometry comes from ./chart (SVG paths in a
// stretched 1000×1000 box, HTML for bars, labels and the tooltip).

import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../trends/viz';
import {
  aggOf, areaPath, colorOf, fmtTime, domainOf, isStatus, linePath, pctOf, sortedSteps, tickDecimals, ticksOf, thToken,
  type Bucketed, type Theme, type Thresholds,
} from './chart';
import type { Panel } from './model';
import type { SrcInfo, Win } from './data';

export interface Series { info: SrcInfo; color: string; token: string; hidden: boolean; cur: Bucketed; prev: Bucketed }

const GLYPH: Record<string, string> = { ok: '✓', warn: '◆', crit: '▲', info: '●' };
const WORD: Record<string, string> = { ok: 'stNormal', warn: 'stWarning', crit: 'stCritical', info: 'stInfo' };

const withUnit = (v: string, unit: string) => (unit ? `${v} ${unit}` : v);

export function PlotBody({ p, series, th, win, theme, onLegend }: {
  p: Panel; series: Series[]; th: Thresholds | null; win: Win; theme: Theme;
  onLegend: (src: string, toggle: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [hov, setHov] = useState<number | null>(null);
  const isBars = p.viz === 'bars';
  const vis = series.filter((s) => !s.hidden);
  const n = series[0]?.cur.length ?? 0;
  const unit = p.unit || series[0]?.info.unit || '';
  const dec = p.dec ?? series[0]?.info.dec ?? 1;
  const fmt = (v: number | null | undefined) => fmtNum(v, dec, i18n.language);

  const sums = isBars ? Array.from({ length: n }, (_, i) => vis.reduce((a, s) => a + (s.cur[i] ?? 0), 0)) : [];
  const d = domainOf(isBars ? sums : vis.flatMap((s) => s.cur), p.yMin, p.yMax, isBars);
  const span = d[1] - d[0];
  const ticks = ticksOf(d);
  const tdec = tickDecimals(d);
  const timeAt = (i: number) => win.from + ((i + 0.5) / n) * (win.to - win.from);
  const xOf = (i: number) => (isBars ? ((i + 0.5) / n) * 100 : n === 1 ? 50 : (i / (n - 1)) * 100);

  const steps = th && p.thStyle !== 'off' ? sortedSteps(th) : [];
  const bands: { top: number; h: number; bg: string }[] = [];
  if (th && p.thStyle === 'bands') {
    const toks = [th.base, ...steps.map((s) => s.c)];
    toks.forEach((tok, q) => {
      const lo = Math.max(d[0], q === 0 ? -Infinity : steps[q - 1].v);
      const hi = Math.min(d[1], q < steps.length ? steps[q].v : Infinity);
      if (hi > lo && tok !== 'ok') bands.push({ top: pctOf(d, hi), h: ((hi - lo) / span) * 100, bg: `color-mix(in srgb, ${colorOf(tok, theme)} 12%, transparent)` });
    });
  }

  const idx = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / Math.max(1, r.width);
    return Math.max(0, Math.min(n - 1, isBars ? Math.floor(fx * n) : Math.round(fx * (n - 1))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = hov ?? n - 1;
    const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'ArrowRight' ? Math.min(n - 1, i + 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    setHov(next);
  };
  const last = (s: Series) => [...s.cur].reverse().find((v) => v != null) ?? null;
  const aria = t('home.chartAria', {
    title: p.title, values: vis.map((s) => `${s.info.label} ${withUnit(fmt(isBars ? aggOf([s.cur], 'sum') : last(s)), unit)}`).join(', '),
  });
  const hx = hov != null ? xOf(hov) : 0;
  const ticksX = [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1];

  return (
    <div className={`hm-chart ${p.legend === 'right' ? 'lg-right' : ''}`}>
      <div className="hm-plotwrap">
        <div className="hm-yax" aria-hidden>
          {ticks.map((v) => <span key={v} className="hm-ytick" style={{ top: `${pctOf(d, v)}%` }}>{fmtNum(v, tdec, i18n.language)}</span>)}
        </div>
        <div className="hm-plot">
          {bands.map((b, i) => <div key={i} className="hm-band" style={{ top: `${b.top}%`, height: `${b.h}%`, background: b.bg }} />)}
          {ticks.map((v) => <div key={v} className="hm-gridline" style={{ top: `${pctOf(d, v)}%` }} />)}
          {!isBars && vis.map((s) => (
            <svg key={s.info.src} className="hm-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
              {(p.viz === 'area' || p.fill > 0) && <path className="hm-area" d={areaPath(s.cur, d, p.curve)} style={{ fill: s.color, fillOpacity: p.fill / 100 }} />}
              <path className="hm-line" d={linePath(s.cur, d, p.curve)} style={{ stroke: s.color, strokeWidth: p.lineWidth }} />
            </svg>
          ))}
          {isBars && (
            <div className="hm-bars" aria-hidden>
              {Array.from({ length: n }, (_, i) => {
                const segs = vis.map((s) => ({ v: s.cur[i] ?? 0, c: s.color })).filter((x) => x.v > 0);
                return (
                  <div key={i} className={`hm-bcol ${hov === i ? 'hl' : ''}`}>
                    {segs.map((sg, k) => (
                      <div key={k} className="hm-bseg" style={{ height: `${(sg.v / span) * 100}%`, background: sg.c, borderRadius: k === segs.length - 1 ? '3px 3px 0 0' : 0 }} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {p.points && !isBars && vis.flatMap((s) => s.cur.map((v, i) => v == null ? null : (
            <span key={`${s.info.src}${i}`} className="hm-pdot" style={{ left: `${xOf(i)}%`, top: `${pctOf(d, v)}%`, background: s.color }} />
          )))}
          {steps.filter((s) => s.v > d[0] && s.v < d[1]).map((s) => (
            <div key={s.v} className="hm-th" style={{ top: `${pctOf(d, s.v)}%`, borderColor: colorOf(s.c, theme) }}>
              <span>{withUnit(fmt(s.v), unit)}</span>
            </div>
          ))}
          {hov != null && vis.length > 0 && (
            <>
              {!isBars && <div className="hm-xhair" style={{ left: `${hx}%` }} />}
              {!isBars && vis.map((s) => s.cur[hov] == null ? null : (
                <span key={s.info.src} className="hm-hdot" style={{ left: `${hx}%`, top: `${pctOf(d, s.cur[hov]!)}%`, background: s.color }} />
              ))}
              <div className="hm-tt" style={hx < 55 ? { left: `calc(${hx}% + 14px)` } : { right: `calc(${100 - hx}% + 14px)` }}>
                <div className="hm-tt-time">{fmtTime(timeAt(hov), win.span, true, i18n.language)}</div>
                {vis.map((s) => (
                  <div key={s.info.src} className="hm-tt-row">
                    <span className="hm-key" style={{ background: s.color }} />
                    <span className="hm-tt-name">{s.info.label}</span>
                    <span className="hm-tt-val">{withUnit(fmt(s.cur[hov]), unit)}</span>
                  </div>
                ))}
                {isBars && vis.length > 1 && (
                  <div className="hm-tt-row"><span className="hm-key" /><span className="hm-tt-name">{t('home.total')}</span><span className="hm-tt-val">{withUnit(fmt(sums[hov]), unit)}</span></div>
                )}
              </div>
            </>
          )}
          <div
            className="hm-hit" tabIndex={0} role="img" aria-label={aria}
            onMouseMove={(e) => setHov(idx(e))} onMouseLeave={() => setHov(null)}
            onFocus={() => setHov(n - 1)} onBlur={() => setHov(null)} onKeyDown={onKey}
          />
        </div>
        <div className="hm-xax" aria-hidden>
          {ticksX.map((i, k) => (
            <span key={k} className="hm-xtick" style={{ left: `${xOf(i)}%`, transform: `translateX(${k === 0 ? '0' : k === ticksX.length - 1 ? '-100%' : '-50%'})` }}>
              {fmtTime(timeAt(i), win.span, false, i18n.language)}
            </span>
          ))}
        </div>
      </div>
      {p.legend !== 'hidden' && series.length > 1 && (
        <div className="hm-legend">
          {series.map((s) => (
            <button key={s.info.src} type="button" className={`hm-lg ${s.hidden ? 'off' : ''}`} aria-pressed={!s.hidden}
              title={t('home.isolateHint')} onClick={(e) => onLegend(s.info.src, e.ctrlKey || e.metaKey)}>
              <span className="hm-key" style={{ background: s.color }} />
              <span>{s.info.label}</span>
              <span className="hm-lg-val">{withUnit(fmt(isBars ? aggOf([s.cur], 'sum') : last(s)), unit)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatBody({ p, s, th, theme }: { p: Panel; s: Series; th: Thresholds | null; theme: Theme }) {
  const { t, i18n } = useTranslation();
  const unit = p.unit || s.info.unit;
  const dec = p.dec ?? s.info.dec;
  const val = aggOf([s.cur], p.agg);
  const tok = p.statColor === 'threshold' ? thToken(th, val) : p.statColor === 'fixed' ? p.statFixed : null;
  const mark = tok ? colorOf(tok, theme) : colorOf('info', theme);
  const sd = domainOf(s.cur, null, null, false);
  const steps = th ? sortedSteps(th) : [];
  let stTok = th?.base ?? null;
  let reached: number | null = null;
  for (const x of steps) if (val != null && val >= x.v) { stTok = x.c; reached = x.v; }
  const vals = s.cur.filter((v): v is number => v != null);
  const word = stTok ? t(`home.${WORD[stTok] ?? 'stInfo'}`) : '';
  const status = !th || val == null ? null
    : reached != null ? t('home.atOrAbove', { word, v: withUnit(fmtNum(reached, dec, i18n.language), unit) })
    : steps.length ? t('home.below', { word, v: withUnit(fmtNum(steps[0].v, dec, i18n.language), unit) }) : word;
  return (
    <div className="hm-stat" style={{ background: p.statBg === 'solid' ? `color-mix(in srgb, ${mark} 13%, var(--hm-panel))` : 'transparent' }}>
      {p.statBg !== 'none' && vals.length > 1 && (
        <svg className="hm-spark" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
          <path className="hm-area" d={areaPath(s.cur, sd, 'smooth')} style={{ fill: mark, fillOpacity: p.statBg === 'solid' ? 0.12 : 0.14 }} />
          <path className="hm-line" d={linePath(s.cur, sd, 'smooth')} style={{ stroke: mark, strokeOpacity: p.statBg === 'solid' ? 0.7 : 0.55, strokeWidth: 1.5 }} />
        </svg>
      )}
      {p.statBg !== 'none' && vals.length > 1 && (
        <>
          <span className="hm-smax">{withUnit(fmtNum(Math.max(...vals), dec, i18n.language), unit)}</span>
          <span className="hm-smin">{withUnit(fmtNum(Math.min(...vals), dec, i18n.language), unit)}</span>
        </>
      )}
      <div className="hm-sval" style={{ color: tok ? colorOf(tok, theme, true) : 'var(--hm-ink)', fontSize: p.statSize }}>
        <span>{fmtNum(val, dec, i18n.language)}</span><span className="hm-sunit">{unit}</span>
      </div>
      {status && stTok && (
        <div className="hm-sstatus">
          <span aria-hidden style={{ color: colorOf(isStatus(stTok) ? stTok : 'info', theme, true) }}>{GLYPH[stTok] ?? '●'}</span>
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}

export function TableBody({ p, series, win }: { p: Panel; series: Series[]; win: Win }) {
  const { t, i18n } = useTranslation();
  const vis = series.filter((s) => !s.hidden);
  const n = series[0]?.cur.length ?? 0;
  const unit = p.unit || series[0]?.info.unit || '';
  const dec = p.dec ?? series[0]?.info.dec ?? 1;
  const cols = { gridTemplateColumns: `96px repeat(${Math.max(1, vis.length)}, minmax(0, 1fr))` };
  const rows = Array.from({ length: Math.min(n, 30) }, (_, k) => n - 1 - k);
  return (
    <div className="hm-tbl" role="table" aria-label={t('home.values', { title: p.title })}>
      <div className="hm-tr th" role="row" style={cols}>
        <span className="hm-td" role="columnheader">{t('home.time')}</span>
        {vis.map((s) => <span key={s.info.src} className="hm-td r" role="columnheader">{s.info.label}{unit ? ` (${unit})` : ''}</span>)}
      </div>
      {rows.map((i) => (
        <div key={i} className="hm-tr" role="row" style={cols}>
          <span className="hm-td num" role="cell">{fmtTime(win.from + ((i + 0.5) / n) * (win.to - win.from), win.span, false, i18n.language)}</span>
          {vis.map((s) => <span key={s.info.src} className="hm-td r" role="cell">{fmtNum(s.cur[i], dec, i18n.language)}</span>)}
        </div>
      ))}
    </div>
  );
}
