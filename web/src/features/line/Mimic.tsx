// Mimic — 2D SVG schematic of the sorting line: motor → belt (animated when
// running) → vision camera → bin (fill level). Nodes mirror EQUIPMENT and are
// clickable to select; live values overlay from the tag store.

import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { EQUIPMENT, T, formatSignal, unitOf, type EquipmentId } from '../../lib/plant';

function Val({ tag, x, y }: { tag: string; x: number | string; y: number | string }) {
  const { i18n } = useTranslation();
  const now = useNow();
  const tv = live.latest.get(tag);
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  const unit = unitOf(tag);
  return (
    <text x={x} y={y} textAnchor="middle" className="fill-ink font-mono text-[11px] font-semibold" opacity={stale ? 0.4 : 1}>
      {tv && !stale ? `${formatSignal(tag, tv.v, i18n.language)}${unit ? ' ' + unit : ''}` : '—'}
    </text>
  );
}

export function Mimic({ sel, onSelect }: { sel: EquipmentId | null; onSelect: (id: EquipmentId) => void }) {
  const { t } = useTranslation();
  useStore(() => live.version);
  const running = live.latest.get(T.running)?.v === 1 || live.latest.get(T.running)?.v === true;
  const level = Number(live.latest.get(T.binLevel)?.v ?? 0);
  const ok = (id: EquipmentId) => sel === id ? '#006bc2' : '#c2c8dd';
  const hi = (id: EquipmentId) => sel === id ? 2.5 : 1;
  const eqLabel = (id: EquipmentId) => t(EQUIPMENT.find((e) => e.id === id)?.labelKey ?? 'line.conveyor');
  // <g> isn't a natively interactive SVG element — wire button semantics by hand
  const press = (id: EquipmentId) => ({
    role: 'button' as const,
    tabIndex: 0,
    className: 'mimic-node cursor-pointer',
    'aria-label': eqLabel(id),
    'aria-pressed': sel === id,
    onClick: () => onSelect(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); }
    },
  });

  return (
    <svg viewBox="0 0 640 200" className="w-full select-none" role="group" aria-label={t('line.schematic')}>
      <style>{`.mimic-run { stroke-dasharray: 8 6; animation: belt 0.8s linear infinite; } @keyframes belt { to { stroke-dashoffset: -14; } }
.mimic-node:focus-visible { outline: 2px solid #006bc2; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .mimic-run { animation: none; } }`}</style>

      {/* belt */}
      <g {...press('conveyor')}>
        <rect x="140" y="96" width="330" height="34" rx="4" fill="#f9fafb" stroke={ok('conveyor')} strokeWidth={hi('conveyor')} />
        <line x1="150" y1="113" x2="460" y2="113" stroke={running ? '#1c9a67' : '#828ba4'} strokeWidth="3" className={running ? 'mimic-run' : ''} />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx={200 + i * 120} cy="138" r="7" fill="none" stroke="#828ba4" strokeWidth="2" />
            <line x1={200 + i * 120} y1="133" x2={200 + i * 120} y2="143" stroke="#828ba4" strokeWidth="2" />
          </g>
        ))}
        <Val tag={T.beltSpeed} x="305" y="86" />
        <Val tag={T.beltTemp} x="305" y="160" />
      </g>

      {/* motor */}
      <g {...press('motor')}>
        <circle cx="95" cy="113" r="26" fill={running ? '#e6f5ee' : '#f9fafb'} stroke={ok('motor')} strokeWidth={hi('motor')} />
        <text x="95" y="117" textAnchor="middle" className="fill-ink-68 text-[11px] font-bold">M</text>
        <line x1="121" y1="113" x2="140" y2="113" stroke="#828ba4" strokeWidth="3" />
        <Val tag={T.running} x="95" y="72" />
        <Val tag={T.speedSp} x="95" y="160" />
      </g>

      {/* camera */}
      <g {...press('camera')}>
        <rect x="330" y="28" width="40" height="30" rx="4" fill="#f9fafb" stroke={ok('camera')} strokeWidth={hi('camera')} />
        <circle cx="350" cy="43" r="7" fill="none" stroke="#5e6dd6" strokeWidth="2" />
        <line x1="350" y1="58" x2="350" y2="96" stroke="#828ba4" strokeWidth="1.5" strokeDasharray="3 3" />
        <Val tag={T.gravel} x="350" y="20" />
      </g>

      {/* bin hopper */}
      <g {...press('bin')}>
        <defs>
          <clipPath id="binclip"><path d="M500 70 h90 l-14 60 h-62 Z" /></clipPath>
        </defs>
        <path d="M500 70 h90 l-14 60 h-62 Z" fill="#f9fafb" />
        <rect x="498" y={130 - 60 * (level / 100)} width="94" height={60 * (level / 100)} fill="#e8f1fb" clipPath="url(#binclip)" />
        <path d="M500 70 h90 l-14 60 h-62 Z" fill="none" stroke={ok('bin')} strokeWidth={hi('bin')} />
        <Val tag={T.binLevel} x="545" y="60" />
      </g>

      {/* flow arrow */}
      <path d="M470 113 h22 m-6 -5 l6 5 -6 5" stroke="#828ba4" strokeWidth="2" fill="none" />
    </svg>
  );
}
