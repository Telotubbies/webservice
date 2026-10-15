// Ambient field engine — the "Mission Surface" bottom tier (SDLC 20 §3.0,
// lit review 22 §5). A luminance-only isobar/contour field painted on a
// fullscreen canvas UNDER all content. It carries "important but not
// critical" state (Pousman & Stasko): open alarms tighten the contours
// locally, open insights add faint sources, stale/offline data stills the
// field, and an unacknowledged critical alarm freezes ALL motion.
//
// Calm-technology rules baked in (Abrams & Christ 2003 — motion *onset*
// captures attention, continuous drift does not):
//   - sources ease their amplitude over seconds — nothing ever pops;
//   - source positions drift slowly and continuously;
//   - `prefers-reduced-motion` OR the persisted "calm" toggle renders a
//     single static contour frame instead of an animation loop.
// Luminance channel only (Ware: contour channel carries pressure, never
// hue): all lines are the --text-muted grey at <= 8% alpha.

import { useSyncExternalStore } from 'react';
import { live } from '../../lib/live';
import { equipmentOf, type EquipmentId } from '../../lib/plant';
import { normSeverity } from '../../shared/ui/Status';

/* ------------------------------------------------------------------ */
/* calm mode — persisted preference; `.calm` on <html> + localStorage   */
/* ------------------------------------------------------------------ */

const CALM_KEY = 'wds.calm';
let calmOn = false;
try {
  calmOn = localStorage.getItem(CALM_KEY) === '1';
} catch { /* storage blocked — calm stays off */ }
document.documentElement.classList.toggle('calm', calmOn);

const calmSubs = new Set<() => void>();
const emitCalm = () => calmSubs.forEach((f) => f());

export function isCalm(): boolean {
  return calmOn;
}

export function setCalm(on: boolean): void {
  if (calmOn === on) return;
  calmOn = on;
  try {
    localStorage.setItem(CALM_KEY, on ? '1' : '0');
  } catch { /* storage blocked — class-only for this session */ }
  document.documentElement.classList.toggle('calm', on);
  emitCalm();
}

function subscribeCalm(fn: () => void): () => void {
  calmSubs.add(fn);
  return () => calmSubs.delete(fn);
}

/** React binding for the calm preference (topbar toggle, engine). */
export function useCalm(): boolean {
  return useSyncExternalStore(subscribeCalm, isCalm, () => false);
}

/* ------------------------------------------------------------------ */
/* field model                                                        */
/* ------------------------------------------------------------------ */

const CELL = 18;            // field node spacing, css px
const LEVELS = [0.46, 0.58, 0.7, 0.82, 0.94];      // iso thresholds
const ALPHAS = [0.035, 0.045, 0.055, 0.065, 0.078]; // <= ~8% — under the 10% cap
const EASE_TAU = 2.6;       // s — amplitudes ease in, no discrete onsets
const DRIFT = 0.024;        // normalized orbit radius of a source around its anchor

/** Normalized viewport anchors, roughly under the hero schematic's
 *  equipment positions — ambient, not cartographic. */
const EQUIP_ANCHOR: Record<EquipmentId, [number, number]> = {
  motor: [0.16, 0.40],
  conveyor: [0.44, 0.42],
  camera: [0.48, 0.26],
  bin: [0.72, 0.38],
};

interface Source {
  key: string;
  ax: number; ay: number;  // anchor (normalized 0..1)
  radius: number;          // eased normalized falloff radius
  radiusT: number;         // target radius
  amp: number;             // eased amplitude
  target: number;
  phase: number;           // drift phase offset
  spin: number;            // drift angular speed (rad/s) — very slow
}

interface Desired {
  x: number; y: number; amp: number; radius: number;
}

function hash(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return h;
}

/** Unmapped tags get a deterministic home in the mid-field band. */
function anchorOf(tag: string): [number, number] {
  const eq = equipmentOf(tag);
  if (eq) return EQUIP_ANCHOR[eq];
  const h = hash(tag);
  return [0.2 + ((h % 100) / 100) * 0.6, 0.25 + (((h >> 8) % 100) / 100) * 0.4];
}

/** The pattern the field should currently show — derived from live state.
 *  Two faint "breather" sources keep the field alive when the plant is
 *  quiet; open alarms/insights add pressure at their equipment anchor. */
function desiredSources(): Map<string, Desired> {
  const d = new Map<string, Desired>();
  d.set('drift-w', { x: 0.30, y: 0.58, amp: 0.16, radius: 0.34 });
  d.set('drift-e', { x: 0.68, y: 0.30, amp: 0.13, radius: 0.30 });
  const bump = (tag: string, amp: number, radius: number) => {
    const key = equipmentOf(tag) ?? `tag:${tag}`;
    const prev = d.get(key);
    if (prev) {
      // several open items on one anchor: keep the max + a small stack
      prev.amp = Math.min(0.95, Math.max(prev.amp, amp) + 0.06);
      return;
    }
    const [x, y] = anchorOf(tag);
    d.set(key, { x, y, amp, radius });
  };
  for (const a of live.alarms) {
    if (a.state === 'cleared') continue;
    const sev = normSeverity(a.severity);
    bump(a.tag, sev === 'critical' ? 0.8 : sev === 'warning' ? 0.5 : 0.3, 0.2);
  }
  for (const i of live.insights) {
    if (i.state !== 'open') continue;
    bump(i.tag, i.severity === 'warning' ? 0.38 : 0.3, 0.15);
  }
  return d;
}

/** Motion gate — the only states that may animate. Anything abnormal that
 *  demands foreground attention (unacked critical) or a silent data path
 *  freezes the field entirely; it still repaints on state change. */
function frozen(): boolean {
  if (live.alarms.some(
    (a) => a.state === 'active' && normSeverity(a.severity) === 'critical',
  )) return true;
  if (live.ws !== 'open') return true;   // no live path -> field stills
  if (live.health?.edge === 'stale') return true;
  return false;
}

/** '#rrggbb' or 'rgb(r,g,b)' -> "r,g,b" for alpha composition. */
function rgbParts(v: string): string | null {
  const s = v.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const m = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/i.exec(s);
  return m ? `${m[1]},${m[2]},${m[3]}` : null;
}

/* ------------------------------------------------------------------ */
/* engine — mount on a <canvas>, returns a dispose function             */
/* ------------------------------------------------------------------ */

export function startAmbientField(
  canvas: HTMLCanvasElement,
  isStatic: () => boolean,
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  // hoist-safe: nested function declarations don't inherit the !ctx narrowing
  const g: CanvasRenderingContext2D = ctx;

  const sources = new Map<string, Source>();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const ink = rgbParts(
    getComputedStyle(document.documentElement).getPropertyValue('--text-muted'),
  ) ?? '128,133,141';

  let w = 0;
  let h = 0;
  let cols = 0;
  let rows = 0;
  let aspect = 1;
  let field = new Float32Array(0);
  let raf = 0;
  let t = 0;
  let last = 0;
  let disposed = false;
  let visible = !document.hidden;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.max(24, Math.round(w / CELL));
    rows = Math.max(24, Math.round(h / CELL));
    aspect = w / h;
    field = new Float32Array((cols + 1) * (rows + 1));
  }

  /** Sync the source set with live state — targets only. New sources start
   *  at amp 0 and ease in (never pop); departed sources fade to 0 first. */
  function syncSources() {
    const want = desiredSources();
    for (const [key, v] of want) {
      let s = sources.get(key);
      if (!s) {
        const hh = hash(key);
        s = {
          key, ax: v.x, ay: v.y, radius: v.radius, radiusT: v.radius,
          amp: 0, target: v.amp,
          phase: (hh % 628) / 100,
          spin: 0.035 + ((hh >> 6) % 40) / 1000, // 0.035–0.075 rad/s
        };
        sources.set(key, s);
      } else {
        s.target = v.amp;
        s.radiusT = v.radius;
      }
    }
    for (const [key, s] of sources) {
      if (!want.has(key)) {
        if (s.amp < 0.004) sources.delete(key);
        else s.target = 0;
      }
    }
  }

  /** One exponential-ease step toward targets (amp + radius). Repaint-mode
   *  calls this with dt≈1s so frozen/static state changes drift in over
   *  several repaints instead of popping in a single frame. */
  function easeAmps(dt: number) {
    const k = 1 - Math.exp(-dt / EASE_TAU);
    for (const s of sources.values()) {
      s.amp += (s.target - s.amp) * k;
      s.radius += (s.radiusT - s.radius) * k;
    }
  }

  function computeField() {
    const inv = 1 / Math.max(1, cols);
    const invY = 1 / Math.max(1, rows);
    for (let j = 0; j <= rows; j++) {
      const yn = j * invY;
      for (let i = 0; i <= cols; i++) {
        const xn = i * inv;
        // slow global base wave — keeps sparse faint contours alive
        let v = 0.3
          + 0.1 * Math.sin(xn * 5.1 + t * 0.1) * Math.cos(yn * 4.3 - t * 0.07)
          + 0.06 * Math.sin((xn + yn) * 7.7 + t * 0.05);
        for (const s of sources.values()) {
          const sx = s.ax + DRIFT * Math.sin(t * s.spin + s.phase);
          const sy = s.ay + DRIFT * 0.8 * Math.cos(t * s.spin * 0.9 + s.phase * 1.37);
          const dx = (xn - sx) * aspect;
          const dy = yn - sy;
          const d2 = dx * dx + dy * dy;
          const r2 = s.radius * s.radius;
          const amp = s.amp * (0.9 + 0.1 * Math.sin(t * 0.16 + s.phase * 2.1));
          v += amp * (r2 / (r2 + d2));
        }
        field[j * (cols + 1) + i] = v;
      }
    }
  }

  /** Marching squares for one iso level into a Path2D. */
  function trace(level: number): Path2D {
    const path = new Path2D();
    const cw = w / cols;
    const ch = h / rows;
    const stride = cols + 1;
    const at = (i: number, j: number) => field[j * stride + i];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tl = at(i, j);
        const tr = at(i + 1, j);
        const br = at(i + 1, j + 1);
        const bl = at(i, j + 1);
        const idx = (tl > level ? 1 : 0) | (tr > level ? 2 : 0)
          | (br > level ? 4 : 0) | (bl > level ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const x = i * cw;
        const y = j * ch;
        const lerp = (a: number, b: number) => (level - a) / (b - a);
        // edge crossing points (fixed pixel coords)
        const top = (): [number, number] => [x + cw * lerp(tl, tr), y];
        const right = (): [number, number] => [x + cw, y + ch * lerp(tr, br)];
        const bottom = (): [number, number] => [x + cw * lerp(bl, br), y + ch];
        const left = (): [number, number] => [x, y + ch * lerp(tl, bl)];
        const seg = (p: [number, number], q: [number, number]) => {
          path.moveTo(p[0], p[1]);
          path.lineTo(q[0], q[1]);
        };
        switch (idx) {
          case 1: case 14: seg(left(), top()); break;
          case 2: case 13: seg(top(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(right(), bottom()); break;
          case 5: seg(left(), top()); seg(right(), bottom()); break;
          case 6: case 9: seg(top(), bottom()); break;
          case 7: case 8: seg(left(), bottom()); break;
          case 10: seg(top(), right()); seg(left(), bottom()); break;
        }
      }
    }
    return path;
  }

  function draw() {
    g.clearRect(0, 0, w, h);
    computeField();
    g.lineWidth = 1;
    for (let l = 0; l < LEVELS.length; l++) {
      g.strokeStyle = `rgba(${ink},${ALPHAS[l]})`;
      g.stroke(trace(LEVELS[l]));
    }
  }

  /* -------------------------------------------------------------- */
  /* scheduling — animate only when wanted; otherwise repaint once     */
  /* -------------------------------------------------------------- */

  const staticMode = () => isStatic() || media.matches;
  // a fixed inset:0 canvas is always in view — tab visibility is the only
  // gate that matters (visibilitychange), so no IntersectionObserver here
  const wantAnim = () => !disposed && visible && !staticMode() && !frozen();

  function schedule() {
    if (!raf && wantAnim()) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  function step(now: number) {
    raf = 0;
    if (!wantAnim()) { drawStatic(); return; }
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    t += dt;
    syncSources();
    easeAmps(dt);
    draw();
    schedule();
  }

  function drawStatic() {
    syncSources();
    easeAmps(1); // ~1s of easing per repaint — state changes drift in
    draw();
  }

  /** Any relevant change → either (re)start the loop or repaint one frame. */
  function refresh() {
    if (disposed || !visible) return;
    if (wantAnim()) schedule();
    else {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      drawStatic();
    }
  }

  const unLive = live.subscribe(refresh);
  const onVis = () => { visible = !document.hidden; refresh(); };
  const onResize = () => { resize(); refresh(); };
  const onMedia = () => refresh();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', onResize);
  media.addEventListener('change', onMedia);

  resize();
  drawStatic();   // first frame paints immediately (static), then drifts in
  refresh();

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    unLive();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
    media.removeEventListener('change', onMedia);
  };
}
