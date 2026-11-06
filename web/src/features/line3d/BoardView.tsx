// The 2D plant board: side captures of each 3D part on a grey ISA-101 board,
// pipes and belts as lines, live value / run / alarm / stale state on every
// part. View mode: a part is a link to its control page (the board itself
// never writes). Edit mode: drag with snap, arrow-key nudge, select, link tool.

import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow } from '../../lib/hooks';
import { liveName, liveValue, truthy, type PlantPart } from '../../lib/plantModel';
import { routeBoard, partKey, type BoardLayout, type BoardLink, type BoardPipe } from './boardLayout';
import type { PartCapture } from './boardCapture';
import { controlHref } from './boardApi';
import { numRoles, runFlag, useAlarmed, ValueBox } from './HmiView';


const MEDIUM: Record<string, string> = {
  water: 'var(--color-medium-water)', air: 'var(--color-medium-air)', cement: 'var(--color-medium-cement)',
  admixture: 'var(--color-medium-admixture)',
};

interface Props {
  plantName: string;
  parts: PlantPart[];
  layout: BoardLayout;
  caps: Record<string, PartCapture>;
  derived: { links: BoardLink[]; pipes: BoardPipe[] };
  color: boolean;
  edit: boolean;
  linkTool: boolean;
  sel: string | null;
  showHidden: boolean;
  onSelect: (key: string | null) => void;
  onDragStart: () => void;
  onMove: (key: string, x: number, y: number) => void;
  onNudge: (key: string, dx: number, dy: number, fine: boolean) => void;
  onLinkPick: (key: string) => void;
}

const isStale = (p: PlantPart, now: number) => {
  const paths = Object.values(p.bindings);
  return paths.length > 0 && paths.every((path) => {
    const tv = live.latest.get(liveName(path));
    return !tv || now - Date.parse(tv.ts) > STALE_MS;
  });
};

export function BoardView(props: Props) {
  const { plantName, parts, layout, caps, derived, color, edit, linkTool, sel, showHidden, onSelect, onDragStart, onMove, onNudge, onLinkPick } = props;
  const { t } = useTranslation();
  const nav = useNavigate();
  const now = useNow(1000);
  const alarmed = useAlarmed(parts);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);

  const pt = (e: React.PointerEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  const lines = routeBoard(layout, derived);

  return (
    <div className="overflow-x-auto" tabIndex={-1}>
      <svg ref={svg} viewBox={`0 0 ${layout.w} ${layout.h}`} className="block h-auto w-full min-w-[720px] select-none"
        style={{ background: 'var(--color-hmi-bg)', touchAction: edit ? 'none' : 'auto' }}
        role="group" aria-label={t('board.boardLabel', { name: plantName })}
        onPointerDown={(e) => { if (e.target === svg.current) onSelect(null); }}>
        {layout.lanes.map((l) => (
          <g key={l.id}>
            <rect x={6} y={l.y} width={layout.w - 12} height={l.h + 8} rx={4} fill="var(--color-panel-2)" opacity={0.55} />
            <text x={16} y={l.y + 17} fontSize={13} fontWeight={700} fill="var(--color-ink-2)">{t(`board.area_${l.id}`, { defaultValue: l.id })}</text>
          </g>
        ))}
        {lines.map((l) => (
          <polyline key={l.id} points={l.pts.map((p) => p.join(',')).join(' ')} fill="none" strokeLinejoin="round"
            strokeWidth={l.kind === 'pipe' ? 4 : 2.5} strokeDasharray={l.kind === 'manual' ? '6 4' : undefined}
            stroke={l.kind === 'pipe' ? (MEDIUM[l.medium ?? ''] ?? 'var(--color-medium-signal)') : 'var(--color-hmi-line-idle)'} />
        ))}
        {parts.map((p, i) => {
          const key = partKey(p), it = layout.items[key], cap = caps[key];
          if (!it || !cap || (it.hidden && !showHidden)) return null;
          const alarm = alarmed.get(String(i));
          const stale = isStale(p, now);
          const running = truthy(liveValue(runFlag(p)));
          const roles = numRoles(p).filter((r) => p.bindings[r]);
          const selected = sel === key;
          const stroke = alarm === 'critical' ? 'var(--color-crit)' : alarm === 'warning' ? 'var(--color-warn)'
            : selected ? 'var(--color-accent)' : 'var(--color-hmi-edge)';
          const body = (
            <g data-part={p.label} data-alarm={alarm ?? ''} data-stale={stale ? '1' : '0'} data-locked={it.locked ? '1' : '0'}
              data-x={it.x} data-y={it.y} transform={`translate(${it.x} ${it.y})`} opacity={it.hidden ? 0.35 : stale ? 0.55 : 1}
              className={alarm ? 'hmi-alarm' : undefined}>
              <rect x={-4} y={-4} width={it.w + 8} height={it.h + 8} rx={3} fill="var(--color-panel)" fillOpacity={0.6}
                stroke={stroke} strokeWidth={alarm || selected ? 2.5 : 1} />
              <image href={cap.url} width={it.w} height={it.h} preserveAspectRatio="xMidYMid meet"
                style={color ? undefined : { filter: 'grayscale(1) contrast(0.95)' }} />
              {running && <rect x={-4} y={-4} width={it.w + 8} height={4} fill="var(--color-hmi-equip-run)" />}
              {it.locked && <text x={it.w} y={-8} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--color-ink-2)">{t('board.locked')}</text>}
              <text x={it.w / 2} y={it.h + 17} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink)">{p.label}</text>
              {roles[0] && <ValueBox x={it.w / 2} y={it.h + 24} role={roles[0]} path={p.bindings[roles[0]]} now={now} />}
              {stale && <text x={it.w / 2} y={it.h / 2} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-ink-2)">{t('board.stale')}</text>}
              {alarm && <title>{alarm === 'critical' ? t('board.alarmCrit') : t('board.alarmWarn')}</title>}
            </g>
          );
          const label = `${p.label}${alarm ? `, ${alarm === 'critical' ? t('board.alarmCrit') : t('board.alarmWarn')}` : ''}${stale ? `, ${t('board.stale')}` : ''}`;
          if (!edit) {
            return (
              <a key={key} href={controlHref(p)} aria-label={`${t('board.openControls', { name: p.label })}. ${label}`} className="cursor-pointer outline-none focus-visible:[&_rect]:stroke-[3]"
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.button) return; e.preventDefault(); void nav(controlHref(p)); }}>
                {body}
              </a>
            );
          }
          return (
            <g key={key} tabIndex={0} role="button" aria-pressed={selected} aria-label={label}
              className={it.locked ? 'cursor-not-allowed outline-none' : 'cursor-move outline-none'}
              onFocus={() => onSelect(key)}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (linkTool) { onLinkPick(key); return; }
                onSelect(key);
                if (it.locked) return;
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                const q = pt(e);
                drag.current = { key, dx: q.x - it.x, dy: q.y - it.y };
                onDragStart();
              }}
              onPointerMove={(e) => { const d = drag.current; if (d) { const q = pt(e); onMove(d.key, q.x - d.dx, q.y - d.dy); } }}
              onPointerUp={() => { drag.current = null; }}
              onKeyDown={(e) => {
                const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
                if (!dir) return;
                e.preventDefault();
                onNudge(key, dir[0], dir[1], e.shiftKey);
              }}>
              {body}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
