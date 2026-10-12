// Canvas host for the /line3d twin (doc 20 §3.2). Lifecycle contract:
//  - probe WebGL BEFORE constructing the renderer (three logs console errors
//    on context failure — the UAT zero-console-error gate must hold under
//    headless SwiftShader too); failure → silent <LineSchematic compact>.
//  - live.subscribe → applyState(view) → render on demand; the rAF loop only
//    draws when the camera moved, a flush invalidated, or motion is active.
//  - full dispose on unmount: geometries/materials/textures/renderer,
//    controls, canvas, subscription, rAF, observers — StrictMode-safe.
//  - HTML labels are projected camera→DOM each rendered frame, reusing the
//    .readout classes (≥12px floor stands; values stay 2D per doc 22 §6).

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { SIGNALS, T, bubbleCode, formatSignal, type EquipmentId } from '../../lib/plant';
import { Icon } from '../../shared/ui/Icon';
import { LineSchematic } from '../line/LineSchematic';
import { applyState, buildScene, type LineSceneView } from './scene';
import '../line/line.css';
import './line3d.css';

/** Probe support on a throwaway canvas — never logs. */
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const LABEL_DEFS: { anchor: string; eq: EquipmentId; tag: string; state?: boolean }[] = [
  { anchor: 'motor-state', eq: 'motor', tag: T.running, state: true },
  { anchor: 'speed-sp', eq: 'motor', tag: T.speedSp },
  { anchor: 'belt-speed', eq: 'conveyor', tag: T.beltSpeed },
  { anchor: 'belt-temp', eq: 'conveyor', tag: T.beltTemp },
  { anchor: 'gravel', eq: 'camera', tag: T.gravel },
  { anchor: 'bin-level', eq: 'bin', tag: T.binLevel },
];

function Bubble({ tag }: { tag: string }) {
  const [fn, num] = bubbleCode(tag).split('-');
  return (
    <span className="readout-bubble" aria-hidden>
      <b className="bubble-fn">{fn}</b>
      <i className="bubble-num">{num}</i>
    </span>
  );
}

/** One HTML readout, positioned imperatively at a world anchor each frame. */
function LineLabel({ def, onPick }: {
  def: (typeof LABEL_DEFS)[number];
  onPick?: (id: EquipmentId) => void;
}) {
  const { t, i18n } = useTranslation();
  useStore(() => live.version);
  useStore(() => live.insightRev);
  const now = useNow(1000);
  const v = live.latest.get(def.tag);
  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
  const meta = SIGNALS[def.tag];
  const alarm = live.alarms.some((a) => a.tag === def.tag && a.state !== 'cleared');
  const anomaly = live.insights.some((i) => i.tag === def.tag && i.state === 'open');
  const running = !stale && v?.v === true;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(def.eq); }
  };
  return (
    <div
      className={`readout line3d-readout${stale ? ' is-stale' : ''}${alarm ? ' is-alarm' : ''}${anomaly ? ' is-anomaly' : ''}`}
      data-anchor={def.anchor}
      data-equipment={def.eq}
      data-signal={def.tag}
      role="button"
      tabIndex={0}
      aria-label={t(`line.${def.eq}`)}
      onClick={() => onPick?.(def.eq)}
      onKeyDown={onKey}
    >
      <span className="readout-head">
        <Bubble tag={def.tag} />
        <span className="readout-label">
          {t(meta?.labelKey ?? def.tag)}
          {meta?.stub && <span className="badge badge-stub" title={t('overview.stubTitle')}>{t('overview.stub')}</span>}
        </span>
      </span>
      {def.state ? (
        <span className={`state state-${stale ? 'stale' : running ? 'running' : 'stopped'}`}>
          <span className="glyph" aria-hidden />
          {t(`state.${stale ? 'stale' : running ? 'running' : 'stopped'}`)}
        </span>
      ) : (
        <span className="readout-value">
          {stale ? t('state.stale') : formatSignal(def.tag, v?.v, i18n.language)}
          {!stale && meta?.unit && <span className="readout-unit">{meta.unit}</span>}
        </span>
      )}
    </div>
  );
}

export function LineScene({ selected, onSelect }: {
  selected?: EquipmentId | null;
  onSelect?: (id: EquipmentId | null) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<LineSceneView | null>(null);
  const selRef = useRef<EquipmentId | null>(selected ?? null);
  const selectRef = useRef(onSelect);
  selRef.current = selected ?? null;
  selectRef.current = onSelect;
  const [supported] = useState(webglAvailable);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const host = hostRef.current;
    if (!host) return;
    let dead = false;

    const canvas = document.createElement('canvas');
    canvas.className = 'line3d-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('line3d.canvasLabel'));
    host.appendChild(canvas);
    const view = buildScene(canvas);
    viewRef.current = view;
    view.setSize(host.clientWidth, host.clientHeight);

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    /** project world anchors → DOM label positions after each render */
    const projectLabels = () => {
      const layer = labelsRef.current;
      if (!layer) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (const el of layer.querySelectorAll<HTMLElement>('[data-anchor]')) {
        const a = view.anchors[el.dataset.anchor ?? ''];
        if (!a) continue;
        const proj = a.clone().project(view.camera);
        el.style.left = `${((proj.x * 0.5 + 0.5) * w).toFixed(1)}px`;
        el.style.top = `${((-proj.y * 0.5 + 0.5) * h).toFixed(1)}px`;
      }
    };
    const render = () => {
      view.renderer.render(view.scene, view.camera);
      projectLabels();
    };

    let raf = 0;
    let last = performance.now();
    const loop = (nowMs: number) => {
      if (dead) return;
      const dt = Math.min(100, nowMs - last);
      last = nowMs;
      if (view.tick(dt)) render();
      raf = requestAnimationFrame(loop);
    };

    const apply = () => applyState(view, live, { selected: selRef.current, reduceMotion: reduced.matches });
    const unsub = live.subscribe(apply);
    const onReduced = () => apply();
    reduced.addEventListener('change', onReduced);

    const ro = new ResizeObserver(() => {
      view.setSize(host.clientWidth, host.clientHeight);
    });
    ro.observe(host);

    // click (not orbit-drag) → raycast pick; empty floor clears selection
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const dx = e.clientX - downAt[0];
      const dy = e.clientY - downAt[1];
      downAt = null;
      if (dx * dx + dy * dy > 36) return;          // it was a drag
      const id = view.pick(e.clientX, e.clientY);
      if (id || selRef.current) selectRef.current?.(id);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    const destroy = () => {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      reduced.removeEventListener('change', onReduced);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('webglcontextlost', onLost);
      viewRef.current = null;
      view.dispose();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      destroy();                                    // silent — context loss is
      setLost(true);                                // environmental, not an error
    };
    canvas.addEventListener('webglcontextlost', onLost);

    apply();
    raf = requestAnimationFrame(loop);
    return destroy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // selection lives in the URL — re-apply without waiting for a store flush
  useEffect(() => {
    viewRef.current?.invalidate();
    const v = viewRef.current;
    if (v) applyState(v, live, {
      selected: selected ?? null,
      reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }, [selected]);

  if (!supported || lost) {
    return (
      <div className="line3d line3d-fallback">
        <LineSchematic compact selected={selected ?? null} onSelect={(id) => onSelect?.(id)} />
      </div>
    );
  }
  return (
    <div className="line3d">
      <div className="line3d-stage" ref={hostRef} />
      <div className="line3d-labels" ref={labelsRef}>
        {LABEL_DEFS.map((d) => <LineLabel key={d.anchor} def={d} onPick={(id) => onSelect?.(id)} />)}
      </div>
      <button
        type="button"
        className="icon-btn line3d-reset"
        onClick={() => viewRef.current?.resetView()}
        aria-label={t('line3d.resetView')}
        title={t('line3d.resetView')}
      >
        <Icon name="refresh" size={16} />
      </button>
      <p className="line3d-hint">{t('line3d.selectHint')}</p>
    </div>
  );
}
