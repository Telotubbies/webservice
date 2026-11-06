// Side captures of each mapped 3D part for the 2D board: the model is loaded
// off-screen, only one part's meshes are shown at a time and rendered with an
// orthographic camera on a transparent background, from the wider horizontal
// face (so a belt is never seen end-on). Pure three.js, no React; loaded lazily.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { PlantPart } from '../../lib/plantModel';
import { partKey } from './boardLayout';
import type { PartBox } from './scene';

export interface PartCapture {
  key: string;
  w: number; h: number;              // pixels
  view: 'side' | 'front';
  url: string;                       // data:image/png
  box: { min: [number, number, number]; max: [number, number, number] };
}

const FOOTPRINT = 22;      // same normalised plant size as the 3D scene
const PX_PER_UNIT = 90;
const MAX_PX = 900;

const round3 = (v: number[]) => v.map((x) => +x.toFixed(3)) as [number, number, number];

export const toPartBoxes = (caps: PartCapture[]): PartBox[] => caps.map((c) => ({ key: c.key, min: c.box.min, max: c.box.max }));

/** Render every drawable part (pipes are lines on the board, not pictures). */
export async function capturePartImages(url: string, parts: PlantPart[]): Promise<PartCapture[]> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const root = gltf.scene;
  const nodeObj = new Map<number, THREE.Object3D>();
  (gltf.parser.associations as Map<unknown, { nodes?: number }>).forEach((v, k) => {
    if (v.nodes !== undefined && (k as THREE.Object3D).isObject3D) nodeObj.set(v.nodes, k as THREE.Object3D);
  });
  const scene = new THREE.Scene();
  scene.add(root);
  root.updateWorldMatrix(true, true);
  let bb = new THREE.Box3().setFromObject(root);
  const sz = bb.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(FOOTPRINT / Math.max(sz.x, sz.z, 1e-6));
  root.updateWorldMatrix(true, true);
  bb = new THREE.Box3().setFromObject(root);
  const c = bb.getCenter(new THREE.Vector3());
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= bb.min.y;
  root.updateWorldMatrix(true, true);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b1, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sun);
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x000000, 0);
  r.setPixelRatio(1);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

  const out: PartCapture[] = [];
  try {
    for (const part of parts) {
      if (part.kind === 'pipe') continue;
      const keep = new Set<THREE.Mesh>();
      part.nodes.forEach((n) => nodeObj.get(n)?.traverse((m) => { if ((m as THREE.Mesh).isMesh) keep.add(m as THREE.Mesh); }));
      meshes.forEach((m) => { m.visible = keep.has(m); });
      const b = new THREE.Box3();
      keep.forEach((m) => b.expandByObject(m));
      if (b.isEmpty()) continue;
      const size = b.getSize(new THREE.Vector3()), cen = b.getCenter(new THREE.Vector3());
      const side = size.z > size.x * 1.15;
      const hw = (side ? size.z : size.x) / 2 * 1.02, hh = size.y / 2 * 1.02;
      const k = PX_PER_UNIT * Math.min(1, MAX_PX / Math.max(hw * 2 * PX_PER_UNIT, hh * 2 * PX_PER_UNIT));
      const w = Math.max(4, Math.round(hw * 2 * k)), h = Math.max(4, Math.round(hh * 2 * k));
      r.setSize(w, h, false);
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 500);
      if (side) cam.position.set(cen.x + 100, cen.y, cen.z); else cam.position.set(cen.x, cen.y, cen.z + 100);
      cam.lookAt(cen);
      cam.updateMatrixWorld();
      sun.position.copy(cam.position).add(new THREE.Vector3(-40, 60, 0));
      r.render(scene, cam);
      out.push({ key: partKey(part), w, h, view: side ? 'side' : 'front', url: canvas.toDataURL('image/png'),
        box: { min: round3(b.min.toArray()), max: round3(b.max.toArray()) } });
    }
  } finally {
    r.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
    });
  }
  return out;
}
