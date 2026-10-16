// Isometric three.js twin of the plant — SUPPLEMENTARY to the 2D mimic (doc
// 20 §3.2). Vanilla three only, bound imperatively to LiveStore: `applyState`
// mutates meshes on each store flush; the host renders on demand — no
// reconciler.
//
// The scene is whatever .glb the site has active (or the bundled Centrale a
// Beton demo). Equipment is NOT hard-coded: the operator maps glTF node
// indices to a kind and tag bindings (lib/plantModel.ts); each kind has a
// behaviour here:
//   spin   — fan (or the nodes themselves) turns while `run` is on
//   belt   — lumps travel along the long axis while `run` is on
//   level  — side gauge (+ material heap in open bins) from `level`
//   open   — marker lamp: lit while the valve/gate is open
//   tint   — marker lamp from a state signal
//   flow   — dots travel along each straight pipe segment while flowing
//   slide  — the nodes travel along a direction (skip, bucket, carriage)
//   mixer  — drum spin + concrete mass turning inside (see X-ray)
// Materials are cloned per part; state = emissive lift + motion, never a
// recolour of the textured model.
//
// Evidence rules (doc 22 §6): 3D carries WHERE (spatial layout + state
// shades); quantities stay in the HTML faceplate. Hue only for abnormal
// (severity under-glow, AI halo, selection cage).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { STALE_MS, live } from '../../lib/live';
import { liveName, liveValue, truthy, type PlantPart } from '../../lib/plantModel';
import { normSeverity } from '../../shared/ui/Status';

export interface ApplyOpts {
  /** part key (index into the parts array, as a string) */
  selected?: string | null;
  reduceMotion?: boolean;
  /** editor: run every part as if its signals were on */
  preview?: boolean;
}

/** One glTF node. `skp*` come from the SketchUp conversion (node extras). */
export interface NodeInfo {
  name: string; children: number[]; parent: number;
  skp?: string; def?: string; layer?: string;
}

export interface PartBox { key: string; min: [number, number, number]; max: [number, number, number] }

export interface PlanImage {
  url: string;
  /** world extents the image covers, on the two axes shown */
  min: [number, number];
  max: [number, number];
}

export type PlanKind = 'top' | 'front';
export type XrayMode = 'off' | 'all' | 'others';

type Behavior = 'spin' | 'belt' | 'level' | 'open' | 'tint' | 'flow' | 'slide';
const BEHAVIOR: Record<string, Behavior> = {
  motor: 'spin', pump: 'spin', mixer: 'spin', conveyor: 'belt',
  vessel: 'level', valve: 'open', indicator: 'tint', pipe: 'flow', slider: 'slide',
};

const FLUID: Record<string, number> = {
  water: 0x2f80ed, air: 0xaab4c0, cement: 0x8d8579, admixture: 0xf2994a,
};

interface FlowSeg { a: THREE.Vector3; b: THREE.Vector3; n: number; r: number }

interface PartRefs {
  key: string;
  part: PlantPart;
  behavior: Behavior;
  root: THREE.Group;
  nodes: THREE.Object3D[];
  /** cloned body materials — applyState lifts their emissive when active */
  driven: THREE.MeshStandardMaterial[];
  glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.LineSegments;
  bb: THREE.Box3;
  spinner?: THREE.Group;
  pivots?: THREE.Group[];
  lumps?: THREE.Mesh[];
  beltAxis?: 'x' | 'z';
  gauge?: { fill: THREE.Mesh; base: number; height: number; mat: THREE.MeshStandardMaterial };
  heap?: { mesh: THREE.Mesh; base: number; height: number };
  lamp?: THREE.MeshBasicMaterial;
  flow?: { mesh: THREE.InstancedMesh; segs: FlowSeg[] };
  slide?: { base: THREE.Vector3[]; dir: THREE.Vector3; dist: number; period: number };
  mix?: { spin: THREE.Group; shell: THREE.Mesh };
  /** derived by applyState, read by tick */
  active: boolean;
  speed: number;
  level: number;
  slideTarget: number | null;
  slideF: number;
  alarmSev: 'critical' | 'warning' | null;
  alarmPulse: boolean;
}

export interface LineSceneView {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  /** glTF node graph (index = node index) for the mapping editor + auto-detect */
  nodes: NodeInfo[];
  roots: number[];
  /** replace the mapped equipment without reloading the model */
  setParts(parts: PlantPart[]): void;
  /** equipment pick: part key, or null */
  pick(clientX: number, clientY: number): string | null;
  /** any-geometry pick: node indices from the hit up to its top-level ancestor */
  pickNodeChain(clientX: number, clientY: number): number[] | null;
  /** cyan cage around the union of these nodes (editor); null clears */
  highlight(indices: number[] | null): void;
  /** world box of one node (normalized scene units); null when it has no geometry */
  nodeBox(index: number): { min: [number, number, number]; max: [number, number, number] } | null;
  /** world boxes of every mapped part (for the 2D plan hotspots) */
  partBoxes(): PartBox[];
  /** flat top/front render of the whole model, white background */
  plan(kind: PlanKind, widthPx: number): PlanImage;
  /** see-through plant; 'others' keeps the given part solid */
  setXray(mode: XrayMode, partKey?: string | null): void;
  /** show only this part (null = show all) */
  isolate(partKey: string | null): void;
  hidePart(partKey: string, hidden: boolean): void;
  /** fly the camera to a part (null = back to the home view) */
  focus(partKey: string | null): void;
  resetView(): void;
  setSize(w: number, h: number): void;
  invalidate(): void;
  /** advance time-based motion; true while continuous rendering is needed */
  tick(dtMs: number): boolean;
  dispose(): void;
}

export interface SceneInput {
  url: string;
  parts: PlantPart[];
}

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

const std = (color: THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, ...extra });

const box = (w: number, h: number, d: number, mat: THREE.Material) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

const noRay = (o: THREE.Object3D) => { o.raycast = () => {}; };

/** Clone every mesh material once per part so tinting never bleeds across the
 *  model's shared materials. Returns the clones. */
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

function concreteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c9298';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    const v = 90 + Math.floor(Math.random() * 90);
    g.fillStyle = `rgb(${v},${v},${v + 6})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** world units across the plant's long side (the model is normalized to this) */
export const PLANT_FOOTPRINT = 22;
const YARD_FOOTPRINT = PLANT_FOOTPRINT;
const VIEW_H = 11;         // ortho half-height
const MAX_DOTS = 2500;

/* ------------------------------------------------------------------ */
/* build                                                                */
/* ------------------------------------------------------------------ */

export async function buildScene(canvas: HTMLCanvasElement, input: SceneInput): Promise<LineSceneView> {
  const palette = makePalette(document);
  const C = {
    canvas: palette.col('--bg-canvas', '#e8eaee'),
    panel: palette.col('--bg-panel', '#f4f5f7'),
    mid: palette.col('--equip-mid', '#bcc2c9'),
    edge: palette.col('--equip-edge', '#5d6670'),
    detail: palette.col('--equip-detail', '#8b939d'),
    fill: palette.col('--equip-fill', '#9aa3ac'),
    lump: palette.col('--material', '#79828c'),
    live: palette.col('--state-selected', '#149eb4'),
    crit: palette.col('--sev-critical', '#cf352b'),
    warn: palette.col('--sev-warning', '#f08a10'),
    ai: palette.col('--ai-accent', '#8658d4'),
    ok: palette.col('--sev-ok', '#1c9a67'),
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(C.panel, 1);

  const scene = new THREE.Scene();
  scene.background = C.panel.clone();
  scene.fog = new THREE.Fog(C.panel.clone(), 40, 70); // plant crisp, yard reads as soft silhouettes

  // --- ortho ~30° iso camera (elevation 30°, azimuth 45°) ---
  const target0 = new THREE.Vector3(2, 3, -5);
  const camera = new THREE.OrthographicCamera(-VIEW_H, VIEW_H, VIEW_H, -VIEW_H, 0.1, 140);
  camera.position.set(
    target0.x + Math.cos(Math.PI / 6) * Math.SQRT1_2 * 34,
    target0.y + Math.sin(Math.PI / 6) * 34,
    target0.z + Math.cos(Math.PI / 6) * Math.SQRT1_2 * 34,
  );
  camera.lookAt(target0);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minPolarAngle = 0.35;          // stay above grazing angles
  controls.maxPolarAngle = 1.3;           // …and below top-down
  controls.minZoom = 0.5;
  controls.maxZoom = 12;
  controls.update();
  controls.saveState();

  // --- lights (no shadowmaps) ---
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight(0xffffff, 0xd3d8dd, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(7, 14, 5);
  lights.add(key);
  const rim = new THREE.DirectionalLight(0xdfe5ec, 0.55);
  rim.position.set(-6, 8, -8);
  lights.add(rim);
  scene.add(lights);

  // --- floor + faint grid ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: C.canvas }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);
  const grid = new THREE.GridHelper(90, 90, C.edge, C.mid);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.25;
  (grid.material as THREE.Material).depthWrite = false;
  scene.add(grid);

  /* ---------- load the plant ---------- */
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let yard: THREE.Group;
  let parser: {
    json: { nodes?: { name?: string; children?: number[]; extras?: { skp?: { n?: string; d?: string; l?: string } } }[] };
    associations: Map<unknown, { nodes?: number }>;
  };
  try {
    const gltf = await loader.loadAsync(input.url);
    yard = gltf.scene;
    parser = gltf.parser as unknown as typeof parser;
  } catch (err) {
    // renderer + palette probe already exist — release them so a failed
    // mount leaves no stray GPU resources or DOM behind (the host then takes
    // the same silent fallback path as a context loss). The context itself is
    // left alive: a retry reuses the same <canvas>.
    renderer.dispose();
    palette.dispose();
    throw err;
  }

  // node index <-> object, and the node graph for the editor tree
  const nodeObj = new Map<number, THREE.Object3D>();
  const objNode = new Map<THREE.Object3D, number>();
  parser.associations.forEach((v, k) => {
    if (v.nodes !== undefined && (k as THREE.Object3D).isObject3D) {
      nodeObj.set(v.nodes, k as THREE.Object3D);
      objNode.set(k as THREE.Object3D, v.nodes);
    }
  });
  const gltfNodes = parser.json.nodes ?? [];
  const nodes: NodeInfo[] = gltfNodes.map((n, i) => {
    const sk = n.extras?.skp;
    return { name: sk?.n ?? n.name ?? `node ${i}`, children: n.children ?? [], parent: -1, skp: sk?.n, def: sk?.d, layer: sk?.l };
  });
  nodes.forEach((n, i) => n.children.forEach((c) => { if (nodes[c]) nodes[c].parent = i; }));
  const roots = nodes.map((n, i) => (n.parent < 0 ? i : -1)).filter((i) => i >= 0);

  // Source is usually in mm — normalize the footprint, then ground-place
  // centred behind the origin. Everything is scenery (raycast off) except the
  // nodes bound to equipment.
  yard.traverse((o) => {
    noRay(o);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mat as THREE.MeshStandardMaterial;
      sm.roughness = 0.9;
      sm.metalness = 0;
      if (sm.transparent) sm.depthWrite = false;
      sm.needsUpdate = true;
    }
  });
  {
    const bb0 = new THREE.Box3().setFromObject(yard);
    const sz0 = bb0.getSize(new THREE.Vector3());
    yard.scale.setScalar(YARD_FOOTPRINT / Math.max(sz0.x, sz0.z, 1e-6));
    const bb1 = new THREE.Box3().setFromObject(yard);
    const ctr = bb1.getCenter(new THREE.Vector3());
    const foot = (bb1.max.x - bb1.min.x) * (bb1.max.z - bb1.min.z);
    // rest the model's own big flat slab on y = 0 when it has one (a site slab
    // sits above deeper pits); otherwise its lowest point
    let groundY = bb1.min.y;
    let slabArea = 0;
    yard.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const b = new THREE.Box3().setFromObject(m);
      const s = b.getSize(new THREE.Vector3());
      if (s.y < 0.3 && s.x * s.z > slabArea && s.x * s.z > 0.4 * foot) {
        slabArea = s.x * s.z;
        groundY = b.max.y;
      }
    });
    yard.position.set(-ctr.x, -groundY, -10 - ctr.z);
    scene.add(yard);
    yard.updateMatrixWorld(true);
  }
  const footprint = YARD_FOOTPRINT;

  /* ---------- see-through / isolate / hide state ---------- */
  const matBase = new Map<THREE.Material, { t: boolean; o: number; dw: boolean }>();
  let xray: { mode: XrayMode; key: string | null } = { mode: 'off', key: null };
  let isolateKey: string | null = null;
  const hiddenKeys = new Set<string>();
  const meshPart = new Map<THREE.Object3D, string>();   // every mesh of a mapped node -> part key

  const eachMesh = (fn: (m: THREE.Mesh) => void) => yard.traverse((o) => { if ((o as THREE.Mesh).isMesh) fn(o as THREE.Mesh); });
  const matsOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];

  const applyXray = () => {
    eachMesh((m) => {
      const keep = xray.mode === 'others' && xray.key !== null && meshPart.get(m) === xray.key;
      for (const mat of matsOf(m)) {
        if (!matBase.has(mat)) matBase.set(mat, { t: mat.transparent, o: mat.opacity, dw: mat.depthWrite });
        const b = matBase.get(mat)!;
        if (xray.mode === 'off' || keep) { mat.transparent = b.t; mat.opacity = b.o; mat.depthWrite = b.dw; }
        else { mat.transparent = true; mat.opacity = Math.min(b.o, 0.13); mat.depthWrite = false; }
        mat.needsUpdate = true;
      }
    });
  };
  const applyVisibility = () => {
    eachMesh((m) => {
      const k = meshPart.get(m);
      m.visible = !(k !== undefined && hiddenKeys.has(k)) && (isolateKey === null || k === isolateKey);
    });
  };

  /* ---------- equipment: mapped parts ---------- */
  let pickRoots: THREE.Object3D[] = [];
  let equipment: PartRefs[] = [];
  let currentParts: PlantPart[] = [];
  const selMat = new THREE.LineBasicMaterial({ color: C.live });
  const hiMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xe0368f) });
  const concrete = concreteTexture();

  const unionBox = (objs: THREE.Object3D[]) => {
    const b = new THREE.Box3();
    for (const o of objs) b.union(new THREE.Box3().setFromObject(o));
    return b;
  };

  const disposeTree = (o: THREE.Object3D) => {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => (x as THREE.Material).dispose());
    });
  };

  const clearEquipment = () => {
    for (const e of equipment) {
      scene.remove(e.root);
      disposeTree(e.root);
      for (const n of e.nodes) {
        delete n.userData.part;
        n.traverse(noRay);
      }
      e.slide?.base.forEach((b, i) => {
        const n = e.nodes[i];
        if (n?.parent) n.position.copy(n.parent.worldToLocal(b.clone()));
      });
      e.pivots?.forEach((p) => { p.rotation.set(0, 0, 0); });
    }
    equipment = [];
    pickRoots = [];
    meshPart.clear();
  };

  const longAxis = (s: THREE.Vector3): 'x' | 'y' | 'z' => (s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z');

  const buildEquipment = (parts: PlantPart[]) => {
    clearEquipment();
    currentParts = parts;
    let dots = 0;
    parts.forEach((part, i) => {
      const objs = part.nodes.map((n) => nodeObj.get(n)).filter((o): o is THREE.Object3D => !!o);
      if (!objs.length) return; // mapping refers to nodes this file lacks — skip, editor flags it
      const key = String(i);
      const behavior = BEHAVIOR[part.kind] ?? 'tint';
      const prm = (part.params ?? {}) as Record<string, unknown>;
      const root = new THREE.Group();
      scene.add(root);
      const driven: THREE.MeshStandardMaterial[] = [];
      for (const o of objs) {
        o.userData.part = key;
        o.traverse((c) => {
          Reflect.deleteProperty(c, 'raycast');
          if ((c as THREE.Mesh).isMesh) meshPart.set(c, key);
        });
        driven.push(...cloneMaterials(o));
        pickRoots.push(o);
      }
      const bb = unionBox(objs);
      const size = bb.getSize(new THREE.Vector3());
      const ctr = bb.getCenter(new THREE.Vector3());

      // red under-glow disc (pulses while an alarm is unacked)
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1, 40),
        new THREE.MeshBasicMaterial({ color: C.crit, transparent: true, opacity: 0, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(ctr.x, 0.04, ctr.z);
      glow.scale.set(Math.max(size.x * 0.62, 0.3), Math.max(size.z * 0.62, 0.3), 1);
      glow.visible = false;
      noRay(glow);
      root.add(glow);
      // violet halo for open insights
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1.05, 48),
        new THREE.MeshBasicMaterial({ color: C.ai, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(ctr.x, 0.045, ctr.z);
      halo.scale.set(Math.max(size.x * 0.62, 0.3), Math.max(size.z * 0.62, 0.3), 1);
      halo.visible = false;
      noRay(halo);
      root.add(halo);
      // selection cage = cyan edges of the bounding box
      const cage = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.05, size.y * 1.05, size.z * 1.05)),
        selMat,
      );
      cage.position.copy(ctr);
      cage.visible = false;
      noRay(cage);
      root.add(cage);

      const ref: PartRefs = {
        key, part, behavior, root, nodes: objs, driven,
        glow: glow as PartRefs['glow'], halo: halo as PartRefs['halo'], edge: cage, bb,
        active: false, speed: 1, level: 0, slideTarget: null, slideF: 0, alarmSev: null, alarmPulse: false,
      };

      if (behavior === 'spin') {
        const axis = (prm.axis as 'x' | 'y' | 'z') ?? 'y';
        if (prm.self === true) {
          // rotate the nodes themselves about their box centre: wrap each in a
          // pivot placed at that centre (attach keeps the world transform)
          ref.pivots = objs.map((o) => {
            const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
            const pivot = new THREE.Group();
            o.parent!.add(pivot);
            pivot.position.copy(o.parent!.worldToLocal(c));
            pivot.attach(o);
            return pivot;
          });
          (ref as PartRefs & { spinAxis?: string }).spinAxis = axis;
        } else {
          const r = Math.min(Math.max(0.3 * Math.min(size.x, size.z), 0.15), 0.6);
          const fan = new THREE.Group();
          const blade = std(C.edge.clone());
          for (let k = 0; k < 6; k++) {
            const b = box(r, 0.02, r * 0.22, blade);
            b.position.x = r / 2;
            const arm = new THREE.Group();
            arm.rotation.y = (k * Math.PI) / 3;
            arm.add(b);
            fan.add(arm);
          }
          fan.add(box(r * 0.3, 0.06, r * 0.3, std(C.detail.clone())));
          fan.position.set(ctr.x, bb.max.y + 0.06, ctr.z);
          fan.traverse(noRay);
          root.add(fan);
          ref.spinner = fan;
        }
        if (part.kind === 'mixer' && prm.mix !== false) {
          // concrete mass turning inside the drum (visible in X-ray)
          const ax = longAxis(size);
          const others = ax === 'x' ? [size.y, size.z] : ax === 'y' ? [size.x, size.z] : [size.x, size.y];
          const r = 0.36 * Math.min(others[0], others[1]);
          const len = 0.8 * size[ax];
          const oriented = new THREE.Group();
          if (ax === 'x') oriented.rotation.z = Math.PI / 2;
          if (ax === 'z') oriented.rotation.x = Math.PI / 2;
          const spin = new THREE.Group();
          const shell = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, len, 28, 1, false),
            new THREE.MeshStandardMaterial({ map: concrete, roughness: 1, transparent: true, opacity: 0.9 }),
          );
          noRay(shell);
          // paddles so the turning reads
          const pad = std(C.edge.clone());
          for (let k = 0; k < 4; k++) {
            const p = box(r * 0.9, len * 0.9, 0.05, pad);
            p.rotation.y = (k * Math.PI) / 2;
            noRay(p);
            spin.add(p);
          }
          spin.add(shell);
          oriented.add(spin);
          oriented.position.copy(ctr);
          root.add(oriented);
          ref.mix = { spin, shell };
        }
      } else if (behavior === 'belt') {
        const axis: 'x' | 'z' = (prm.axis === 'x' || prm.axis === 'z') ? prm.axis : size.x >= size.z ? 'x' : 'z';
        const len = axis === 'x' ? size.x : size.z;
        const n = Math.min(Math.max(Math.round(len / 1.4), 3), 8);
        const lumpMat = std(C.lump.clone());
        ref.lumps = [];
        for (let k = 0; k < n; k++) {
          const l = box(0.2, 0.14, 0.2, lumpMat);
          l.rotation.y = k * 0.7;
          noRay(l);
          root.add(l);
          ref.lumps.push(l);
        }
        ref.beltAxis = axis;
      } else if (behavior === 'level') {
        // gauge on the corner facing the camera: track + fill
        const h = size.y * 0.9;
        const gx = bb.max.x + 0.12;
        const gz = bb.max.z + 0.12;
        const track = box(0.1, h, 0.1, new THREE.MeshBasicMaterial({ color: C.mid, transparent: true, opacity: 0.55 }));
        track.position.set(gx, bb.min.y + h / 2, gz);
        noRay(track);
        root.add(track);
        const mat = std(C.fill.clone());
        const fill = box(0.1, h, 0.1, mat);
        fill.scale.y = 0.001;
        fill.position.set(gx, bb.min.y, gz);
        fill.renderOrder = 1;
        noRay(fill);
        root.add(fill);
        ref.gauge = { fill, base: bb.min.y, height: h, mat };
        // open bins: the material heap itself rises inside
        if (prm.fill !== false && size.y < 1.6 * Math.max(size.x, size.z)) {
          const hh = size.y * 0.42;
          const heap = box(size.x * 0.82, hh, size.z * 0.82, std(C.lump.clone(), { roughness: 1 }));
          heap.scale.y = 0.001;
          heap.position.set(ctr.x, bb.min.y + size.y * 0.5, ctr.z);
          noRay(heap);
          root.add(heap);
          ref.heap = { mesh: heap, base: bb.min.y + size.y * 0.5, height: hh };
        }
      } else if (behavior === 'flow') {
        const segs: FlowSeg[] = [];
        for (const o of objs) {
          o.traverse((c) => {
            if (!(c as THREE.Mesh).isMesh) return;
            const b = new THREE.Box3().setFromObject(c);
            const s = b.getSize(new THREE.Vector3());
            const ax = longAxis(s);
            const long = s[ax];
            const thick = Math.max(...(['x', 'y', 'z'] as const).filter((q) => q !== ax).map((q) => s[q]));
            if (long < 0.3 || long < 2.2 * thick) return; // bends, flanges, clamps
            const mid = b.getCenter(new THREE.Vector3());
            const a = mid.clone(); const z = mid.clone();
            a[ax] = b.min[ax]; z[ax] = b.max[ax];
            segs.push({ a, b: z, n: Math.max(2, Math.ceil(long / 0.4)), r: Math.min(Math.max(thick * 0.35, 0.025), 0.09) });
          });
        }
        const total = Math.min(segs.reduce((t, s) => t + s.n, 0), Math.max(0, MAX_DOTS - dots));
        dots += total;
        if (total > 0) {
          const mesh = new THREE.InstancedMesh(
            new THREE.SphereGeometry(1, 8, 6),
            new THREE.MeshBasicMaterial({ color: FLUID[(prm.color as string) ?? 'water'] ?? FLUID.water }),
            total,
          );
          mesh.frustumCulled = false;
          mesh.visible = false;
          noRay(mesh);
          root.add(mesh);
          ref.flow = { mesh, segs };
        }
      } else if (behavior === 'slide') {
        const dir = Array.isArray(prm.dir) ? new THREE.Vector3(...(prm.dir as [number, number, number])) : new THREE.Vector3(0, 1, 0);
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        ref.slide = {
          base: objs.map((o) => o.getWorldPosition(new THREE.Vector3())),
          dir: dir.normalize(),
          dist: ((typeof prm.dist === 'number' ? prm.dist : 20) / 100) * footprint,
          period: typeof prm.period === 'number' ? prm.period : 12,
        };
      } else {
        const lampMat = new THREE.MeshBasicMaterial({ color: C.mid.clone() });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), lampMat);
        lamp.position.set(ctr.x, bb.max.y + 0.25, ctr.z);
        noRay(lamp);
        root.add(lamp);
        ref.lamp = lampMat;
      }
      equipment.push(ref);
    });
    // place the belt lumps once so a stopped belt still shows its load
    for (const e of equipment) if (e.lumps && e.beltAxis) placeLumps(e, 0);
    applyXray();
    applyVisibility();
  };

  const placeLumps = (e: PartRefs, ph: number) => {
    const ax = e.beltAxis!;
    const lo = e.bb.min[ax] + 0.3, len = Math.max(e.bb.max[ax] - e.bb.min[ax] - 0.6, 0.1);
    const mid = ax === 'x' ? (e.bb.min.z + e.bb.max.z) / 2 : (e.bb.min.x + e.bb.max.x) / 2;
    e.lumps!.forEach((l, i) => {
      const p = lo + ((ph * 0.9 * e.speed + (i * len) / e.lumps!.length) % len);
      const off = i % 2 ? 0.08 : -0.08;
      if (ax === 'x') l.position.set(p, e.bb.max.y + 0.08, mid + off);
      else l.position.set(mid + off, e.bb.max.y + 0.08, p);
    });
  };

  buildEquipment(input.parts);

  /* ---------- editor highlight ---------- */
  let hiCage: THREE.LineSegments | null = null;

  /* ---------- runtime state ---------- */
  const state = { reduceMotion: false, phase: 0, preview: false };
  let needsRender = true;
  let flyTo: { t: number; from: THREE.Vector3; to: THREE.Vector3; z0: number; z1: number } | null = null;

  const hitChain = (clientX: number, clientY: number, roots_: THREE.Object3D[]): THREE.Object3D | null => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(roots_, true).filter((h) => h.object.visible);
    return hits.length ? hits[0].object : null;
  };

  const tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  const view: LineSceneView = {
    renderer, scene, camera, controls, canvas, nodes, roots,
    setParts(parts) { buildEquipment(parts); needsRender = true; },
    pick(clientX, clientY) {
      const o = hitChain(clientX, clientY, pickRoots);
      let n: THREE.Object3D | null = o;
      while (n && n.userData.part === undefined) n = n.parent;
      return n ? (n.userData.part as string) : null;
    },
    pickNodeChain(clientX, clientY) {
      // the editor needs EVERY mesh pickable, not just mapped parts
      const stash: [THREE.Object3D, THREE.Object3D['raycast']][] = [];
      yard.traverse((o) => { if (Object.prototype.hasOwnProperty.call(o, 'raycast')) { stash.push([o, o.raycast]); Reflect.deleteProperty(o, 'raycast'); } });
      const hit = hitChain(clientX, clientY, [yard]);
      for (const [o, fn] of stash) o.raycast = fn;
      if (!hit) return null;
      const chain: number[] = [];
      for (let o: THREE.Object3D | null = hit; o && o !== yard; o = o.parent) {
        const idx = objNode.get(o);
        if (idx !== undefined) chain.push(idx);
      }
      return chain.length ? chain : null;
    },
    highlight(indices) {
      if (hiCage) { scene.remove(hiCage); hiCage.geometry.dispose(); hiCage = null; }
      const objs = (indices ?? []).map((n) => nodeObj.get(n)).filter((o): o is THREE.Object3D => !!o);
      if (objs.length) {
        const b = unionBox(objs);
        const s = b.getSize(new THREE.Vector3());
        hiCage = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x * 1.04 + 0.04, s.y * 1.04 + 0.04, s.z * 1.04 + 0.04)), hiMat);
        hiCage.position.copy(b.getCenter(new THREE.Vector3()));
        noRay(hiCage);
        scene.add(hiCage);
      }
      needsRender = true;
    },
    nodeBox(index) {
      const o = nodeObj.get(index);
      if (!o) return null;
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) return null;
      return { min: b.min.toArray() as [number, number, number], max: b.max.toArray() as [number, number, number] };
    },
    partBoxes() {
      return equipment.map((e) => ({
        key: e.key,
        min: e.bb.min.toArray() as [number, number, number],
        max: e.bb.max.toArray() as [number, number, number],
      }));
    },
    plan(kind, widthPx) {
      // flat render of the model alone: overlays/floor hidden, white bg
      const bb = new THREE.Box3().setFromObject(yard);
      const [ax, ay]: [number, number] = kind === 'top' ? [0, 2] : [0, 1];
      const min: [number, number] = [bb.min.getComponent(ax), bb.min.getComponent(ay)];
      const max: [number, number] = [bb.max.getComponent(ax), bb.max.getComponent(ay)];
      const pad = 0.5;
      min[0] -= pad; min[1] -= pad; max[0] += pad; max[1] += pad;
      const w = Math.round(widthPx);
      const h = Math.max(2, Math.round((w * (max[1] - min[1])) / (max[0] - min[0])));
      const cam = new THREE.OrthographicCamera(min[0], max[0], max[1], min[1], 0.1, 500);
      if (kind === 'top') {
        // looking down -y with +x right, +z down the page: screen-up = -z
        cam.left = min[0]; cam.right = max[0]; cam.top = -min[1]; cam.bottom = -max[1];
        cam.position.set(0, 200, 0);
        cam.up.set(0, 0, -1);
        cam.lookAt(0, 0, 0);
      } else {
        cam.position.set(0, (min[1] + max[1]) / 2, 200);
        cam.lookAt(0, (min[1] + max[1]) / 2, 0);
      }
      cam.updateProjectionMatrix();

      const hide: THREE.Object3D[] = [floor, grid, ...equipment.map((e) => e.root)];
      const was = hide.map((o) => o.visible);
      hide.forEach((o) => { o.visible = false; });
      const prevBg = scene.background, prevFog = scene.fog, prevOverride = scene.overrideMaterial;
      scene.background = new THREE.Color(0xffffff);
      scene.fog = null;
      scene.overrideMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      renderer.setRenderTarget(prevTarget);
      (scene.overrideMaterial as THREE.Material).dispose();
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      scene.fog = prevFog;
      hide.forEach((o, i) => { o.visible = was[i]; });
      rt.dispose();

      // GL origin is bottom-left; canvas is top-left
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      }
      ctx.putImageData(img, 0, 0);
      needsRender = true;
      return { url: cv.toDataURL('image/png'), min, max };
    },
    setXray(mode, partKey = null) { xray = { mode, key: partKey }; applyXray(); needsRender = true; },
    isolate(partKey) { isolateKey = partKey; applyVisibility(); needsRender = true; },
    hidePart(partKey, hidden) {
      if (hidden) hiddenKeys.add(partKey); else hiddenKeys.delete(partKey);
      applyVisibility(); needsRender = true;
    },
    focus(partKey) {
      const e = partKey === null ? null : equipment.find((x) => x.key === partKey);
      if (partKey !== null && !e) return;
      const to = e ? e.bb.getCenter(new THREE.Vector3()) : target0.clone();
      let z1 = 1;
      if (e) {
        const s = e.bb.getSize(new THREE.Vector3());
        z1 = Math.min(Math.max((VIEW_H * 1.1) / Math.max(s.x, s.y, s.z, 0.5), controls.minZoom), controls.maxZoom);
      }
      flyTo = { t: 0, from: controls.target.clone(), to, z0: camera.zoom, z1 };
      needsRender = true;
    },
    resetView() { flyTo = null; controls.reset(); needsRender = true; },
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
      const anim = equipment.some((e) => e.active || e.alarmPulse || e.slideTarget !== null) && !state.reduceMotion;
      let changed = needsRender;
      needsRender = false;
      if (flyTo) {
        flyTo.t = Math.min(1, flyTo.t + dtMs / 650);
        const k = flyTo.t * flyTo.t * (3 - 2 * flyTo.t);
        const next = flyTo.from.clone().lerp(flyTo.to, k);
        camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
        camera.zoom = flyTo.z0 + (flyTo.z1 - flyTo.z0) * k;
        camera.updateProjectionMatrix();
        if (flyTo.t >= 1) flyTo = null;
        changed = true;
      }
      if (controls.update()) changed = true;
      if (anim) {
        state.phase += dtMs;
        const ph = state.phase / 1000;
        const dt = dtMs / 1000;
        for (const e of equipment) {
          if (e.active) {
            const rpm = typeof e.part.params?.rpm === 'number' ? (e.part.params.rpm as number) : 30;
            const ang = ph * rpm * 0.10472;
            if (e.spinner) e.spinner.rotation.y = ang;
            if (e.pivots) {
              const ax = (e as PartRefs & { spinAxis?: 'x' | 'y' | 'z' }).spinAxis ?? 'y';
              e.pivots.forEach((p) => { p.rotation.set(0, 0, 0); p.rotation[ax] = ang; });
            }
            if (e.mix) e.mix.spin.rotation.y = ang * 0.6;
            if (e.lumps && e.beltAxis) placeLumps(e, ph);
          }
          if (e.flow) {
            e.flow.mesh.visible = e.active;
            if (e.active) {
              const dir = e.part.params?.reverse === true ? -1 : 1;
              let idx = 0;
              for (const s of e.flow.segs) {
                for (let k = 0; k < s.n && idx < e.flow.mesh.count; k++, idx++) {
                  const t = (((ph * 0.55 * e.speed * dir + k / s.n) % 1) + 1) % 1;
                  tmpV.lerpVectors(s.a, s.b, t);
                  tmpS.setScalar(s.r);
                  tmpM.compose(tmpV, tmpQ, tmpS);
                  e.flow.mesh.setMatrixAt(idx, tmpM);
                }
              }
              e.flow.mesh.instanceMatrix.needsUpdate = true;
            }
          }
          if (e.slide) {
            // position tag wins; otherwise ping-pong while `run` is on
            if (e.slideTarget !== null) e.slideF += (e.slideTarget - e.slideF) * Math.min(dt * 3, 1);
            else if (e.active) e.slideF = 0.5 - 0.5 * Math.cos((ph / e.slide.period) * Math.PI * 2);
            e.nodes.forEach((n, i) => {
              tmpV.copy(e.slide!.base[i]).addScaledVector(e.slide!.dir, e.slide!.dist * e.slideF);
              if (n.parent) n.position.copy(n.parent.worldToLocal(tmpV));
            });
          }
          // unacked alarm under-glow pulses ~0.8 Hz
          if (e.alarmPulse) e.glow.material.opacity = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(ph * Math.PI * 1.6));
        }
        changed = true;
      }
      if (changed) renderer.render(scene, camera);
      return changed;
    },
    dispose() {
      controls.dispose();
      clearEquipment();
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
      concrete.dispose();
      selMat.dispose();
      hiMat.dispose();
      renderer.dispose();
      palette.dispose();
      // the <canvas> stays in the DOM and keeps its GL context: React owns
      // the element and a rebuilt scene (new model, retry) reuses it
    },
  };

  (view as unknown as { _i: object })._i = {
    get equipment() { return equipment; }, state, C, get parts() { return currentParts; },
  };
  return view;
}

/* ------------------------------------------------------------------ */
/* applyState — each part's signals come from its tag bindings          */
/* ------------------------------------------------------------------ */

interface Internals {
  equipment: PartRefs[];
  state: { reduceMotion: boolean; phase: number; preview: boolean };
  C: Record<string, THREE.Color>;
}

/** Live-store tag names a part reads (dotted, site-prefixed). */
export function partSignals(part: PlantPart): string[] {
  return Object.values(part.bindings).map(liveName);
}

export function applyState(view: LineSceneView, store: typeof live, opts: ApplyOpts = {}): void {
  const { equipment, state, C } = (view as unknown as { _i: Internals })._i;
  state.reduceMotion = !!opts.reduceMotion;
  state.preview = !!opts.preview;
  const now = Date.now();

  for (const e of equipment) {
    const b = e.part.bindings;
    const signals = partSignals(e.part);
    const fresh = (path: string | undefined) => {
      if (!path) return false;
      const tv = store.latest.get(liveName(path));
      return !!tv && now - (Date.parse(tv.ts) || 0) <= STALE_MS;
    };
    const flag = b.run ?? b.open ?? b.state;
    const flowV = b.flow ? Number(liveValue(b.flow)) : NaN;
    e.active = opts.preview
      || (fresh(flag) && truthy(liveValue(flag)))
      || (e.behavior === 'flow' && !flag && fresh(b.flow) && flowV > 0.01);
    const sp = b.speed ? Number(liveValue(b.speed)) : flowV;
    e.speed = Number.isFinite(sp) && sp > 0 ? Math.min(Math.max(sp / (b.speed ? 1.2 : 100), 0.3), 3) : 1;
    // slider: a bound position tag (0..100 %) drives it directly
    const pos = b.position ? Number(liveValue(b.position)) : NaN;
    e.slideTarget = e.behavior === 'slide' && fresh(b.position) && Number.isFinite(pos) && !opts.preview
      ? Math.min(Math.max(pos / 100, 0), 1) : null;

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
    e.edge.visible = opts.selected === e.key;
    for (const m of e.driven) {
      m.emissive.copy(C.live);
      m.emissiveIntensity = e.active ? 0.18 : 0;
    }
    const lvlRaw = fresh(b.level) ? Number(liveValue(b.level)) : opts.preview ? 60 : 0;
    e.level = Math.max(0, Math.min(100, Number.isFinite(lvlRaw) ? lvlRaw : 0)) / 100;
    if (e.gauge) {
      e.gauge.fill.scale.y = Math.max(0.001, e.level);
      e.gauge.fill.position.y = e.gauge.base + (e.gauge.height * e.level) / 2;
      // switches: low-level -> amber fill
      const low = fresh(b.low) && truthy(liveValue(b.low));
      e.gauge.mat.color.copy(low ? C.warn : C.fill);
    }
    if (e.heap) {
      e.heap.mesh.scale.y = Math.max(0.001, e.level);
      e.heap.mesh.position.y = e.heap.base + (e.heap.height * e.level) / 2;
    }
    if (e.mix) {
      const load = fresh(b.current) ? Math.min(Number(liveValue(b.current)) / 95, 1) : e.active ? 0.6 : 0.15;
      e.mix.shell.scale.set(1, 1, 1);
      (e.mix.shell.material as THREE.MeshStandardMaterial).opacity = 0.35 + 0.55 * Math.max(load, e.active ? 0.5 : 0);
    }
    if (e.lamp) e.lamp.color.copy(e.active ? C.ok : C.mid);
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
