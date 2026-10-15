// Isometric three.js twin of sorting line 1 (motor → conveyor → vision
// camera → gravel bin) — SUPPLEMENTARY to the 2D mimic (doc 20 §3.2).
// Vanilla three only, bound imperatively to LiveStore: `applyState` mutates
// meshes on each store flush; the host renders on demand — no reconciler.
//
// v5: equipment bodies are REAL models, not hand-built primitives — CC0
// Kenney Factory Kit GLBs loaded via GLTFLoader from /models (see
// public/models/LICENSE-Kenney.txt). Materials are cloned per equipment so
// applyState can still shade-code them (tint multiplies the colormap
// texture): running = dark fill, idle = light fill — ISA-101 shade rules
// carried over the asset geometry unchanged.
//
// Evidence rules (doc 22 §6): 3D carries WHERE (spatial layout + state
// shades); quantities stay in the 2D HTML labels. State = shade + cyan
// live strip; hue only for abnormal (severity under-glow, AI halo,
// selection cage). Machines sit on contact-shadow decals + fog — iso
// scenes read flat without depth cues.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
  /** cloned body materials — applyState tints them (state = shade) */
  driven: THREE.MeshStandardMaterial[];
  /** cyan "live" strip, shown while the line runs */
  strip: THREE.MeshBasicMaterial | null;
  glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.LineSegments;
  /** world bbox of the model, captured in dress() before decals are added */
  bb?: THREE.Box3;
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

const std = (color: THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, ...extra });

const box = (w: number, h: number, d: number, mat: THREE.Material) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

/* ------------------------------------------------------------------ */
/* model loading — real assets, normalized to scene scale               */
/* ------------------------------------------------------------------ */

const MODEL_DIR = '/models';

/** Clone every mesh material once per model instance so per-equipment
 *  shade-tinting never bleeds across shared GLB materials. Returns the
 *  clones (driven materials for applyState). */
function cloneMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const map = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const out = mats.map((mat) => {
      if (!map.has(mat)) map.set(mat, (mat as THREE.MeshStandardMaterial).clone());
      return map.get(mat)!;
    });
    m.material = Array.isArray(m.material) ? out : out[0];
  });
  return [...map.values()];
}

/** Fit a loaded GLB in place: uniform scale to a target horizontal length
 *  (x-axis) or height (y-axis), centred on x/z with its base resting on y=0.
 *  Works on the detached object — call before adding it to a placed root. */
function fit(obj: THREE.Object3D, opts: { len?: number; h?: number; yaw?: number }): { size: THREE.Vector3 } {
  if (opts.yaw) obj.rotation.y = opts.yaw;
  const b = new THREE.Box3().setFromObject(obj);
  const size = b.getSize(new THREE.Vector3());
  const s = opts.len
    ? opts.len / Math.max(size.x, 1e-6)
    : (opts.h ?? 1) / Math.max(size.y, 1e-6);
  obj.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  return { size: b2.getSize(new THREE.Vector3()) };
}

/* ------------------------------------------------------------------ */
/* build                                                                */
/* ------------------------------------------------------------------ */

export async function buildScene(canvas: HTMLCanvasElement): Promise<LineSceneView> {
  const palette = makePalette(document);
  const C = {
    canvas: palette.col('--bg-canvas', '#e8eaee'),
    panel: palette.col('--bg-panel', '#f4f5f7'),
    raised: palette.col('--bg-raised', '#e3e5e9'),
    idle: palette.col('--equip-idle', '#d8dce1'),
    running: palette.col('--state-running', '#3a424c'),
    manual: palette.col('--equip-manual', '#aab1ba'),
    edge: palette.col('--equip-edge', '#5d6670'),
    detail: palette.col('--equip-detail', '#8b939d'),
    mid: palette.col('--equip-mid', '#bcc2c9'),
    belt: palette.col('--equip-belt', '#575f68'),
    fill: palette.col('--equip-fill', '#9aa3ac'),
    lump: palette.col('--material', '#79828c'),
    live: palette.col('--state-selected', '#149eb4'),
    crit: palette.col('--sev-critical', '#cf352b'),
    warn: palette.col('--sev-warning', '#f08a10'),
    ai: palette.col('--ai-accent', '#8658d4'),
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(C.panel, 1);

  const scene = new THREE.Scene();
  scene.background = C.panel.clone();
  scene.fog = new THREE.Fog(C.panel.clone(), 33, 58); // line crisp, yard reads as soft silhouettes

  // --- ortho ~30° iso camera (elevation 30°, azimuth 45°) ---
  // line spans x ∈ [-5.4, 5.4], tops out ~y 3 (labels ride above the
  // anchors); at iso 30°/45° that content projects to screen-y ≈ [-3.0, +2.9]
  // around this target — half-height 5.2 fills the panel without clipping
  const VIEW_H = 5.2; // world half-height
  const target0 = new THREE.Vector3(0.2, 0.7, 0);
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
  // light-scene variant: bright flat hemisphere keeps the CC0 colormap
  // readable; key/rim add just enough form.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd3d8dd, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(7, 14, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe5ec, 0.55);
  rim.position.set(-6, 8, -8);
  scene.add(rim);

  // --- floor + faint grid ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: C.canvas }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);
  const grid = new THREE.GridHelper(70, 70, C.edge, C.mid);
  grid.position.y = 0;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.25;
  (grid.material as THREE.Material).depthWrite = false;
  scene.add(grid);

  const shadowTex = shadowTexture();
  const contactShadow = (w: number, d: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.005;
    // floor decal, not a pick target — it extends past the model, so a
    // click near a machine must still clear the selection, not set it
    m.raycast = () => {};
    return m;
  };

  /* ---------- load the real models (Kenney Factory Kit, CC0) ---------- */
  const loader = new GLTFLoader();
  const load = (file: string) => loader.loadAsync(`${MODEL_DIR}/${file}.glb`).then((g) => g.scene);
  let motorM: THREE.Group, convM: THREE.Group, camM: THREE.Group,
    binM: THREE.Group, boxM: THREE.Group, cogM: THREE.Group;
  try {
    [motorM, convM, camM, binM, boxM, cogM] = await Promise.all([
      load('machine-window'),      // drive unit with window panel
      load('conveyor-long'),       // belt conveyor section
      load('scanner-high'),        // inspection scanner on a post → vision camera
      load('hopper-high-round'),   // tall hopper → gravel bin
      load('box-small'),           // parcels riding the belt (material)
      load('cog-a'),               // spinning coupling on the motor
    ]);
  } catch (err) {

    // renderer + palette probe already exist — release them so a failed
    // mount leaves no live GL context or stray DOM behind (the host then
    // takes the same silent fallback path as a context loss)
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) (mat as THREE.Material).dispose();
    });
    shadowTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    palette.dispose();
    throw err;
  }

  /* Scenery backdrop — real plant structures from 3D Warehouse (optimized/
     quantized copies in /models). Optional by design: each load has its own
     catch so a missing file drops that structure, never the scene. */
  const sceneryNames = ['batching-plant', 'cement-plant', 'colliery-tower', 'cement-mixer'] as const;
  const scenery = await Promise.all(sceneryNames.map((n) => load(n).catch(() => null)));

  const pickRoots: THREE.Object3D[] = [];
  const equipment: EquipRefs[] = [];
  const selMat = new THREE.LineBasicMaterial({ color: C.live });

  const mkEquip = (id: EquipmentId): EquipRefs => {
    const root = new THREE.Group();
    root.userData.eq = id;
    const ref: EquipRefs = {
      id, root, driven: [], strip: null,
      glow: null!, halo: null!, edge: null!, alarmSev: null, alarmPulse: false,
    };
    equipment.push(ref);
    pickRoots.push(root);
    return ref;
  };

  /** After a model is placed at its world position: measure the world bbox,
   *  then add floor decals (alarm glow, AI halo), a cyan live strip on the
   *  front face, and a hidden selection cage from the box edges. */
  function dress(ref: EquipRefs, opts: { stripY?: number; wallOpacity?: number } = {}) {
    ref.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(ref.root);
    const size = bb.getSize(new THREE.Vector3());
    const ctr = bb.getCenter(new THREE.Vector3());
    const local = (v: THREE.Vector3) => v.clone().sub(ref.root.position); // roots translate only

    // red under-glow disc (pulses while an alarm is unacked)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ color: C.crit, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(local(new THREE.Vector3(ctr.x, 0.012, ctr.z)));
    glow.scale.set(size.x * 0.62, size.z * 0.95, 1);
    glow.visible = false;
    ref.root.add(glow);
    ref.glow = glow as EquipRefs['glow'];
    // violet halo for open insights
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.05, 48),
      new THREE.MeshBasicMaterial({ color: C.ai, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.copy(local(new THREE.Vector3(ctr.x, 0.014, ctr.z)));
    halo.scale.set(size.x * 0.62, size.z * 0.95, 1);
    halo.visible = false;
    ref.root.add(halo);
    ref.halo = halo as EquipRefs['halo'];
    // floor decals are not pick targets
    glow.raycast = () => {};
    halo.raycast = () => {};

    // model-only bbox (pre-decal) — reused for HTML label anchors
    ref.bb = bb;

    // cyan live strip on the model's front face
    const strip = new THREE.MeshBasicMaterial({ color: C.live, transparent: true, opacity: 0.9 });
    const stripMesh = box(size.x * 0.9, 0.06, 0.02, strip);
    stripMesh.position.copy(local(new THREE.Vector3(
      ctr.x, bb.min.y + (opts.stripY ?? size.y * 0.28), bb.max.z + 0.012,
    )));
    ref.root.add(stripMesh);
    ref.strip = strip;

    // selection cage = cyan edges of the model's bounding box
    const cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.07, size.y * 1.07, size.z * 1.07)),
      selMat,
    );
    cage.position.copy(local(ctr));
    cage.visible = false;
    ref.root.add(cage);
    ref.edge = cage;
    cage.raycast = () => {};   // never block the model pick

    // hopper walls translucent so the interior fill reads
    if (opts.wallOpacity !== undefined) {
      for (const m of ref.driven) { m.transparent = true; m.opacity = opts.wallOpacity; m.depthWrite = false; }
    }
  }

  /* ---------- motor ---------- */
  const motor = mkEquip('motor');
  const motorFit = fit(motorM, { h: 1.5 });
  motor.driven.push(...cloneMaterials(motorM));
  motor.root.position.set(-4.4, 0, 0);
  motor.root.add(motorM);
  scene.add(motor.root);
  dress(motor);   // dress() measures the model-only bbox — decals go in after
  motor.root.add(contactShadow(motorFit.size.x * 1.35, motorFit.size.z * 1.5));
  // flat cog on the motor housing — spins while the line runs (shaft cue)
  const cog = cogM.clone();
  cog.scale.setScalar(0.55 / Math.max(new THREE.Box3().setFromObject(cog).getSize(new THREE.Vector3()).x, 1e-6));
  cog.position.set(motorFit.size.x * 0.25, motorFit.size.y * 0.82, motorFit.size.z * 0.3);
  motor.root.add(cog);

  /* ---------- conveyor ---------- */
  const conveyor = mkEquip('conveyor');
  // auto-orient the long axis onto x
  const cb0 = new THREE.Box3().setFromObject(convM);
  const cs0 = cb0.getSize(new THREE.Vector3());
  const convFit = fit(convM, { len: 6.4, yaw: cs0.z > cs0.x ? Math.PI / 2 : 0 });
  conveyor.driven.push(...cloneMaterials(convM));
  conveyor.root.add(convM);
  scene.add(conveyor.root);
  dress(conveyor, { stripY: convFit.size.y * 0.9 });
  conveyor.root.add(contactShadow(convFit.size.x * 1.08, convFit.size.z * 1.7));
  const beltTop = convFit.size.y;

  /* ---------- camera (scanner head on a post over the belt) ---------- */
  const cameraEq = mkEquip('camera');
  const camFit = fit(camM, { h: 2.6 });
  cameraEq.driven.push(...cloneMaterials(camM));
  cameraEq.root.position.set(0.6, 0, -0.7);
  cameraEq.root.add(camM);
  scene.add(cameraEq.root);
  dress(cameraEq, { stripY: camFit.size.y * 0.55 });
  cameraEq.root.add(contactShadow(camFit.size.x * 1.3, camFit.size.z * 1.3));
  // vision cone — wireframe, apex down toward the belt (local coords:
  // root sits at z=-0.7, so +0.7 local lands over belt centre)
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.0, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: C.detail, wireframe: true, transparent: true, opacity: 0.4 }),
  );
  cone.rotation.x = Math.PI;
  cone.position.set(0, beltTop + 0.7, 0.7);
  cameraEq.root.add(cone);

  /* ---------- bin (gravel hopper) ---------- */
  const bin = mkEquip('bin');
  const binFit = fit(binM, { h: 2.2 });
  bin.driven.push(...cloneMaterials(binM));
  bin.root.position.set(4.4, 0, 0);
  bin.root.add(binM);
  scene.add(bin.root);
  dress(bin, { wallOpacity: 0.5 });
  bin.root.add(contactShadow(binFit.size.x * 1.5, binFit.size.z * 1.5));
  // interior fill — scales with T.binLevel through the translucent walls
  const fillH = binFit.size.y * 0.55;
  const fillBase = 0.06;
  const fill = box(binFit.size.x * 0.7, fillH, binFit.size.z * 0.7, std(C.fill.clone()));
  fill.position.y = fillBase + fillH / 2;
  fill.scale.y = 0.001;
  fill.renderOrder = 1;
  bin.root.add(fill);

  /* ---------- material: parcels riding the belt ---------- */
  const parcels: THREE.Object3D[] = [];
  const parcelProto = boxM.clone();
  const pb = new THREE.Box3().setFromObject(parcelProto).getSize(new THREE.Vector3());
  const pScale = 0.42 / Math.max(pb.y, 1e-6);
  for (let i = 0; i < 4; i++) {
    const p = parcelProto.clone();
    p.scale.setScalar(pScale);
    p.rotation.y = (i % 2 ? 0.15 : -0.1);
    p.position.set(-2.9 + i * 1.5, beltTop, (i % 2 ? 0.18 : -0.14));
    conveyor.root.add(p);
    parcels.push(p);
  }

  /* ---------- backdrop: the plant yard the line lives in ---------- */
  // file units vary (some real-world mm) — normalize each footprint, then
  // ground-place around the line. Scenery only: raycast disabled, never
  // pickable, never label-anchored.
  const placeBackdrop = (m: THREE.Object3D, footprint: number, x: number, z: number, rotY = 0) => {
    m.rotation.y = rotY;
    const bb0 = new THREE.Box3().setFromObject(m);
    const sz0 = bb0.getSize(new THREE.Vector3());
    m.scale.setScalar(footprint / Math.max(sz0.x, sz0.z, 1e-6));
    const bb1 = new THREE.Box3().setFromObject(m);
    const ctr = bb1.getCenter(new THREE.Vector3());
    m.position.set(x - ctr.x, -bb1.min.y, z - ctr.z);
    m.traverse((o) => { o.raycast = () => {}; });
    scene.add(m);
  };
  /* real bounding boxes were inspected (ref/models/batching): BM120 is a
     ~square site (~158m²), so it owns the whole back yard centered behind
     the line; the tower and silo row stand clear on each flank; the mixer
     truck sits mid-field at believable scale. steel-depot is a flat slab —
     dropped, it only added clutter. */
  const [plantM, cementM, towerM, mixerM] = scenery;
  if (plantM) placeBackdrop(plantM, 16, 0, -10.5);          // z −18.5…−2.5
  if (cementM) placeBackdrop(cementM, 8, 12, -8, 0.15);     // narrow silo row, right flank
  if (towerM) placeBackdrop(towerM, 6, -13, -9, 0.2);       // winding tower, left flank
  if (mixerM) placeBackdrop(mixerM, 2.4, -5.5, -3.5, -0.5); // truck scale vs the plant

  /* ---------- HTML label anchors (world positions, model-only bboxes) ---------- */
  const motorBb = motor.bb!, convBb = conveyor.bb!, camBb = cameraEq.bb!, binBb = bin.bb!;
  const mc = motorBb.getCenter(new THREE.Vector3());
  const cc = camBb.getCenter(new THREE.Vector3());
  const bc = binBb.getCenter(new THREE.Vector3());
  const anchors: Record<string, THREE.Vector3> = {
    'motor-state': new THREE.Vector3(mc.x, motorBb.max.y + 0.5, mc.z),
    'speed-sp':    new THREE.Vector3(mc.x, 0.12, motorBb.max.z + 0.35),
    'belt-speed':  new THREE.Vector3(-1.5, convBb.max.y + 0.7, 0),
    'belt-temp':   new THREE.Vector3(1.9, convBb.max.y + 0.7, 0),
    'gravel':      new THREE.Vector3(cc.x, camBb.max.y + 0.35, cc.z),
    'bin-level':   new THREE.Vector3(bc.x, binBb.max.y + 0.4, bc.z),
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
          cog.rotation.y = ph * 3.2;
          for (let i = 0; i < parcels.length; i++) {
            const x = -2.9 + ((ph * 1.1 + i * 1.5) % 6.0);
            parcels[i].position.set(x, beltTop, (i % 2 ? 0.18 : -0.14));
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
      selMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      palette.dispose();
      canvas.remove();
    },
  };

  /* ---------- applyState support ---------- */
  // stash internals on the view for applyState
  (view as unknown as { _i: object })._i = { equipment, state, C, fill, fillBase, fillH };
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
  fillBase: number;
  fillH: number;
}

export function applyState(view: LineSceneView, store: typeof live, opts: ApplyOpts = {}): void {
  const { equipment, state, C, fill, fillBase, fillH } = (view as unknown as { _i: Internals })._i;
  const now = Date.now();
  const run = store.latest.get(T.running);
  const stale = !run || now - (Date.parse(run.ts) || 0) > STALE_MS;
  state.running = !stale && run.v === true;
  state.reduceMotion = !!opts.reduceMotion;

  const level = store.latest.get(T.binLevel);
  const pct = level && typeof level.v === 'number' ? Math.max(0, Math.min(100, level.v)) / 100 : 0;
  fill.scale.y = Math.max(0.001, pct);
  fill.position.y = fillBase + (fillH * pct) / 2; // anchored to the hopper floor

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
      // unacked glow pulses via tick() when motion is allowed; under
      // prefers-reduced-motion tick() is static, so the cue needs a static
      // opacity floor — reduced-motion gates motion, never alarm visibility.
      if (!e.alarmPulse) e.glow.material.opacity = 0.22;
      else if (state.reduceMotion) e.glow.material.opacity = 0.3;
    }
  }
  view.invalidate();
}
