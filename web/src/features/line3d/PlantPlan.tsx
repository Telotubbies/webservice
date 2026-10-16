// The model's flat 2D drawing (plan or front elevation) with each mapped part
// as a live hotspot. Shared by the twin page and the Line 2D page; the image
// is rendered once per model from an off-screen scene and cached.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { liveValue, truthy, type PlantPart } from '../../lib/plantModel';
import type { LineSceneView, PlanImage, PlanKind } from './scene';
import type { SceneSource } from './useSceneSource';

const cache = new Map<string, PlanImage>();

/** Render `kind` of the source's model headlessly (cached per model + mapping). */
export function usePlantPlan(src: SceneSource, kind: PlanKind) {
  const key = `${src.model?.id ?? 'demo'}:${kind}`;
  const [img, setImg] = useState<PlanImage | null>(() => cache.get(key) ?? null);
  const [view, setView] = useState<LineSceneView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src.status !== 'ready') return;
    let dead = false;
    let v: LineSceneView | null = null;
    const canvas = document.createElement('canvas');
    void import('./scene').then(({ buildScene }) => buildScene(canvas, { url: src.url, parts: src.parts })).then((built) => {
      if (dead) { built.dispose(); return; }
      v = built;
      built.setSize(1200, 800);
      const got = cache.get(key) ?? built.plan(kind, 1800);
      cache.set(key, got);
      setImg(got);
      setView(built);
    }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; v?.dispose(); };
  }, [src.status, src.url, src.parts, kind, key]);
  return { img, view, failed };
}

/** 2D plan / front elevation: the model's flat render with each mapped part
 *  as a live hotspot (tinted while active, amber/red on alarm). */
export function PlanView({ kind, img, view, parts, sel, onSelect }: {
  kind: PlanKind; img: PlanImage; view: LineSceneView | null; parts: PlantPart[];
  sel: string | null; onSelect: (k: string | null) => void;
}) {
  const { t } = useTranslation();
  useStore(() => live.version);
  const [w, h] = [img.max[0] - img.min[0], img.max[1] - img.min[1]];
  const boxes = view?.partBoxes() ?? [];
  const ax = (x: number) => x - img.min[0];
  // top: image row 0 = min z; front: image row 0 = max y
  const ay = (v: number) => (kind === 'top' ? v - img.min[1] : img.max[1] - v);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full bg-white" preserveAspectRatio="xMidYMid meet"
      role="group" aria-label={t(`plant.mode.${kind}`)} onClick={() => onSelect(null)}>
      <image href={img.url} x="0" y="0" width={w} height={h} />
      {boxes.map((b) => {
        const p = parts[Number(b.key)];
        if (!p || p.kind === 'pipe') return null;     // a pipe's box spans the plant — flow shows in 3D
        const [x0, x1] = [ax(b.min[0]), ax(b.max[0])];
        const [y0, y1] = kind === 'top' ? [ay(b.min[2]), ay(b.max[2])] : [ay(b.max[1]), ay(b.min[1])];
        const flag = p.bindings.run ?? p.bindings.open ?? p.bindings.state;
        const active = truthy(liveValue(flag));
        const lvl = p.bindings.level ? Number(liveValue(p.bindings.level)) : NaN;
        const selected = sel === b.key;
        const label = Math.max(h / 55, 0.35);
        return (
          <g key={b.key} role="button" tabIndex={0} aria-label={p.label} aria-pressed={selected}
            className="cursor-pointer focus-visible:outline-none"
            onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : b.key); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected ? null : b.key); } }}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0}
              fill={active ? '#1c9a67' : '#5e6dd6'} fillOpacity={active ? 0.35 : 0.14}
              stroke={selected ? '#149eb4' : active ? '#1c9a67' : '#5e6dd6'} strokeWidth={selected ? h / 300 : h / 700} />
            {Number.isFinite(lvl) && (
              <rect x={x0} y={y1 - (y1 - y0) * (Math.min(Math.max(lvl, 0), 100) / 100)} width={x1 - x0}
                height={(y1 - y0) * (Math.min(Math.max(lvl, 0), 100) / 100)} fill="#149eb4" fillOpacity={0.45} />
            )}
            {(selected || ['vessel', 'mixer', 'pump', 'slider'].includes(p.kind)) && <text x={(x0 + x1) / 2} y={y0 - label * 0.3} textAnchor="middle" fontSize={label}
              className="fill-ink-68 font-semibold" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: label / 5 }}>
              {p.label}
            </text>}
          </g>
        );
      })}
    </svg>
  );
}
