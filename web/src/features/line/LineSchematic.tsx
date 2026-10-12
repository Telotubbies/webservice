// Live process schematic of sorting line 1: drive motor → conveyor → vision
// camera → gravel bin. Equipment is drawn in neutral greys; colour appears only
// for abnormal state (ISA-101 informed). The drawing is SVG; readouts are HTML
// overlays positioned in % so text never scales below the SDLC 07 floors.

import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { EQUIPMENT, SIGNALS, T, formatSignal, type EquipmentId } from '../../lib/plant';
import { Icon } from '../../shared/ui/Icon';
import { normSeverity } from '../../shared/ui/Status';
import './line.css';

const W = 1200;
const H = 360;

function useSignal(name: string, now: number) {
  const v = live.latest.get(name);
  const stale = !v || now - (Date.parse(v.ts) || 0) > STALE_MS;
  return { v, stale };
}

export function useEquipmentAlarm(id: EquipmentId): 'critical' | 'warning' | null {
  useStore(() => live.alarmRev);
  const signals = EQUIPMENT.find((e) => e.id === id)?.signals ?? [];
  let worst: 'critical' | 'warning' | null = null;
  for (const a of live.alarms) {
    if (a.state === 'cleared' || !signals.includes(a.tag)) continue;
    const s = normSeverity(a.severity);
    if (s === 'critical') return 'critical';
    if (s === 'warning') worst = 'warning';
  }
  return worst;
}

function Readout({ name, x, y, align = 'center', now }: {
  name: string; x: number; y: number; align?: 'center' | 'left' | 'right'; now: number;
}) {
  const { t, i18n } = useTranslation();
  const { v, stale } = useSignal(name, now);
  const meta = SIGNALS[name];
  const alarm = live.alarms.some((a) => a.tag === name && a.state !== 'cleared');
  return (
    <div
      className={`readout readout-${align}${stale ? ' is-stale' : ''}${alarm ? ' is-alarm' : ''}`}
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
      data-signal={name}
    >
      <span className="readout-label">
        {t(meta?.labelKey ?? name)}
        {meta?.stub && <span className="badge badge-stub" title={t('overview.stubTitle')}>{t('overview.stub')}</span>}
      </span>
      <span className="readout-value">
        {stale ? t('state.stale') : formatSignal(name, v?.v, i18n.language)}
        {!stale && meta?.unit && <span className="readout-unit">{meta.unit}</span>}
      </span>
    </div>
  );
}

function Equip({ id, selected, onSelect, alarm, label, children }: {
  id: EquipmentId; selected?: boolean; onSelect?: (id: EquipmentId) => void;
  alarm: 'critical' | 'warning' | null; label: string; children: ReactNode;
}) {
  const interactive = !!onSelect;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(id); }
  };
  return (
    <g
      className={`equip${selected ? ' is-selected' : ''}${alarm ? ` has-${alarm}` : ''}${interactive ? ' is-interactive' : ''}`}
      data-equipment={id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      aria-pressed={interactive ? !!selected : undefined}
      onClick={interactive ? () => onSelect?.(id) : undefined}
      onKeyDown={interactive ? onKey : undefined}
    >
      {children}
    </g>
  );
}

export function LineSchematic({ selected, onSelect, compact = false }: {
  selected?: EquipmentId | null; onSelect?: (id: EquipmentId) => void; compact?: boolean;
}) {
  const { t } = useTranslation();
  useStore(() => live.version);
  const now = useNow(1000);
  const run = useSignal(T.running, now);
  const running = !run.stale && run.v?.v === true;
  const level = useSignal(T.binLevel, now);
  const levelPct = !level.stale && typeof level.v?.v === 'number' ? Math.max(0, Math.min(100, level.v.v)) : 0;
  const alarms = {
    motor: useEquipmentAlarm('motor'), conveyor: useEquipmentAlarm('conveyor'),
    camera: useEquipmentAlarm('camera'), bin: useEquipmentAlarm('bin'),
  };

  // bin geometry
  const binTop = 120, binBottom = 300, binH = binBottom - binTop;
  const fillY = binBottom - (binH * levelPct) / 100;

  return (
    <div className={`schematic${compact ? ' is-compact' : ''}${running ? ' is-running' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="schematic-svg" role="img" aria-label={t('line.title')}>
        <defs>
          <clipPath id="bin-clip"><path d="M920 120h220l-30 180H950z" /></clipPath>
          <pattern id="belt-tread" width="24" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 5h12" className="tread" />
          </pattern>
        </defs>

        {/* floor line */}
        <path d="M30 318H1170" className="floor" />

        {/* ---------- motor ---------- */}
        <Equip id="motor" label={t('line.motor')} selected={selected === 'motor'} onSelect={onSelect} alarm={alarms.motor}>
          <rect x="60" y="176" width="130" height="90" rx="8" className="body hit" />
          <rect x="74" y="190" width="70" height="62" rx="4" className="detail" />
          <g className={`rotor${running ? ' spin' : ''}`} style={{ transformOrigin: '167px 221px' }}>
            <circle cx="167" cy="221" r="16" className="detail" />
            <path d="M167 205v32M151 221h32" className="spoke" />
          </g>
          <rect x="88" y="266" width="74" height="40" className="body" />
          <circle cx="72" cy="188" r="7" className={`lamp${running ? ' lamp-on' : ''}`} />
          <path d="M190 221h40" className="shaft" />
        </Equip>

        {/* ---------- conveyor ---------- */}
        <Equip id="conveyor" label={t('line.conveyor')} selected={selected === 'conveyor'} onSelect={onSelect} alarm={alarms.conveyor}>
          <rect x="230" y="200" width="660" height="42" rx="21" className="body hit" />
          <rect x="246" y="208" width="628" height="26" rx="13" className="belt" />
          <rect x="246" y="208" width="628" height="26" rx="13" fill="url(#belt-tread)" className={`belt-tread${running ? ' moving' : ''}`} />
          <circle cx="251" cy="221" r="15" className="roller" />
          <circle cx="869" cy="221" r="15" className="roller" />
          {[330, 470, 610, 750].map((x) => (
            <path key={x} d={`M${x} 242v58M${x - 18} 300h36`} className="leg" />
          ))}
          {running && [300, 420, 540, 660, 780].map((x, i) => (
            <circle key={x} cx={x} cy="200" r={i % 2 ? 6 : 8} className="material" style={{ animationDelay: `${-i * 0.9}s` }} />
          ))}
        </Equip>

        {/* ---------- camera ---------- */}
        <Equip id="camera" label={t('line.camera')} selected={selected === 'camera'} onSelect={onSelect} alarm={alarms.camera}>
          <path d="M600 92v30" className="leg" />
          <rect x="560" y="44" width="100" height="48" rx="8" className="body hit" />
          <circle cx="610" cy="68" r="13" className="detail" />
          <circle cx="610" cy="68" r="5" className="lens" />
          <path d="M582 124 556 196M638 124 664 196" className="cone" />
        </Equip>

        {/* ---------- chute + bin ---------- */}
        <path d="M884 228q30 6 52 40" className="chute" />
        <Equip id="bin" label={t('line.bin')} selected={selected === 'bin'} onSelect={onSelect} alarm={alarms.bin}>
          <path d="M920 120h220l-30 180H950z" className="body hit" />
          <g clipPath="url(#bin-clip)">
            <rect x="900" y={fillY} width="260" height={binBottom - fillY + 2} className="fill" />
          </g>
          <path d="M920 120h220l-30 180H950z" className="outline" />
          {[25, 50, 75].map((p) => (
            <path key={p} d={`M${1128 - (p / 100) * 0} ${binBottom - (binH * p) / 100}h-14`} className="tick" />
          ))}
          <path d="M960 300v18M1100 300v18" className="leg" />
        </Equip>

        {/* alarm markers (shape + colour, never colour alone) */}
        {(Object.entries(alarms) as [EquipmentId, 'critical' | 'warning' | null][]).map(([id, sev]) => {
          if (!sev) return null;
          const pos = { motor: [60, 160], conveyor: [230, 184], camera: [560, 28], bin: [920, 104] }[id];
          return (
            <g key={id} className={`alarm-marker sev-${sev}`} transform={`translate(${pos[0]} ${pos[1]})`}>
              <path d="M0 0 11 -19 22 0z" />
              <path d="M11 -12v5M11 -3.5v.5" className="mark" />
            </g>
          );
        })}
      </svg>

      <div className="readouts">
        <div className="readout readout-state" style={{ left: `${(125 / W) * 100}%`, top: `${(112 / H) * 100}%` }}>
          <span className="readout-label">{t('line.motor')}</span>
          <span className={`state state-${run.stale ? 'stale' : running ? 'running' : 'stopped'}`}>
            <span className="glyph" aria-hidden />
            {t(`state.${run.stale ? 'stale' : running ? 'running' : 'stopped'}`)}
          </span>
        </div>
        {!compact && <Readout name={T.speedSp} x={125} y={330} now={now} />}
        <Readout name={T.beltSpeed} x={400} y={128} now={now} />
        <Readout name={T.beltTemp} x={790} y={128} now={now} />
        <Readout name={T.gravel} x={715} y={36} align="left" now={now} />
        <Readout name={T.binLevel} x={1030} y={58} now={now} />
      </div>

      {onSelect && !compact && !selected && (
        <p className="schematic-hint"><Icon name="info" size={16} /> {t('line.selectHint')}</p>
      )}
    </div>
  );
}
