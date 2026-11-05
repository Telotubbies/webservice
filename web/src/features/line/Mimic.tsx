// Mimic — ISA-101 side elevation of sorting line 1: the inclined conveyor
// CV-101 carries gravel past the vision camera AT-101 and drops it into bin
// B-101; the drive motor M-101 sits on the head pulley. Grey equipment,
// colour only for alarms (priority shape + colour on the value that tripped),
// moving analog indicators against the configured alarm limits, and a dark
// fill — never green — for running. The drawing never writes; controls live
// in the faceplate beside it.

import type { KeyboardEvent, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { LINE_EQUIPMENT as EQUIPMENT, T, formatSignal, unitOf, type LineEquipmentId as EquipmentId } from '../../lib/plant';
import type { AlarmRule } from '../../types';

/** ISA-5.1 equipment numbers and value-box letters for this line. */
export const ISA_TAG: Record<EquipmentId, string> = { motor: 'M-101', conveyor: 'CV-101', camera: 'AT-101', bin: 'B-101' };
const LETTERS: Record<string, string> = { [T.speedSp]: 'SC', [T.beltSpeed]: 'SI', [T.beltTemp]: 'TI', [T.binLevel]: 'LI', [T.gravel]: 'AI' };
const ABBR: Record<string, string> = { hihi: 'HH', hi: 'H', lo: 'L', lolo: 'LL' };

const C = {
  equip: 'var(--color-hmi-equip)', run: 'var(--color-hmi-equip-run)', level: 'var(--color-hmi-level)',
  edge: '#6b7485', body: '#eef0f4', text: 'var(--color-ink)', muted: 'var(--color-ink-46)',
  crit: 'var(--color-danger-bright)', warn: 'var(--color-warn)', sel: 'var(--color-blue)',
};

type Prio = 'critical' | 'warning';
interface AlarmMark { prio: Prio; unacked: boolean }

/** Open alarms per tag (worst priority wins; any unacked one keeps it flashing). */
function useAlarmMarks(): Map<string, AlarmMark> {
  useStore(() => live.alarmRev);
  const m = new Map<string, AlarmMark>();
  for (const a of live.alarms) {
    if (a.state === 'cleared') continue;
    const prio: Prio = a.severity === 'critical' ? 'critical' : 'warning';
    const cur = m.get(a.tag);
    m.set(a.tag, {
      prio: cur?.prio === 'critical' ? 'critical' : prio,
      unacked: (cur?.unacked ?? false) || a.state === 'active',
    });
  }
  return m;
}

/** Enabled limit rules per tag, for the analog indicators. */
export function useLimits(): Map<string, AlarmRule[]> {
  const q = useQuery({ queryKey: ['alarm-rules'], queryFn: api.alarmRules, staleTime: 60_000 });
  const m = new Map<string, AlarmRule[]>();
  for (const r of q.data ?? []) {
    if (!r.enabled || r.tag == null || r.threshold == null || !(r.kind in ABBR)) continue;
    m.set(r.tag, [...(m.get(r.tag) ?? []), r]);
  }
  return m;
}

function useValue(tag: string) {
  const { i18n } = useTranslation();
  const now = useNow();
  const tv = live.latest.get(tag);
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS || tv.q === 'stale' || tv.q === 'bad';
  return { tv, stale, text: tv && !stale ? formatSignal(tag, tv.v, i18n.language) : '———' };
}

/** Priority shape, drawn — ▲ critical, ◆ warning (shape + colour, never colour alone). */
function PrioGlyph({ x, y, prio }: { x: number; y: number; prio: Prio }) {
  return prio === 'critical'
    ? <path d={`M${x} ${y - 7} L${x + 7} ${y + 6} L${x - 7} ${y + 6} Z`} style={{ fill: C.crit }} />
    : <path d={`M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z`} style={{ fill: C.warn, stroke: '#5c4300', strokeWidth: 0.8 }} />;
}

/** ISA value box: tag letters | value unit; stale reads as dashes, an alarm
 *  colours the frame and puts the priority shape in front of it. */
function ValueBox({ tag, x, y, w = 124, alarm }: { tag: string; x: number; y: number; w?: number; alarm?: AlarmMark }) {
  const { text, stale } = useValue(tag);
  const unit = unitOf(tag) ?? '';
  const frame = alarm ? (alarm.prio === 'critical' ? C.crit : C.warn) : '#8b94a6';
  return (
    <g transform={`translate(${x} ${y})`}>
      <title>{tag}</title>
      {alarm && <PrioGlyph x={-12} y={12} prio={alarm.prio} />}
      <rect width={w} height="24" fill="#fff" style={{ stroke: frame }} strokeWidth={alarm ? 2 : 0.8} className={alarm?.unacked ? 'hmi-alarm' : undefined} />
      <rect width="28" height="24" fill="#e9ecf1" stroke="#8b94a6" strokeWidth="0.8" />
      <text x="14" y="16" textAnchor="middle" fontSize="10.5" fontWeight="700" style={{ fill: C.muted }}>{LETTERS[tag] ?? 'XI'}</text>
      <text x={w - 34} y="17" textAnchor="end" fontSize="14" fontWeight="700" className="font-mono" style={{ fill: stale ? '#9aa1ad' : C.text }}>{text}</text>
      <text x={w - 30} y="17" fontSize="10.5" style={{ fill: C.muted }}>{unit}</text>
    </g>
  );
}

/** Moving analog indicator: the value's position on its range, with the
 *  alarm limits marked — so "how close to the limit" is visible at a glance. */
function AnalogBar({ tag, x, y, w, range, limits }: { tag: string; x: number; y: number; w: number; range: [number, number]; limits: AlarmRule[] }) {
  const { tv, stale } = useValue(tag);
  const pos = (v: number) => x + ((Math.min(Math.max(v, range[0]), range[1]) - range[0]) / (range[1] - range[0])) * w;
  const v = tv && !stale ? Number(tv.v) : null;
  return (
    <g aria-hidden>
      <rect x={x} y={y} width={w} height="6" fill="#e3e6ec" />
      {limits.map((r) => (
        <g key={r.name}>
          <line x1={pos(r.threshold!)} x2={pos(r.threshold!)} y1={y - 4} y2={y + 10} stroke="#4a5563" strokeWidth="1.5" />
          <text x={pos(r.threshold!)} y={y + 21} textAnchor="middle" fontSize="9.5" style={{ fill: C.muted }}>{`${ABBR[r.kind]} ${r.threshold}`}</text>
        </g>
      ))}
      {v != null && <path d={`M${pos(v)} ${y - 1} l-5 -8 h10 Z`} fill="#18202a" />}
    </g>
  );
}

function Caption({ x, y, id, anchor = 'start' }: { x: number; y: number; id: EquipmentId; anchor?: 'start' | 'middle' | 'end' }) {
  const { t } = useTranslation();
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="12" style={{ fill: C.muted }}>
      <tspan fontWeight="700" style={{ fill: C.text }}>{ISA_TAG[id]}</tspan>
      <tspan dx="6">{t(EQUIPMENT.find((e) => e.id === id)!.labelKey)}</tspan>
    </text>
  );
}

// belt geometry: tail pulley (x0,y0) → head pulley (x1,y1), top run
const B = { x0: 120, y0: 300, x1: 620, y1: 150, r: 16 };
const beltY = (x: number) => B.y0 + ((B.y1 - B.y0) * (x - B.x0)) / (B.x1 - B.x0);
// bin hopper under the head pulley
const BIN = { x: 590, y: 196, w: 160, h: 104, cone: 44, out: 24 };

export function Mimic({ sel, onSelect }: { sel: EquipmentId | null; onSelect: (id: EquipmentId) => void }) {
  const { t } = useTranslation();
  useStore(() => live.version);
  const marks = useAlarmMarks();
  const limits = useLimits();
  const runV = live.latest.get(T.running)?.v;
  const running = runV === true || runV === 1;
  const lv = Number(live.latest.get(T.binLevel)?.v);
  const level = Number.isFinite(lv) ? Math.min(Math.max(lv, 0), 100) : null;

  // <g> isn't a natively interactive SVG element — wire button semantics by hand
  const node = (id: EquipmentId, box: [number, number, number, number], children: ReactNode) => (
    <g role="button" tabIndex={0} className="mimic-node cursor-pointer" aria-label={`${ISA_TAG[id]} ${t(EQUIPMENT.find((e) => e.id === id)!.labelKey)}`}
      aria-pressed={sel === id} onClick={(e) => { e.stopPropagation(); onSelect(id); }}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}>
      <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} rx="6" fill="transparent"
        className="mimic-sel" style={{ stroke: C.sel }} strokeWidth="2" strokeDasharray="5 4" strokeOpacity={sel === id ? 1 : 0} />
      {children}
    </g>
  );

  const binD = `M${BIN.x} ${BIN.y} h${BIN.w} v${BIN.h} L${BIN.x + BIN.w / 2 + BIN.out / 2} ${BIN.y + BIN.h + BIN.cone} h${-BIN.out} L${BIN.x} ${BIN.y + BIN.h} Z`;
  const fillH = (BIN.h + BIN.cone) * ((level ?? 0) / 100);
  const binHi = limits.get(T.binLevel) ?? [];
  const levelY = (pct: number) => BIN.y + BIN.h + BIN.cone - (BIN.h + BIN.cone) * (pct / 100);

  return (
    <svg viewBox="0 0 960 420" className="w-full min-w-[720px] select-none" role="group" aria-label={t('line.schematic')}>
      <style>{`.mimic-flow { stroke-dasharray: 14 10; animation: mimicflow .9s linear infinite; }
@keyframes mimicflow { to { stroke-dashoffset: 24; } }
.hmi-alarm { animation: hmiblink 1s steps(2, start) infinite; }
@keyframes hmiblink { to { stroke-opacity: .25; } }
.mimic-node:focus-visible { outline: none; } .mimic-node:focus-visible .mimic-sel { stroke-opacity: 1; }
@media (prefers-reduced-motion: reduce) { .mimic-flow, .hmi-alarm { animation: none; } }`}</style>

      {/* ground + flow captions */}
      <line x1="20" x2="940" y1="388" y2="388" stroke="#c5ccd5" strokeWidth="1.5" />
      <text x="24" y="262" fontSize="11" style={{ fill: C.muted }}>{t('line.fromFeeder')}</text>
      <path d="M24 272 h70 m-7 -5 l7 5 -7 5" stroke="#8b94a6" strokeWidth="1.5" fill="none" />
      <text x={BIN.x + BIN.w / 2 + 18} y="380" fontSize="11" style={{ fill: C.muted }}>{t('line.toStockpile')}</text>
      <path d={`M${BIN.x + BIN.w / 2} ${BIN.y + BIN.h + BIN.cone + 12} v26 m-5 -7 l5 7 5 -7`} stroke="#8b94a6" strokeWidth="1.5" fill="none" />

      {/* CV-101 conveyor */}
      {node('conveyor', [96, 128, 552, 236], <>
        {[220, 470].map((x) => (
          <line key={x} x1={x} x2={x} y1={beltY(x) + B.r} y2="388" stroke={C.edge} strokeWidth="2" />
        ))}
        <line x1={B.x0} y1={B.y0 - B.r} x2={B.x1} y2={B.y1 - B.r} stroke={C.edge} strokeWidth="3" />
        <line x1={B.x0} y1={B.y0 + B.r} x2={B.x1} y2={B.y1 + B.r} stroke={C.edge} strokeWidth="3" />
        <line x1={B.x0} y1={B.y0 - B.r - 6} x2={B.x1} y2={B.y1 - B.r - 6} strokeWidth="3"
          style={{ stroke: running ? C.run : C.equip }} className={running ? 'mimic-flow' : undefined} />
        {[[B.x0, B.y0], [B.x1, B.y1]].map(([cx, cy]) => (
          <g key={cx}>
            <circle cx={cx} cy={cy} r={B.r} style={{ fill: C.body }} stroke={C.edge} strokeWidth="2" />
            <circle cx={cx} cy={cy} r="3" fill={C.edge} />
          </g>
        ))}
        <ValueBox tag={T.beltSpeed} x={150} y={196} alarm={marks.get(T.beltSpeed)} />
        <ValueBox tag={T.beltTemp} x={250} y={300} alarm={marks.get(T.beltTemp)} />
        <AnalogBar tag={T.beltTemp} x={250} y={340} w={124} range={[0, 100]} limits={limits.get(T.beltTemp) ?? []} />
        <Caption x={100} y={356} id="conveyor" />
      </>)}

      {/* AT-101 vision camera over the belt */}
      {node('camera', [322, 26, 270, 124], <>
        <line x1="380" x2="380" y1="40" y2="70" stroke={C.edge} strokeWidth="2" />
        <rect x="352" y="70" width="56" height="32" rx="4" style={{ fill: C.body }} stroke={C.edge} strokeWidth="2" />
        <circle cx="380" cy="86" r="8" fill="#fff" stroke={C.edge} strokeWidth="2" />
        <path d={`M366 102 L346 ${beltY(346) - B.r - 10} M394 102 L414 ${beltY(414) - B.r - 10}`} stroke="#8b94a6" strokeWidth="1.2" strokeDasharray="4 4" />
        <ValueBox tag={T.gravel} x={430} y={74} w={112} alarm={marks.get(T.gravel)} />
        <Caption x={430} y={62} id="camera" />
      </>)}

      {/* B-101 gravel bin, level against its alarm limit */}
      {node('bin', [578, 186, 340, 196], <>
        <path d={`M${B.x1 + 8} ${B.y1 + 6} Q${B.x1 + 26} ${B.y1 + 20} ${B.x1 + 22} ${BIN.y - 6}`} stroke="#8b94a6" strokeWidth="1.5" strokeDasharray="3 4" fill="none" />
        <clipPath id="mimic-bin"><path d={binD} /></clipPath>
        <path d={binD} fill="#f4f5f8" />
        {level != null && <rect x={BIN.x} y={BIN.y + BIN.h + BIN.cone - fillH} width={BIN.w} height={fillH} style={{ fill: C.level }} clipPath="url(#mimic-bin)" />}
        {binHi.map((r) => (
          <g key={r.name}>
            <line x1={BIN.x} x2={BIN.x + BIN.w} y1={levelY(r.threshold!)} y2={levelY(r.threshold!)} stroke="#4a5563" strokeWidth="1.2" strokeDasharray="6 4" />
            <text x={BIN.x + 6} y={levelY(r.threshold!) - 4} fontSize="9.5" style={{ fill: C.text }}>{`${ABBR[r.kind]} ${r.threshold}`}</text>
          </g>
        ))}
        <path d={binD} fill="none" stroke={C.edge} strokeWidth="2" />
        {[25, 50, 75].map((p) => (
          <line key={p} x1={BIN.x + BIN.w - 10} x2={BIN.x + BIN.w} y1={levelY(p)} y2={levelY(p)} stroke={C.edge} strokeWidth="1" />
        ))}
        <rect x={BIN.x + BIN.w / 2 - 16} y={BIN.y + BIN.h + BIN.cone} width="32" height="10" style={{ fill: C.body }} stroke={C.edge} strokeWidth="1.5" />
        <ValueBox tag={T.binLevel} x={772} y={262} alarm={marks.get(T.binLevel)} />
        <Caption x={772} y={250} id="bin" />
      </>)}

      {/* M-101 drive motor on the head pulley */}
      {node('motor', [600, 26, 330, 116], <>
        <line x1={B.x1} y1={B.y1} x2="700" y2="86" stroke={C.edge} strokeWidth="3" />
        <circle cx="700" cy="86" r="26" style={{ fill: running ? C.run : '#fff', stroke: running ? C.run : C.edge }} strokeWidth="2" />
        <text x="700" y="91" textAnchor="middle" fontSize="15" fontWeight="700" style={{ fill: running ? '#fff' : C.muted }}>M</text>
        <text x="700" y="128" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing=".5" style={{ fill: C.text }}>
          {runV === undefined ? '———' : running ? t('plant.hmi.on') : t('plant.hmi.off')}
        </text>
        <ValueBox tag={T.speedSp} x={772} y={74} w={112} alarm={marks.get(T.speedSp)} />
        <Caption x={772} y={62} id="motor" />
      </>)}
    </svg>
  );
}
