// Panel editor — Grafana-style options in a side drawer; every change is
// applied to the panel on the page as it is made. Lazy-loaded by HomePage.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import type { Limit } from '../trends/viz';
import { ALL_TOKENS, STATUS_TOKENS, colorOf, sortedSteps, type Theme, type Thresholds } from './chart';
import { MAX_SERIES, TS_VIZ, toggleSource, type Panel } from './model';
import { srcInfo, thresholdsOf } from './data';
import { Ico } from './icons';

type Patch = Partial<Panel> | ((p: Panel) => Partial<Panel>);

const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

function Seg<T extends string | number | null>({ opts, value, onPick, label }: {
  opts: [T, string][]; value: T; onPick: (v: T) => void; label: string;
}) {
  return (
    <div className="hm-seg" role="group" aria-label={label}>
      {opts.map(([v, l]) => <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>{l}</button>)}
    </div>
  );
}

function Swatches({ value, set, theme, onPick, label }: {
  value: string; set: readonly string[]; theme: Theme; onPick: (c: string) => void; label: (name: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {set.map((k) => (
        <button key={k} type="button" className="hm-sw" style={{ background: colorOf(k, theme) }}
          aria-label={label(t(`home.sw_${k}`))} aria-pressed={k === value} onClick={() => onPick(k)} />
      ))}
    </>
  );
}

/** Sources the editor offers: every tag, counters as "per bucket", alarm counts. */
function useCatalog(): string[] {
  useStore(() => live.tagRev);
  const tags = live.tags.map((x) => x.name).sort();
  const counters = tags.filter((n) => /(count|_total)$/.test(n)).map((n) => `delta:${n}`);
  return [...tags.map((n) => `tag:${n}`), ...counters, 'alarms:critical', 'alarms:warning', 'alarms:info'];
}

export default function Editor({ p, title, theme, limits, canReset, onPatch, onClose, onRemove, onReset }: {
  p: Panel; title: string; theme: Theme; limits: Map<string, Limit[]>; canReset: boolean;
  onPatch: (patch: Patch) => void; onClose: () => void; onRemove: () => void; onReset: () => void;
}) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, [p.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const isTs = TS_VIZ.includes(p.viz);
  const isStat = p.viz === 'stat';
  const isLine = p.viz === 'line' || p.viz === 'area';
  const isAxis = isLine || p.viz === 'bars';
  const unit0 = p.series[0] ? srcInfo(p.series[0].src, t).unit : null;
  const th = thresholdsOf(p, limits);
  const custom: Thresholds = p.thresholds ?? { base: 'ok', steps: [] };
  const setTh = (fn: (x: Thresholds) => void) => onPatch((q) => {
    const x: Thresholds = { base: (q.thresholds ?? custom).base, steps: (q.thresholds ?? custom).steps.map((s) => ({ ...s })) };
    fn(x);
    return { thresholds: x, thFromRules: false, thStyle: q.thStyle === 'off' && q.viz !== 'stat' ? 'lines' : q.thStyle };
  });
  const sw = (name: string) => t('home.customColor', { name });

  return (
    <aside className="hm-drawer" aria-label={t('home.editPanel')}>
      <div className="hm-dr-head">
        <div><div className="hm-dr-kicker">{t('home.editPanel')}. {t('home.editHint')}</div><div className="hm-dr-title">{title}</div></div>
        <button ref={first} type="button" className="hm-ib" aria-label={t('home.close')} onClick={onClose}><Ico name="x" /></button>
      </div>
      <div className="hm-dr-body">
        <fieldset className="hm-fs">
          <legend>{t('home.fsPanel')}</legend>
          <label className="hm-field">{t('home.fTitle')}
            <input className="hm-in" value={p.title || title} onChange={(e) => onPatch({ title: e.target.value })} />
          </label>
          <div className="hm-field"><span>{t('home.width')}</span>
            <Seg label={t('home.width')} value={p.cols} onPick={(cols) => onPatch({ cols })}
              opts={[[3, '3/12'], [4, '4/12'], [6, t('home.wHalf')], [8, '8/12'], [12, t('home.wFull')]]} />
          </div>
          <div className="hm-field"><span>{t('home.height')}</span>
            <Seg label={t('home.height')} value={p.h} onPick={(h) => onPatch({ h })}
              opts={[['S', t('home.hS')], ['M', t('home.hM')], ['L', t('home.hL')], ['XL', t('home.hXL')]]} />
          </div>
          <div className="hm-field"><span>{t('home.stripe')}</span>
            <Seg label={t('home.stripe')} value={p.stripe} onPick={(stripe) => onPatch({ stripe })}
              opts={[['auto', t('home.stripeAuto')], ['custom', t('home.stripeColor')], ['none', t('home.stripeNone')]]} />
            {p.stripe === 'custom' && (
              <div className="hm-sw-row">
                <Swatches value={p.stripeColor} set={ALL_TOKENS} theme={theme} onPick={(c) => onPatch({ stripeColor: c })} label={(n) => n} />
                <input className="hm-sw-custom" type="color" value={colorOf(p.stripeColor, theme)} aria-label={t('home.customStripe')}
                  onChange={(e) => onPatch({ stripeColor: e.target.value })} />
              </div>
            )}
            <p className="hm-hint">{t('home.stripeHint')}</p>
          </div>
        </fieldset>

        {isTs && (
          <>
            <fieldset className="hm-fs">
              <legend>{t('home.fsViz')}</legend>
              <div className="hm-viz">
                {([['line', 'vLine', 'line'], ['area', 'vArea', 'area'], ['bars', 'vBars', 'bars']] as const).map(([v, l, ic]) => (
                  <button key={v} type="button" aria-pressed={p.viz === v}
                    onClick={() => onPatch((q) => ({ viz: v, fill: v === 'area' && !q.fill ? 15 : q.fill, h: q.viz === 'stat' && q.h === 'S' ? 'M' : q.h }))}>
                    <Ico name={ic} size={18} />{t(`home.${l}`)}
                  </button>
                ))}
                <button type="button" aria-pressed={isStat}
                  onClick={() => onPatch((q) => ({ viz: 'stat', series: q.series.slice(0, 1), h: q.h === 'M' || q.h === 'L' ? 'S' : q.h }))}>
                  <span className="hm-viz-num" aria-hidden>42</span>{t('home.vStat')}
                </button>
              </div>
            </fieldset>

            <fieldset className="hm-fs">
              <legend>{t('home.fsSignals')}</legend>
              <p className="hm-hint">{isStat ? t('home.sigHintStat') : t('home.sigHintMany')}</p>
              <div className="hm-sigs">
                {catalog.map((src) => {
                  const info = srcInfo(src, t);
                  const on = p.series.some((s) => s.src === src);
                  const clash = !isStat && !on && unit0 != null && p.series.length > 0 && info.unit !== unit0;
                  const full = !isStat && !on && p.series.length >= MAX_SERIES;
                  const kind = src.startsWith('delta:') ? ` · ${t('home.srcCounter')}` : src.startsWith('alarms:') ? ` · ${t('home.srcAlarms')}` : '';
                  return (
                    <label key={src} className={`hm-sig ${clash || full ? 'dis' : ''}`}>
                      <input type="checkbox" checked={on} disabled={clash || full} onChange={() => onPatch((q) => toggleSource(q, src, (s) => srcInfo(s, t).unit))} />
                      <span className="hm-sig-name">{info.label}{kind}</span>
                      <span className="hm-sig-unit">{clash ? t('home.diffUnit', { unit: info.unit || '—' }) : full ? t('home.maxSeries') : info.unit}</span>
                      {info.tag && <span className="hm-sig-tag">{info.tag}</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="hm-fs">
              <legend>{t('home.fsColors')}</legend>
              {p.series.map((s) => {
                const info = srcInfo(s.src, t);
                const set = (patch: Partial<typeof s>) => onPatch((q) => ({ series: q.series.map((x) => (x.src === s.src ? { ...x, ...patch } : x)) }));
                return (
                  <div key={s.src} className="hm-ser">
                    <div className="hm-ser-head">
                      <span className="hm-key" style={{ background: colorOf(s.color, theme) }} />
                      <span className="grow">{info.label}</span>
                      <button type="button" className="hm-switch" aria-pressed={!s.hidden} onClick={() => set({ hidden: !s.hidden })}>
                        <span className="tr2" aria-hidden />{s.hidden ? t('home.hidden') : t('home.shown')}
                      </button>
                    </div>
                    <div className="hm-sw-row">
                      <Swatches value={s.color} set={ALL_TOKENS} theme={theme} onPick={(c) => set({ color: c })} label={(n) => `${info.label}: ${n}`} />
                      <span className="hm-sw-div" aria-hidden />
                      <input className="hm-sw-custom" type="color" value={colorOf(s.color, theme)} aria-label={sw(info.label)}
                        onChange={(e) => set({ color: e.target.value })} />
                    </div>
                  </div>
                );
              })}
              <p className="hm-hint">{t('home.colorsHint')}</p>
            </fieldset>
          </>
        )}

        {isLine && (
          <fieldset className="hm-fs">
            <legend>{t('home.fsStyle')}</legend>
            <label className="hm-field">{t('home.lineWidth')}
              <span className="hm-rng"><input type="range" min={1} max={5} step={0.5} value={p.lineWidth} onChange={(e) => onPatch({ lineWidth: +e.target.value })} /><span>{p.lineWidth} px</span></span>
            </label>
            <label className="hm-field">{t('home.fillOpacity')}
              <span className="hm-rng"><input type="range" min={0} max={50} step={1} value={p.fill} onChange={(e) => onPatch({ fill: +e.target.value })} /><span>{p.fill}%</span></span>
            </label>
            <div className="hm-field"><span>{t('home.lineShape')}</span>
              <Seg label={t('home.lineShape')} value={p.curve} onPick={(curve) => onPatch({ curve })}
                opts={[['linear', t('home.cStraight')], ['smooth', t('home.cSmooth')], ['step', t('home.cStep')]]} />
            </div>
            <button type="button" className="hm-switch" aria-pressed={p.points} onClick={() => onPatch({ points: !p.points })}>
              <span className="tr2" aria-hidden />{t('home.showPoints')}
            </button>
          </fieldset>
        )}

        {isAxis && (
          <>
            <fieldset className="hm-fs">
              <legend>{t('home.fsAxis')}</legend>
              <div className="hm-row2">
                <label className="hm-field">{t('home.yMin')}
                  <input className="hm-in" inputMode="decimal" placeholder={t('home.auto')} value={p.yMinS ?? (p.yMin == null ? '' : String(p.yMin))}
                    onChange={(e) => onPatch({ yMinS: e.target.value, yMin: numOrNull(e.target.value) })} />
                </label>
                <label className="hm-field">{t('home.yMax')}
                  <input className="hm-in" inputMode="decimal" placeholder={t('home.auto')} value={p.yMaxS ?? (p.yMax == null ? '' : String(p.yMax))}
                    onChange={(e) => onPatch({ yMaxS: e.target.value, yMax: numOrNull(e.target.value) })} />
                </label>
              </div>
              <UnitDec p={p} unit0={unit0} onPatch={onPatch} />
            </fieldset>
            <fieldset className="hm-fs">
              <legend>{t('home.fsHeader')}</legend>
              <div className="hm-field"><span>{t('home.headerValue')}</span>
                <Seg label={t('home.headerValue')} value={p.header} onPick={(header) => onPatch({ header })}
                  opts={[['none', t('home.hNone')], ['single', t('home.hSingle')], ['perSeries', t('home.hPer')]]} />
              </div>
              <AggSeg p={p} onPatch={onPatch} />
              <div className="hm-field"><span>{t('home.legend')}</span>
                <Seg label={t('home.legend')} value={p.legend} onPick={(legend) => onPatch({ legend })}
                  opts={[['bottom', t('home.lBottom')], ['right', t('home.lRight')], ['hidden', t('home.lHidden')]]} />
                <p className="hm-hint">{t('home.legendHint')}</p>
              </div>
            </fieldset>
          </>
        )}

        {isStat && (
          <fieldset className="hm-fs">
            <legend>{t('home.fsStat')}</legend>
            <label className="hm-field">{t('home.valueSize')}
              <span className="hm-rng"><input type="range" min={32} max={120} step={2} value={p.statSize} onChange={(e) => onPatch({ statSize: +e.target.value })} /><span>{p.statSize} px</span></span>
            </label>
            <div className="hm-field"><span>{t('home.color')}</span>
              <Seg label={t('home.color')} value={p.statColor} onPick={(statColor) => onPatch({ statColor })}
                opts={[['threshold', t('home.cThreshold')], ['fixed', t('home.cFixed')], ['none', t('home.cInk')]]} />
              {p.statColor === 'fixed' && (
                <div className="hm-sw-row">
                  <Swatches value={p.statFixed} set={ALL_TOKENS} theme={theme} onPick={(c) => onPatch({ statFixed: c })} label={(n) => n} />
                  <input className="hm-sw-custom" type="color" value={colorOf(p.statFixed, theme)} aria-label={t('home.customNumber')}
                    onChange={(e) => onPatch({ statFixed: e.target.value })} />
                </div>
              )}
            </div>
            <div className="hm-field"><span>{t('home.background')}</span>
              <Seg label={t('home.background')} value={p.statBg} onPick={(statBg) => onPatch({ statBg })}
                opts={[['sparkline', t('home.bgSpark')], ['solid', t('home.bgSolid')], ['none', t('home.bgNone')]]} />
            </div>
            <AggSeg p={p} onPatch={onPatch} />
            <UnitDec p={p} unit0={unit0} onPatch={onPatch} />
          </fieldset>
        )}

        {isTs && (
          <fieldset className="hm-fs">
            <legend>{t('home.fsThresholds')}</legend>
            <div className="hm-field"><span>{t('home.thSource')}</span>
              <Seg label={t('home.thSource')} value={p.thFromRules ? 'rules' : 'custom'}
                onPick={(v) => onPatch((q) => (v === 'rules' ? { thFromRules: true } : { thFromRules: false, thresholds: q.thresholds ?? th ?? null }))}
                opts={[['rules', t('home.thRules')], ['custom', t('home.thCustom')]]} />
              {p.thFromRules && !th && <p className="hm-hint">{t('home.thRulesNone')}</p>}
            </div>
            {!isStat && (
              <div className="hm-field"><span>{t('home.thShow')}</span>
                <Seg label={t('home.thShow')} value={p.thStyle} onPick={(thStyle) => onPatch({ thStyle })}
                  opts={[['off', t('home.thOff')], ['lines', t('home.thLines')], ['bands', t('home.thBands')]]} />
              </div>
            )}
            {!p.thFromRules && (
              <>
                <div className="hm-th-row"><span className="hm-th-base">{t('home.thBase')}</span>
                  <div className="hm-sw-row"><Swatches value={custom.base} set={STATUS_TOKENS} theme={theme} onPick={(c) => setTh((x) => { x.base = c; })} label={(n) => `${t('home.thBase')}: ${n}`} /></div>
                </div>
                {custom.steps.map((s, i) => (
                  <div key={i} className="hm-th-row">
                    <input className="hm-in" inputMode="decimal" aria-label={t('home.thValue', { n: i + 1 })} value={s.s ?? String(s.v)}
                      onChange={(e) => { const raw = e.target.value; const v = numOrNull(raw); setTh((x) => { x.steps[i].s = raw; if (v != null) x.steps[i].v = v; }); }} />
                    <div className="hm-sw-row"><Swatches value={s.c} set={STATUS_TOKENS} theme={theme} onPick={(c) => setTh((x) => { x.steps[i].c = c; })} label={(n) => `${t('home.thStep', { n: i + 1 })}: ${n}`} /></div>
                    <button type="button" className="hm-ib" aria-label={t('home.thRemove', { n: i + 1 })} onClick={() => setTh((x) => { x.steps.splice(i, 1); })}><Ico name="x" size={14} /></button>
                  </div>
                ))}
                <button type="button" className="hm-btn sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setTh((x) => {
                    const top = x.steps.length ? sortedSteps(x).slice(-1)[0].v : null;
                    x.steps.push({ v: top != null ? Math.round(top + Math.max(1, Math.abs(top) * 0.1)) : 0, c: x.steps.length ? 'crit' : 'warn' });
                  })}>
                  <Ico name="plus" size={14} />{t('home.thAdd')}
                </button>
              </>
            )}
            <p className="hm-hint">{isStat ? t('home.thHintStat') : t('home.thHint')}</p>
          </fieldset>
        )}

        {p.viz === 'top' && (
          <fieldset className="hm-fs">
            <legend>{t('home.fsBar')}</legend>
            <div className="hm-sw-row">
              <Swatches value={p.barColor} set={ALL_TOKENS} theme={theme} onPick={(c) => onPatch({ barColor: c })} label={(n) => n} />
              <span className="hm-sw-div" aria-hidden />
              <input className="hm-sw-custom" type="color" value={colorOf(p.barColor, theme)} aria-label={t('home.customBar')} onChange={(e) => onPatch({ barColor: e.target.value })} />
            </div>
          </fieldset>
        )}
      </div>
      <div className="hm-dr-foot">
        <button type="button" className="hm-btn ghost danger" onClick={onRemove}>{t('home.removePanel')}</button>
        <span className="grow" />
        <button type="button" className="hm-btn" disabled={!canReset} onClick={onReset}>{t('home.resetPanel')}</button>
        <button type="button" className="hm-btn primary" onClick={onClose}>{t('home.done')}</button>
      </div>
    </aside>
  );
}

function UnitDec({ p, unit0, onPatch }: { p: Panel; unit0: string | null; onPatch: (x: Patch) => void }) {
  const { t } = useTranslation();
  return (
    <div className="hm-row2">
      <label className="hm-field">{t('home.unit')}
        <input className="hm-in" placeholder={unit0 || t('home.unit')} value={p.unit} onChange={(e) => onPatch({ unit: e.target.value })} />
      </label>
      <div className="hm-field"><span>{t('home.decimals')}</span>
        <Seg label={t('home.decimals')} value={p.dec} onPick={(dec) => onPatch({ dec })}
          opts={[[null, t('home.auto')], [0, '0'], [1, '0.0'], [2, '0.00']]} />
      </div>
    </div>
  );
}

function AggSeg({ p, onPatch }: { p: Panel; onPatch: (x: Patch) => void }) {
  const { t } = useTranslation();
  return (
    <div className="hm-field"><span>{t('home.calc')}</span>
      <Seg label={t('home.calc')} value={p.agg} onPick={(agg) => onPatch({ agg })}
        opts={[['last', t('home.aLast')], ['avg', t('home.aAvg')], ['sum', t('home.aSum')], ['max', t('home.aMax')]]} />
    </div>
  );
}
