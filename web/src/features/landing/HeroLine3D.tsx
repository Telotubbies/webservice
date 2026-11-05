// Hero twin — a small three.js model of our own sorting line: drive motor →
// belt → vision gantry → diverter → gravel bin / sand bin. Stones ride the
// belt, get scanned, and drop into the bin the vision call picks. Colours come
// from the landing's --hx-* tokens so day/night themes recolour it. Lazy-loaded
// (three is a big chunk); the SVG HeroVector is the fallback and the
// reduced-motion / no-WebGL rendering.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Labels = { motor: string; vision: string; gravel: string; sand: string };

const N = 46;                 // stones in flight
const BELT_X0 = -3.6, BELT_X1 = 2.6, BELT_Y = 0.62;
const CAM_X = 0.4;            // vision gantry position on the belt

function cssColor(el: Element, name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const c = new THREE.Color();
  try { c.setStyle(v || fallback); } catch { c.setStyle(fallback); }
  return c;
}

export default function HeroLine3D({ labels, onCount }: {
  labels: Labels;
  onCount?: (gravel: number, sand: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tags = useRef<(HTMLSpanElement | null)[]>([]);
  const countCb = useRef(onCount);
  useEffect(() => { countCb.current = onCount; }, [onCount]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = el.closest('.landing-root') ?? document.body;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL — the SVG fallback stays visible underneath
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    el.dataset.ready = '1';

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const camHome = new THREE.Vector3(7, 6.2, 8);

    // palette from the theme tokens
    const ink = cssColor(root, '--hx-h-a', '#14141c');
    const line = cssColor(root, '--hx-line', '#dbd7da');
    const accent = cssColor(root, '--hx-sparkle', '#d9455a');
    const paper = cssColor(root, '--hx-ink', '#fffcfc');
    const dark = root.classList.contains('hx-dark');

    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202030 : 0xd8d2d4, dark ? 1.4 : 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.4 : 1.8);
    sun.position.set(4, 9, 6);
    scene.add(sun);

    const body = new THREE.MeshStandardMaterial({ color: paper.clone().lerp(ink, dark ? 0.12 : 0.06), roughness: 0.75 });
    const steel = new THREE.MeshStandardMaterial({ color: ink.clone().lerp(paper, 0.35), roughness: 0.5, metalness: 0.3 });
    const beltMat = new THREE.MeshStandardMaterial({ color: ink.clone().lerp(paper, dark ? 0.2 : 0.12), roughness: 0.9 });
    const edges = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: dark ? 0.55 : 0.7 });
    const disposables: { dispose(): void }[] = [body, steel, beltMat, edges];

    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edges);
      m.add(e);
      scene.add(m);
      disposables.push(g, e.geometry);
      return m;
    };

    // floor grid — drafting paper
    const grid = new THREE.GridHelper(14, 28, line, line);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    scene.add(grid);
    disposables.push(grid.geometry, grid.material as THREE.Material);

    // belt frame + rollers
    box(BELT_X1 - BELT_X0, 0.12, 1.1, beltMat, (BELT_X0 + BELT_X1) / 2, BELT_Y - 0.06, 0);
    for (const x of [BELT_X0 + 0.3, -1.2, 1.2, BELT_X1 - 0.3]) {
      box(0.12, BELT_Y - 0.12, 0.12, steel, x, (BELT_Y - 0.12) / 2, 0.5);
      box(0.12, BELT_Y - 0.12, 0.12, steel, x, (BELT_Y - 0.12) / 2, -0.5);
    }
    // belt "chevrons" — moving tick marks so the belt reads as running
    const tickGeo = new THREE.BoxGeometry(0.04, 0.005, 0.9);
    const tickMat = new THREE.MeshBasicMaterial({ color: line });
    const ticks: THREE.Mesh[] = [];
    for (let i = 0; i < 16; i++) {
      const t = new THREE.Mesh(tickGeo, tickMat);
      t.position.set(BELT_X0 + (i / 16) * (BELT_X1 - BELT_X0), BELT_Y + 0.003, 0);
      scene.add(t); ticks.push(t);
    }
    disposables.push(tickGeo, tickMat);

    // drive motor + hopper at the head of the line
    box(0.8, 0.7, 0.7, body, BELT_X0 - 0.2, 0.35, 1.0);
    const shaft = box(0.5, 0.14, 0.14, steel, BELT_X0 - 0.2, 0.35, 0.45);
    shaft.rotation.y = Math.PI / 2;
    const hopperGeo = new THREE.CylinderGeometry(0.75, 0.25, 0.8, 4, 1, true);
    const hopper = new THREE.Mesh(hopperGeo, new THREE.MeshStandardMaterial({ color: body.color, side: THREE.DoubleSide, roughness: 0.8 }));
    hopper.rotation.y = Math.PI / 4;
    hopper.position.set(BELT_X0 + 0.35, BELT_Y + 0.85, 0);
    hopper.add(new THREE.LineSegments(new THREE.EdgesGeometry(hopperGeo), edges));
    scene.add(hopper);
    disposables.push(hopperGeo, hopper.material as THREE.Material);

    // vision gantry with a scan plane
    box(0.1, 1.5, 0.1, steel, CAM_X, BELT_Y + 0.65, 0.65);
    box(0.1, 1.5, 0.1, steel, CAM_X, BELT_Y + 0.65, -0.65);
    box(0.14, 0.1, 1.45, steel, CAM_X, BELT_Y + 1.4, 0);
    box(0.36, 0.26, 0.3, body, CAM_X, BELT_Y + 1.22, 0);
    const scanGeo = new THREE.PlaneGeometry(0.06, 1.0);
    const scanMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const scan = new THREE.Mesh(scanGeo, scanMat);
    scan.rotation.x = -Math.PI / 2;
    scan.position.set(CAM_X, BELT_Y + 0.01, 0);
    scene.add(scan);
    const coneGeo = new THREE.ConeGeometry(0.55, 1.05, 4, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(CAM_X, BELT_Y + 0.6, 0);
    cone.rotation.y = Math.PI / 4;
    scene.add(cone);
    disposables.push(scanGeo, scanMat, coneGeo, coneMat);

    // diverter flap + two bins past the tail
    const flap = box(0.7, 0.06, 0.9, steel, BELT_X1 + 0.35, BELT_Y - 0.15, 0);
    const binA = new THREE.Vector3(BELT_X1 + 1.2, 0, 1.05);   // gravel
    const binB = new THREE.Vector3(BELT_X1 + 1.2, 0, -1.05);  // sand
    for (const b of [binA, binB]) {
      box(1.2, 0.08, 1.1, body, b.x, 0.04, b.z);
      box(1.2, 0.6, 0.06, body, b.x, 0.3, b.z + 0.52);
      box(1.2, 0.6, 0.06, body, b.x, 0.3, b.z - 0.52);
      box(0.06, 0.6, 1.1, body, b.x + 0.58, 0.3, b.z);
      box(0.06, 0.6, 1.1, body, b.x - 0.58, 0.3, b.z);
    }

    // stones: gravel = angular dodecahedra, sand = small rounded lumps
    const gravelGeo = new THREE.DodecahedronGeometry(0.09, 0);
    const sandGeo = new THREE.IcosahedronGeometry(0.06, 1);
    const gravelMat = new THREE.MeshStandardMaterial({ color: ink.clone().lerp(paper, 0.45), roughness: 0.9, flatShading: true });
    const sandMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(dark ? '#c9a46a' : '#b58a4c'), roughness: 1 });
    const gravel = new THREE.InstancedMesh(gravelGeo, gravelMat, N);
    const sand = new THREE.InstancedMesh(sandGeo, sandMat, N);
    scene.add(gravel, sand);
    disposables.push(gravelGeo, sandGeo, gravelMat, sandMat, gravel, sand);

    type Stone = { kind: 0 | 1; p: THREE.Vector3; v: THREE.Vector3; z: number; spin: number; settled: boolean };
    const stones: Stone[] = [];
    const spawn = (s?: Stone, offset = 0): Stone => {
      const st = s ?? ({ p: new THREE.Vector3(), v: new THREE.Vector3() } as Stone);
      st.kind = Math.random() < 0.62 ? 0 : 1;
      st.z = (Math.random() - 0.5) * 0.7;
      st.p.set(BELT_X0 + 0.35 + offset, BELT_Y + 0.08, st.z);
      st.v.set(0, 0, 0);
      st.spin = Math.random() * 6;
      st.settled = false;
      return st;
    };
    for (let i = 0; i < N; i++) stones.push(spawn(undefined, (i / N) * (BELT_X1 - BELT_X0 - 0.4)));

    let counts = [0, 0];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e3 = new THREE.Euler();
    const s3 = new THREE.Vector3(1, 1, 1);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const SPEED = 0.85;

    const step = (dt: number, t: number) => {
      for (const tk of ticks) {
        tk.position.x += SPEED * dt;
        if (tk.position.x > BELT_X1) tk.position.x -= BELT_X1 - BELT_X0;
      }
      // the flap swings toward whichever kind is next at the tail
      const next = stones.filter((s) => s.p.x > CAM_X && s.p.x < BELT_X1 && !s.settled).sort((a, b) => b.p.x - a.p.x)[0];
      const want = next ? (next.kind === 0 ? -0.45 : 0.45) : 0;
      flap.rotation.x += (want - flap.rotation.x) * Math.min(1, dt * 6);
      scanMat.opacity = 0.35 + 0.25 * Math.sin(t * 6);

      for (const s of stones) {
        if (s.settled) continue;
        if (s.p.x < BELT_X1) {
          s.p.x += SPEED * dt;
          s.spin += dt * 0.4;
        } else {
          // launched off the tail: arc toward the chosen bin
          const bin = s.kind === 0 ? binA : binB;
          if (s.v.lengthSq() === 0) s.v.set(0.9, 0.6, (bin.z - s.z) * 1.4);
          s.v.y -= 5.5 * dt;
          s.p.addScaledVector(s.v, dt);
          s.spin += dt * 5;
          if (s.p.y < 0.14) {
            s.settled = true;
            counts[s.kind]++;
            countCb.current?.(counts[0], counts[1]);
          }
        }
      }
      // recycle settled stones back to the hopper
      for (const s of stones) if (s.settled && Math.random() < dt * 1.6) spawn(s);
    };

    const write = () => {
      stones.forEach((s, i) => {
        e3.set(s.spin, s.spin * 0.7, 0);
        q.setFromEuler(e3);
        m4.compose(s.p, q, s3);
        gravel.setMatrixAt(i, s.kind === 0 && !s.settled ? m4 : hidden);
        sand.setMatrixAt(i, s.kind === 1 && !s.settled ? m4 : hidden);
      });
      gravel.instanceMatrix.needsUpdate = true;
      sand.instanceMatrix.needsUpdate = true;
    };

    // pointer parallax — a gentle orbit, never a drag trap
    const target = new THREE.Vector2();
    const look = new THREE.Vector3(0.3, 0.5, 0);
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      target.set(((ev.clientX - r.left) / r.width - 0.5) * 2, ((ev.clientY - r.top) / r.height - 0.5) * 2);
    };
    el.addEventListener('pointermove', onMove);
    const camPos = camHome.clone();

    const anchors = [
      new THREE.Vector3(BELT_X0 - 0.2, 0.9, 1.0),
      new THREE.Vector3(CAM_X, BELT_Y + 1.5, 0),
      new THREE.Vector3(binA.x, 0.75, binA.z),
      new THREE.Vector3(binB.x, 0.75, binB.z),
    ];
    const proj = new THREE.Vector3();

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      const span = Math.max(4.1, 5.8 / aspect); // narrow screens zoom out
      cam.left = -span * aspect; cam.right = span * aspect;
      cam.top = span; cam.bottom = -span;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const draw = () => {
      camPos.set(camHome.x + target.x * 1.2, camHome.y - target.y * 0.6, camHome.z - target.x * 0.8);
      cam.position.lerp(camPos, 0.06);
      cam.lookAt(look);
      write();
      renderer.render(scene, cam);
      const w = el.clientWidth, h = el.clientHeight;
      anchors.forEach((a, i) => {
        const tag = tags.current[i];
        if (!tag) return;
        proj.copy(a).project(cam);
        // keep the label inside the stage on narrow screens
        const half = tag.offsetWidth / 2 + 6;
        const x = Math.min(w - half, Math.max(half, ((proj.x + 1) / 2) * w));
        const y = Math.max(tag.offsetHeight + 6, ((1 - proj.y) / 2) * h);
        tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      });
    };

    let raf = 0, last = performance.now(), visible = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt, now / 1000);
      draw();
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    if (reduce) {
      // settle a believable still frame, no loop
      for (let i = 0; i < 240; i++) step(1 / 30, i / 30);
      cam.position.copy(camHome);
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      delete el.dataset.ready;
      counts = [0, 0];
    };
  }, []);

  const names = [labels.motor, labels.vision, labels.gravel, labels.sand];
  return (
    <div ref={host} className="vz-twin-gl">
      {names.map((n, i) => (
        <span key={i} ref={(r) => { tags.current[i] = r; }} className={`vz-tag mono${i === 1 ? ' is-ai' : ''}`}>{n}</span>
      ))}
    </div>
  );
}
