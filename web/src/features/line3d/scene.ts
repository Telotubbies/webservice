// Isometric three.js twin of sorting line 1 (motor → conveyor → vision
// camera → gravel bin) — SUPPLEMENTARY to the 2D mimic (doc 20 §3.2).
// Vanilla three only, bound imperatively to LiveStore: `applyState` mutates
// meshes on each store flush; the host renders on demand — no reconciler.
//
// Evidence rules (doc 22 §6): 3D carries WHERE (spatial layout + state
// glows); quantities stay in the 2D HTML labels. State = shade + cyan
// emissive; hue only for abnormal (severity under-glow, AI halo, selection
// edge). Machines sit on contact-shadow decals + fog — iso drawings read
// flat without depth cues.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EQUIPMENT, T, type EquipmentId } from '../../lib/plant';
import { STALE_MS, live } from '../../lib/live';
import { normSeverity } from '../../shared/ui/Status';

export interface ApplyOpts {
  selected?: EquipmentId | null;
  reduceMotion?: boolean;
}

interface EquipRefs {
  id: EquipmentId;
  root: THREE.Group;
  /** shade-coded driven body materials (empty for uninstrumented camera) */
  driven: THREE.MeshStandardMaterial[];
  /** cyan "live" strip, shown while the line runs */
  strip: THREE.MeshBasicMaterial | null;
  glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.LineSegments;
  alarmSev: 'critical' | 'warning' | null;
  alarmPulse: boolean;
}

export interface LineSceneView {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  /** HTML label anchors: label id → world position */
  anchors: Record<string, THREE.Vector3>;
  pick(clientX: number, clientY: number): EquipmentId | null;
  resetView(): void;
  setSize(w: number, h: number): void;
  invalidate(): void;
  /** advance time-based motion; true while continuous rendering is needed */
  tick(dtMs: number): boolean;
  dispose(): void;
}

/** Label ids must match `data-anchor` on the DOM readouts in LineScene. */
export const LABEL_IDS = [
  'motor-state', 'speed-sp', 'belt-speed', 'belt-temp', 'gravel', 'bin-level',
] as const;

/* ------------------------------------------------------------------ */
/* palette — read tokens at runtime so the 3D surface follows the theme  */
/* ------------------------------------------------------------------ */

interface Palette {
  col(name: string, fallback: string): THREE.Color;
  dispose(): void;
}

// getComputedStyle resolves var() aliases + hex→rgb() for us; a hidden
// probe element inherits :root custom properties.
function makePalette(doc: Document): Palette {
  const probe = doc.createElement('span');
  probe.style.display = 'none';
  doc.body.appendChild(probe);
  return {
    col(name, fallback) {
      probe.style.color = `var(${name}, ${fallback})`;
      const v = getComputedStyle(probe).color;
      return new THREE.Color(v || fallback);
    },
    dispose() { probe.remove(); },
  };
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  rg.addColorStop(0, 'rgba(0,0,0,0.55)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Stripe texture for the belt tread — offset.x scrolls while running. */
function treadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, 2, 12, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(26, 1);
  return t;
}

const std = (color: THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, ...extra });

const box = (w: number, h: number, d: number, mat: THREE.Material) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

/* ------------------------------------------------------------------ */
/* build                                                                */
/* ------------------------------------------------------------------ */

export function buildScene(canvas: HTMLCanvasElement): LineSceneView {
  const palette = makePalette(document);
  const C = {
    canvas: palette.col('--bg-canvas', '#0d0f12'),
    panel: palette.col('--bg-panel', '#14161a'),
    raised: palette.col('--bg-raised', '#1b1e23'),
    idle: palette.col('--equip-idle', '#343a3f'),
    running: palette.col('--state-running', '#c1c7cd'),
    manual: palette.col('--equip-manual', '#4d5358'),
    edge: palette.col('--equip-edge', '#4d565f'),
    detail: palette.col('--equip-detail', '#7a848e'),
    mid: palette.col('--equip-mid', '#39414a'),
    belt: palette.col('--equip-belt', '#1c2126'),
    fill: palette.col('--equip-fill', '#697077'),
    lump: palette.col('--material', '#8d939c'),
    live: palette.col('--state-selected', '#3fc6d8'),
    crit: palette.col('--sev-critical', '#f4534a'),
    warn: palette.col('--sev-warning', '#ff9830'),
    ai: palette.col('--ai-accent', '#b98df0'),
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(C.panel, 1);

  const scene = new THREE.Scene();
  scene.background = C.panel.clone();
  scene.fog = new THREE.Fog(C.panel.clone(), 24, 46); // depth cue for iso

  // --- ortho ~30° iso camera (elevation 30°, azimuth 45°) ---
  const VIEW_H = 7.4; // world half-height
  const target0 = new THREE.Vector3(0.2, 1.0, 0);
  const camera = new THREE.OrthographicCamera(-VIEW_H, VIEW_H, VIEW_H, -VIEW_H, 0.1, 90);
  camera.position.set(
    target0.x + Math.cos(Math.PI / 6) * Math.SQRT1_2 * 26,
    target0.y + Math.sin(Math.PI / 6) * 26,
    target0.z + Math.cos(Math.PI / 6) * Math.SQRT1_2 * 26,
  );
  camera.lookAt(target0);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minPolarAngle = 0.35;          // stay above grazing angles
  controls.maxPolarAngle = 1.3;           // …and below top-down
  controls.minZoom = 0.5;
  controls.maxZoom = 3.4;
  controls.update();
  controls.saveState();

  // --- lights (no shadowmaps — contact-shadow decals instead) ---
  scene.add(new THREE.HemisphereLight(0x9aa4b0, 0x11141a, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(7, 14, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8899aa, 0.5);
  rim.position.set(-6, 8, -8);
  scene.add(rim);

  // --- floor + faint grid ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: C.canvas }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);
  const grid = new THREE.GridHelper(70, 70, C.mid, C.raised);
  grid.position.y = 0;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.4;
  (grid.material as THREE.Material).depthWrite = false;
  scene.add(grid);

  const shadowTex = shadowTexture();
  const treadTex = treadTexture();
  const contactShadow = (w: number, d: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.005;
    return m;
  };

  const pickRoots: THREE.Object3D[] = [];
  const equipment: EquipRefs[] = [];
  const selMat = new THREE.LineBasicMaterial({ color: C.live });

  const mkEquip = (id: EquipmentId, glowR: [number, number], shell: THREE.Mesh): EquipRefs => {
    const root = new THREE.Group();
    root.userData.eq = id;
    // red under-glow disc (pulses while an alarm is unacked)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ color: C.crit, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.012;
    glow.scale.set(glowR[0], glowR[1], 1);
    glow.visible = false;
    root.add(glow);
    // violet halo for open insights
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.05, 48),
      new THREE.MeshBasicMaterial({ color: C.ai, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.014;
    halo.scale.set(glowR[0], glowR[1], 1);
    halo.visible = false;
    root.add(halo);
    // selection edge on the representative shell
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry, 20), selMat);
    edge.visible = false;
    shell.add(edge);
    const ref: EquipRefs = { id, root, driven: [], strip: null, glow, halo, edge, alarmSev: null, alarmPulse: false };
    equipment.push(ref);
    pickRoots.push(root);
    return ref;
  };

  /* ---------- motor ---------- */
  const motorBody = box(1.7, 1.2, 1.3, std(C.idle.clone()));
  motorBody.position.y = 0.62;
  const motor = mkEquip('motor', [1.5, 1.2], motorBody);
  motor.driven.push(motorBody.material as THREE.MeshStandardMaterial);
  motor.root.position.set(-4.4, 0, 0);
  motor.root.add(contactShadow(2.6, 2.0));
  motor.root.add(motorBody);
  for (let i = 0; i < 4; i++) {
    const fin = box(0.14, 0.18, 1.36, std(C.mid.clone()));
    fin.position.set(-0.6 + i * 0.4, 1.3, 0);
    motor.root.add(fin);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.4, 24), std(C.mid.clone()));
  cap.rotation.z = Math.PI / 2;
  cap.position.set(0.95, 0.62, 0);
  motor.root.add(cap);
  // shaft + rotor marker (rotation reads only while running)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 16), std(C.detail.clone()));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(1.55, 0.62, 0);
  motor.root.add(shaft);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), std(C.detail.clone()));
  rotor.position.set(1.95, 0.62, 0);
  motor.root.add(rotor);
  // cyan live strip on the front face
  const mStrip = new THREE.MeshBasicMaterial({ color: C.live, transparent: true, opacity: 0.9 });
  const mStripMesh = box(1.72, 0.07, 0.02, mStrip);
  mStripMesh.position.set(0, 0.5, 0.66);
  motor.root.add(mStripMesh);
  motor.strip = mStrip;
  scene.add(motor.root);

  /* ---------- conveyor ---------- */
  const convFrame = box(6.4, 0.3, 1.15, std(C.idle.clone()));
  convFrame.position.y = 1.45;
  const conveyor = mkEquip('conveyor', [3.6, 1.1], convFrame);
  conveyor.driven.push(convFrame.material as THREE.MeshStandardMaterial);
  conveyor.root.add(contactShadow(7.4, 1.9));
  conveyor.root.add(convFrame);
  const belt = box(6.05, 0.06, 0.95, std(C.belt.clone()));
  belt.position.y = 1.64;
  conveyor.root.add(belt);
  const tread = new THREE.Mesh(
    new THREE.PlaneGeometry(6.05, 0.95),
    new THREE.MeshBasicMaterial({ map: treadTex, transparent: true, depthWrite: false }),
  );
  tread.rotation.x = -Math.PI / 2;
  tread.position.y = 1.675;
  conveyor.root.add(tread);
  for (const sx of [-3.05, 3.05]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.0, 16), std(C.mid.clone()));
    roller.rotation.x = Math.PI / 2;
    roller.position.set(sx, 1.45, 0);
    conveyor.root.add(roller);
  }
  for (const lx of [-2.6, -0.9, 0.9, 2.6]) {
    for (const lz of [-0.42, 0.42]) {
      const leg = box(0.14, 1.3, 0.14, std(C.edge.clone()));
      leg.position.set(lx, 0.65, lz);
      conveyor.root.add(leg);
    }
  }
  const cStrip = new THREE.MeshBasicMaterial({ color: C.live, transparent: true, opacity: 0.9 });
  const cStripMesh = box(6.42, 0.07, 0.02, cStrip);
  cStripMesh.position.set(0, 1.38, 0.585);
  conveyor.root.add(cStripMesh);
  conveyor.strip = cStrip;
  // material lumps riding the belt (visible motion while running)
  const lumps: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const lump = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), std(C.lump.clone()));
    lump.scale.y = 0.75;
    conveyor.root.add(lump);
    lumps.push(lump);
  }
  scene.add(conveyor.root);

  /* ---------- camera (vision head over the belt) ---------- */
  const camHead = box(0.45, 0.3, 0.35, std(C.manual.clone()));
  camHead.position.set(0.6, 2.9, -0.05);
  const cameraEq = mkEquip('camera', [0.9, 0.9], camHead);
  cameraEq.root.add(contactShadow(1.1, 1.1));
  const post = box(0.12, 3.1, 0.12, std(C.edge.clone()));
  post.position.set(0.6, 1.55, -0.95);
  cameraEq.root.add(post);
  const arm = box(0.12, 0.12, 0.95, std(C.edge.clone()));
  arm.position.set(0.6, 3.05, -0.5);
  cameraEq.root.add(arm);
  cameraEq.root.add(camHead);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 16), std(C.belt.clone()));
  lens.position.set(0.6, 2.7, -0.05);
  cameraEq.root.add(lens);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.0, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: C.detail, wireframe: true, transparent: true, opacity: 0.35 }),
  );
  cone.rotation.x = Math.PI;           // apex down, toward the belt
  cone.position.set(0.6, 2.15, -0.05);
  cameraEq.root.add(cone);
  scene.add(cameraEq.root);

  /* ---------- bin (gravel hopper) ---------- */
  const binTop = box(2.0, 1.0, 1.6, std(C.idle.clone(), { transparent: true, opacity: 0.3, depthWrite: false }));
  binTop.position.y = 1.0;
  const bin = mkEquip('bin', [1.7, 1.4], binTop);
  bin.root.position.set(4.4, 0, 0);
  bin.root.add(contactShadow(2.9, 2.3));
  const frustum = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 0.42, 0.65, 4),
    std(C.idle.clone(), { transparent: true, opacity: 0.3, depthWrite: false, flatShading: true }),
  );
  frustum.rotation.y = Math.PI / 4;
  frustum.scale.set(1.414, 1, 1.13);   // square 4-seg → 2.0 × 1.6 footprint
  frustum.position.y = 0.475;
  bin.root.add(frustum);
  const binRim = new THREE.LineSegments(new THREE.EdgesGeometry(binTop.geometry, 20), new THREE.LineBasicMaterial({ color: C.edge }));
  binRim.position.copy(binTop.position);
  bin.root.add(binRim);
  const binRim2 = new THREE.LineSegments(new THREE.EdgesGeometry(frustum.geometry, 20), new THREE.LineBasicMaterial({ color: C.edge }));
  binRim2.position.copy(frustum.position);
  binRim2.rotation.copy(frustum.rotation);
  binRim2.scale.copy(frustum.scale);
  bin.root.add(binRim2);
  // fill — scales with T.binLevel inside the translucent walls
  const fill = box(1.8, 0.95, 1.4, std(C.fill.clone()));
  fill.position.y = 0.5;
  fill.scale.y = 0.001;
  fill.renderOrder = 1;
  binTop.renderOrder = 2;
  frustum.renderOrder = 2;
  bin.root.add(fill);
  for (const [lx, lz] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]] as const) {
    const leg = box(0.12, 0.16, 0.12, std(C.edge.clone()));
    leg.position.set(lx, 0.08, lz);
    bin.root.add(leg);
  }
  const bStrip = new THREE.MeshBasicMaterial({ color: C.live, transparent: true, opacity: 0.9 });
  const bStripMesh = box(2.02, 0.06, 0.02, bStrip);
  bStripMesh.position.set(0, 1.42, 0.81);
  bin.root.add(bStripMesh);
  bin.strip = bStrip;
  bin.driven.push(binTop.material as THREE.MeshStandardMaterial, frustum.material as THREE.MeshStandardMaterial);
  scene.add(bin.root);

  // chute plate from the belt end into the bin mouth
  const chute = box(1.3, 0.06, 0.9, std(C.mid.clone()));
  chute.position.set(3.65, 1.5, 0);
  chute.rotation.z = -0.35;
  scene.add(chute);

  /* ---------- HTML label anchors (world positions) ---------- */
  const anchors: Record<string, THREE.Vector3> = {
    'motor-state': new THREE.Vector3(-4.4, 2.0, 0),
    'speed-sp': new THREE.Vector3(-4.4, 0.12, 0.85),
    'belt-speed': new THREE.Vector3(-1.5, 2.3, 0),
    'belt-temp': new THREE.Vector3(1.9, 2.3, 0),
    'gravel': new THREE.Vector3(0.6, 3.7, 0),
    'bin-level': new THREE.Vector3(4.4, 2.2, 0),
  };

  /* ---------- runtime state ---------- */
  const state = { running: false, reduceMotion: false, phase: 0 };
  let needsRender = true;

  const view: LineSceneView = {
    renderer, scene, camera, controls, canvas, anchors,
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const ndc = new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      for (const hit of ray.intersectObjects(pickRoots, true)) {
        let o: THREE.Object3D | null = hit.object;
        while (o && o.userData.eq === undefined) o = o.parent;
        if (o) return o.userData.eq as EquipmentId;
      }
      return null;
    },
    resetView() { controls.reset(); needsRender = true; },
    setSize(w, h) {
      renderer.setSize(w, h, false);
      const a = w / Math.max(1, h);
      camera.top = VIEW_H; camera.bottom = -VIEW_H;
      camera.left = -VIEW_H * a; camera.right = VIEW_H * a;
      camera.updateProjectionMatrix();
      needsRender = true;
    },
    invalidate() { needsRender = true; },
    tick(dtMs) {
      const anim = (state.running || equipment.some((e) => e.alarmPulse)) && !state.reduceMotion;
      let changed = needsRender;
      needsRender = false;
      if (controls.update()) changed = true;
      if (anim) {
        state.phase += dtMs;
        const ph = state.phase / 1000;
        if (state.running) {
          treadTex.offset.x = (ph * 0.9) % 1;
          rotor.rotation.x = ph * 3.2;
          for (let i = 0; i < lumps.length; i++) {
            const x = -2.9 + ((ph * 1.1 + i * 1.5) % 6.0);
            lumps[i].position.set(x, 1.72, (i % 2 ? 0.18 : -0.14));
          }
        }
        // unacked alarm under-glow pulses ~0.8 Hz
        const pulse = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(ph * Math.PI * 1.6));
        for (const e of equipment) if (e.alarmPulse) e.glow.material.opacity = pulse;
        changed = true;
      }
      return changed;
    },
    dispose() {
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) {
            if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          }
          (mat as THREE.Material).dispose();
        }
      });
      shadowTex.dispose();
      treadTex.dispose();
      selMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      palette.dispose();
      canvas.remove();
    },
  };

  /* ---------- applyState support ---------- */
  // stash internals on the view for applyState
  (view as unknown as { _i: object })._i = { equipment, state, C, fill };
  return view;
}

/* ------------------------------------------------------------------ */
/* applyState — same derivation as LineSchematic (T.running shade/motion,*/
/* per-equipment alarm worst-severity + unacked, open-insight halo)      */
/* ------------------------------------------------------------------ */

interface Internals {
  equipment: EquipRefs[];
  state: { running: boolean; reduceMotion: boolean; phase: number };
  C: Record<string, THREE.Color>;
  fill: THREE.Mesh;
}

export function applyState(view: LineSceneView, store: typeof live, opts: ApplyOpts = {}): void {
  const { equipment, state, C, fill } = (view as unknown as { _i: Internals })._i;
  const now = Date.now();
  const run = store.latest.get(T.running);
  const stale = !run || now - (Date.parse(run.ts) || 0) > STALE_MS;
  state.running = !stale && run.v === true;
  state.reduceMotion = !!opts.reduceMotion;

  const level = store.latest.get(T.binLevel);
  const pct = level && typeof level.v === 'number' ? Math.max(0, Math.min(100, level.v)) / 100 : 0;
  fill.scale.y = Math.max(0.001, pct);
  fill.position.y = 0.5 + 0.475 * pct; // anchored to the hopper floor

  for (const e of equipment) {
    const signals = EQUIPMENT.find((x) => x.id === e.id)?.signals ?? [];
    let worst: 'critical' | 'warning' | null = null;
    let unacked = false;
    for (const a of store.alarms) {
      if (a.state === 'cleared' || !signals.includes(a.tag)) continue;
      if (a.state === 'active') unacked = true;
      const s = normSeverity(a.severity);
      if (s === 'critical') worst = 'critical';
      else if (s === 'warning' && worst !== 'critical') worst = 'warning';
    }
    e.alarmSev = worst;
    e.alarmPulse = worst !== null && unacked;
    e.halo.visible = signals.some((s) => store.insights.some((i) => i.tag === s && i.state === 'open'));
    e.edge.visible = opts.selected === e.id;
    for (const m of e.driven) m.color.copy(state.running ? C.running : C.idle);
    if (e.strip) e.strip.opacity = state.running ? 0.9 : 0;
    e.glow.visible = e.alarmSev !== null;
    if (e.alarmSev) {
      e.glow.material.color.copy(e.alarmSev === 'critical' ? C.crit : C.warn);
      if (!e.alarmPulse) e.glow.material.opacity = 0.22;
    }
  }
  view.invalidate();
}
