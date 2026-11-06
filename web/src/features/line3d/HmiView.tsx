// SCADA-style 2D mimic of the plant twin: ISA-101 grey equipment symbols laid
// out from the model (hmiLayout), live value boxes with ISA tag letters,
// running/alarm state colour, animated belts and pipe flow, an alarm banner
// and a status strip of the runnable equipment. Selection is shared with the
// 3D view, so the faceplate (start/stop through the guarded command path)
// stays in the side panel — the mimic itself never writes.

import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { formatSignal } from '../../lib/plant';
import { liveName, liveValue, truthy, type Kinds, type PlantPart } from '../../lib/plantModel';
import type { PartBox } from './scene';
import { layoutHmi, type HmiNode } from './hmiLayout';

// ISA-5.1 first letters for the numeric roles shown in value boxes
const ISA: Record<string, string> = {
  level: 'LI', weight: 'WI', speed: 'SI', current: 'II', pressure: 'PI', flow: 'FI',
  temperature: 'TI', temp: 'TI', position: 'ZI', value: 'XI', rpm: 'SI',
};
const FLUID: Record<string, string> = { water: '#2f7fc8', air: '#8d99ae', cement: '#7c7f86', admixture: '#9b5fc0' };
export const C = {
  body: '#cdd2db', edge: '#4f5869', run: '#4a5563',   // running = dark neutral, never green (ISA-101)
  alarm: '#d6342c', warn: '#e0a100',
  sel: '#0e9bb5', fill: '#7d9cc9', text: '#1d2330', muted: '#5d6676',
};

export const runFlag = (p: PlantPart) => p.bindings.run ?? p.bindings.open ?? p.bindings.state;
export const numRoles = (p: PlantPart) => Object.keys(p.bindings).filter((r) => !['run', 'open', 'state', 'door', 'high', 'low'].includes(r));

/** Long names wrap at the last space so they fit over a narrow symbol. */
function twoLines(label: string, w: number): string[] {
  const cut = label.lastIndexOf(' ');
  return label.length * 7.5 > w + 24 && cut > 0 ? [label.slice(0, cut), label.slice(cut + 1)] : [label];
}

export function useAlarmed(parts: PlantPart[]) {
  useStore(() => live.version);
  const map = new Map<string, 'critical' | 'warning'>();
  const owner = new Map<string, string>();
  parts.forEach((p, i) => Object.values(p.bindings).forEach((path) => owner.set(liveName(path), String(i))));
  for (const a of live.alarms) {
    if (a.state === 'cleared') continue;
    const k = owner.get(a.tag);
    if (k === undefined) continue;
    const sev = a.severity === 'critical' ? 'critical' : 'warning';
    if (map.get(k) !== 'critical') map.set(k, sev);
  }
  return map;
}

/** ISA value box: tag letters + live value + unit; dims when stale. */
export function ValueBox({ x, y, role, path, now }: { x: number; y: number; role: string; path: string; now: number }) {
  const { i18n } = useTranslation();
  const name = liveName(path);
  const tv = live.latest.get(name);
  const stale = !tv || now - Date.parse(tv.ts) > STALE_MS;
  const unit = live.tags.find((t) => t.name === name)?.unit ?? (role === 'level' ? '%' : '');
  const val = tv && !stale ? formatSignal(name, tv.v, i18n.language) : '———';
  return (
    <g transform={`translate(${x - 54} ${y})`}>
      <title>{`${role}: ${name}`}</title>
      <rect width="108" height="22" fill="#fff" stroke="#8b94a6" strokeWidth="0.8" />
      <rect width="24" height="22" fill="#e9ecf1" stroke="#8b94a6" strokeWidth="0.8" />
      <text x="12" y="15" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted}>{ISA[role] ?? 'XI'}</text>
      <text x="76" y="15.5" textAnchor="end" fontSize="13" fontWeight="700" className="font-mono" fill={stale ? '#9aa1ad' : C.text}>{val}</text>
      <text x="79" y="15.5" fontSize="10" fill={C.muted}>{unit}</text>
    </g>
  );
}

function Symbol({ n, active, alarm, level, stale }: { n: HmiNode; active: boolean; alarm?: 'critical' | 'warning'; level: number; stale: boolean }) {
  const { w, h } = n;
  const x = -w / 2, y = -h / 2;
  const fill = active ? C.run : C.body;
  const stroke = alarm ? (alarm === 'critical' ? C.alarm : C.warn) : C.edge;
  const sw = alarm ? 2.5 : 1.2;
  const cls = alarm ? 'hmi-alarm' : undefined;
  switch (n.part.kind) {
    case 'vessel': {
      // silo: cylinder + cone, level fill clipped to the shape
      const cone = h * 0.22;
      const d = `M${x} ${y + 6} Q${x} ${y} ${x + 6} ${y} H${-x - 6} Q${-x} ${y} ${-x} ${y + 6} V${-y - cone} L${w * 0.14} ${-y} H${-w * 0.14} L${x} ${-y - cone} Z`;
      const lvl = Number.isFinite(level) ? Math.min(Math.max(level, 0), 100) / 100 : 0;
      const id = `hmiclip-${n.key}`;
      return (
        <g>
          <clipPath id={id}><path d={d} /></clipPath>
          <path d={d} fill="#eef0f4" />
          {lvl > 0 && <rect x={x} y={-y - h * lvl} width={w} height={h * lvl} fill={stale ? '#b9bec8' : C.fill} clipPath={`url(#${id})`} />}
          <path d={d} fill="none" stroke={stroke} strokeWidth={sw} className={cls} />
          {Number.isFinite(level) && [0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={-x - 8} x2={-x} y1={-y - h * f} y2={-y - h * f} stroke={C.muted} strokeWidth="0.8" />
          ))}
        </g>
      );
    }
    case 'conveyor':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={C.body} stroke={stroke} strokeWidth={sw} className={cls} />
          <line x1={x + h / 2} x2={-x - h / 2} y1={y + 3} y2={y + 3} stroke={active ? C.run : '#7a8394'} strokeWidth="2.4"
            className={active ? 'hmi-flow' : undefined} />
          {[x + h / 2, -x - h / 2].map((cx) => (
            <g key={cx}><circle cx={cx} cy={0} r={h / 2 - 3} fill={active ? C.run : '#eef0f4'} stroke={C.edge} strokeWidth="1" />
              <circle cx={cx} cy={0} r={1.6} fill={C.edge} /></g>
          ))}
        </g>
      );
    case 'mixer':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <g className={active ? 'hmi-spin' : undefined}>
            <line x1={-h * 0.3} x2={h * 0.3} y1={0} y2={0} stroke="#fff" strokeWidth="3" />
            <line x1={0} x2={0} y1={-h * 0.3} y2={h * 0.3} stroke="#fff" strokeWidth="3" />
          </g>
          <rect x={-8} y={-y} width={16} height={8} fill={C.body} stroke={C.edge} />
        </g>
      );
    case 'pump': {
      const r = w / 2;
      return (
        <g>
          <circle r={r} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <path d={`M${-r * 0.5} ${-r * 0.62} L${r * 0.75} 0 L${-r * 0.5} ${r * 0.62} Z`} fill="#fff" fillOpacity={0.85} />
          <line x1={-r} x2={-r - 12} y1={0} y2={0} stroke={C.edge} strokeWidth="2" />
          <line x1={r} x2={r} y1={0} y2={-r - 10} stroke={C.edge} strokeWidth="2" />
        </g>
      );
    }
    case 'motor':
      return (
        <g>
          <circle r={w / 2} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <text y={6} textAnchor="middle" fontSize="18" fontWeight="700" fill={active ? '#fff' : C.text}>M</text>
        </g>
      );
    case 'valve':
      return (
        <g>
          <path d={`M${x} ${y} L${-x} ${-y} V${y} L${x} ${-y} Z`} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <line x1={0} x2={0} y1={0} y2={y - 8} stroke={C.edge} strokeWidth="1.5" />
          <rect x={-8} y={y - 14} width={16} height={6} fill={C.body} stroke={C.edge} />
        </g>
      );
    case 'slider':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <path d={`M0 ${y + 12} V${-y - 12} M-7 ${y + 20} L0 ${y + 12} L7 ${y + 20} M-7 ${-y - 20} L0 ${-y - 12} L7 ${-y - 20}`}
            stroke={active ? '#fff' : C.edge} strokeWidth="2" fill="none" />
        </g>
      );
    default: // indicator / filter: housing with bag lines
      return (
        <g>
          <rect x={x} y={y} width={w} height={h * 0.75} fill={fill} stroke={stroke} strokeWidth={sw} className={cls} />
          <path d={`M${x} ${y + h * 0.75} L${-6} ${-y} H6 L${-x} ${y + h * 0.75}`} fill={C.body} stroke={C.edge} strokeWidth="1" />
          {[-0.3, 0, 0.3].map((f) => <line key={f} x1={w * f} x2={w * f} y1={y + 6} y2={y + h * 0.7} stroke={active ? '#fff' : C.muted} strokeWidth="1.5" />)}
        </g>
      );
  }
}

export function HmiView({ parts, boxes, kinds, sel, onSelect }: {
  parts: PlantPart[]; boxes: PartBox[]; kinds: Kinds; sel: string | null; onSelect: (k: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  useStore(() => live.version);
  const lay = useMemo(() => layoutHmi(parts, boxes), [parts, boxes]);
  const alarmed = useAlarmed(parts);
  const node = new Map(lay.nodes.map((n) => [n.key, n]));
  const runnable = lay.nodes.filter((n) => runFlag(n.part) && kinds[n.part.kind]?.roles[n.part.bindings.run ? 'run' : 'open']?.writable !== false)
    .sort((a, b) => a.x - b.x);
  const open = live.alarms.filter((a) => a.state !== 'cleared').sort((a, b) => b.ts.localeCompare(a.ts));
  const latest = open[0];
  const running = lay.nodes.filter((n) => truthy(liveValue(runFlag(n.part)))).length;
  const loc = i18n.language === 'th' ? 'th-TH' : 'en-GB';
  const clock = new Date(now).toLocaleTimeString(loc, { hour12: false });
  const date = new Date(now).toLocaleDateString(loc);
  const press = (k: string) => ({
    role: 'button' as const, tabIndex: 0, 'aria-pressed': sel === k, className: 'hmi-node cursor-pointer',
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(sel === k ? null : k); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel === k ? null : k); } },
  });

  return (
    <div className="absolute inset-0 flex flex-col bg-[#dfe2e8] text-[12px]">
      {/* header strip */}
      <div className="flex h-9 shrink-0 items-center gap-4 bg-[#2f3747] px-3 text-white">
        <span className="font-semibold tracking-wide">{t('plant.hmi.title')}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/80">
          <span className={`inline-block h-2 w-2 rounded-full ${live.ws === 'open' ? 'bg-[#3fd18a]' : 'bg-[#e0a100]'}`} />
          {live.ws === 'open' ? t('plant.hmi.online') : t('plant.hmi.offline')}
        </span>
        <span className="text-[11px] text-white/80">{t('plant.hmi.running', { n: running, total: lay.nodes.length })}</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${open.length ? 'bg-[#d6342c]' : 'bg-white/10'}`}>
          {t('plant.hmi.alarms', { n: open.length })}
        </span>
        <span className="ml-auto font-mono text-[12px] tabular-nums">{date} {clock}</span>
      </div>

      {/* mimic */}
      <div className="min-h-0 flex-1 overflow-auto">
        <svg viewBox={`0 0 ${lay.w} ${lay.h}`} className="h-full min-w-[900px] w-full select-none" preserveAspectRatio="xMidYMid meet"
          role="group" aria-label={t('plant.mode.hmi')} onClick={() => onSelect(null)}>
          <style>{`.hmi-flow { stroke-dasharray: 10 8; animation: hmiflow .9s linear infinite; }
@keyframes hmiflow { to { stroke-dashoffset: -18; } }
.hmi-spin { animation: hmispin 1.6s linear infinite; transform-box: fill-box; transform-origin: center; }
@keyframes hmispin { to { transform: rotate(360deg); } }
.hmi-alarm { animation: hmiblink 1s steps(2, start) infinite; }
@keyframes hmiblink { to { stroke-opacity: .25; } }
.hmi-node:focus-visible { outline: none; } .hmi-node:focus-visible .hmi-sel { stroke: ${C.sel}; stroke-opacity: 1; }
@media (prefers-reduced-motion: reduce) { .hmi-flow, .hmi-spin, .hmi-alarm { animation: none; } }`}</style>

          {/* area captions */}
          {([['store', 50], ['process', 440], ['move', 700]] as const).map(([k, y]) => (
            <text key={k} x={16} y={y} fontSize="12" fontWeight="700" letterSpacing="1.5" fill="#7b8495">{t(`plant.hmi.row.${k}`).toUpperCase()}</text>
          ))}

          {/* feed drops vessel → belt */}
          {lay.links.map((l) => (
            <g key={`${l.from}-${l.to}`}>
              <polyline points={l.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#8a93a4" strokeWidth="6" strokeLinejoin="round" />
              <polyline points={l.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#c4c9d2" strokeWidth="3.5" strokeLinejoin="round" />
              {(() => { const [x, y] = l.pts[l.pts.length - 1]; return <path d={`M${x - 6} ${y - 9} L${x} ${y - 2} L${x + 6} ${y - 9}`} fill="none" stroke="#5d6676" strokeWidth="1.6" />; })()}
            </g>
          ))}

          {/* pipe headers */}
          {lay.pipes.map((p) => {
            const col = FLUID[String(p.part.params?.color ?? 'water')] ?? FLUID.water;
            const on = truthy(liveValue(p.part.bindings.run));
            return (
              <g key={p.key} {...press(p.key)}>
                <title>{p.part.label}</title>
                <line x1={p.x0 - 20} x2={p.x1 + 20} y1={p.y} y2={p.y} stroke={col} strokeWidth="7" strokeOpacity="0.35" />
                <line x1={p.x0 - 20} x2={p.x1 + 20} y1={p.y} y2={p.y} stroke={col} strokeWidth="3" className={on ? 'hmi-flow' : undefined} />
                {p.stubs.map((k) => {
                  const n = node.get(k)!;
                  const yEdge = n.row === 'store' ? n.y + n.h / 2 - 4 : n.y - n.h / 2;
                  return <line key={k} x1={n.x + (n.row === 'store' ? 14 : -14)} x2={n.x + (n.row === 'store' ? 14 : -14)} y1={p.y} y2={yEdge}
                    stroke={col} strokeWidth="3" strokeOpacity="0.8" />;
                })}
                <text x={p.x1 + 150 > lay.w ? p.x0 - 26 : p.x1 + 26} y={p.y + 4} fontSize="12" fill={C.muted}
                  textAnchor={p.x1 + 150 > lay.w ? 'end' : 'start'}>{p.part.label}</text>
                {sel === p.key && <line x1={p.x0 - 20} x2={p.x1 + 20} y1={p.y} y2={p.y} stroke={C.sel} strokeWidth="11" strokeOpacity="0.35" />}
              </g>
            );
          })}

          {/* equipment */}
          {lay.nodes.map((n) => {
            const active = truthy(liveValue(runFlag(n.part)));
            const level = n.part.bindings.level ? Number(liveValue(n.part.bindings.level)) : NaN;
            const lvTs = n.part.bindings.level ? live.latest.get(liveName(n.part.bindings.level))?.ts : undefined;
            const lvStale = !lvTs || now - Date.parse(lvTs) > STALE_MS;
            const alarm = alarmed.get(n.key);
            const hi = truthy(liveValue(n.part.bindings.high));
            const lo = truthy(liveValue(n.part.bindings.low));
            const vals = numRoles(n.part);
            const below = n.y + n.h / 2 + (n.part.kind === 'vessel' ? 10 : 8);
            const above = n.y - n.h / 2 - 8;
            return (
              <g key={n.key} {...press(n.key)} aria-label={`${n.part.label}${active ? ` — ${t('plant.hmi.on')}` : ''}${alarm ? ` — ${t('plant.hmi.inAlarm')}` : ''}`}>
                <rect className="hmi-sel" x={n.x - n.w / 2 - 8} y={n.y - n.h / 2 - 8} width={n.w + 16} height={n.h + 16} rx="4"
                  fill={sel === n.key ? '#0e9bb5' : 'transparent'} fillOpacity={0.08} stroke={C.sel}
                  strokeOpacity={sel === n.key ? 1 : 0} strokeDasharray="5 3" strokeWidth="1.5" />
                <g transform={`translate(${n.x} ${n.y})`}>
                  <Symbol n={n} active={active} alarm={alarm} level={level} stale={lvStale} />
                </g>
                <text x={n.x} y={above} textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}
                  style={{ paintOrder: 'stroke', stroke: '#dfe2e8', strokeWidth: 3 }}>
                  {twoLines(n.part.label, n.w).map((ln, i, all) => (
                    <tspan key={i} x={n.x} dy={i === 0 ? -(all.length - 1) * 14 : 14}>{ln}</tspan>
                  ))}
                </text>
                {Number.isFinite(level) && n.part.kind === 'vessel' && (
                  <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="14" fontWeight="700" className="font-mono"
                    fill="#fff" fillOpacity={lvStale ? 0.6 : 1} style={{ paintOrder: 'stroke', stroke: lvStale ? '#7d8492' : '#3b4a63', strokeWidth: 3 }}>{Math.round(level)}%</text>
                )}
                {(hi || lo) && (
                  <g transform={`translate(${n.x + n.w / 2 + 4} ${hi ? n.y - n.h / 2 + 6 : n.y + n.h / 2 - 30})`}>
                    <rect width="24" height="14" rx="2" fill={hi ? C.alarm : C.warn} />
                    <text x="12" y="10.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">{hi ? 'H' : 'L'}</text>
                  </g>
                )}
                {runFlag(n.part) && n.part.kind !== 'vessel' && (
                  <g transform={`translate(${n.x + n.w / 2 + 2} ${n.y - n.h / 2 - 2})`}>
                    <circle r="5" fill={active ? C.run : '#9aa1ad'} stroke="#fff" strokeWidth="1.2" />
                  </g>
                )}
                {vals.slice(0, 3).map((r, i) => (
                  <ValueBox key={r} x={n.x} y={below + i * 25} role={r} path={n.part.bindings[r]} now={now} />
                ))}
                {Object.keys(n.part.bindings).length === 0 && (
                  <text x={n.x} y={below + 12} textAnchor="middle" fontSize="11" fill="#8d95a3" fontStyle="italic">{t('plant.hmi.unmapped')}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* equipment status strip (selection opens the faceplate with start/stop) */}
      {runnable.length > 0 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-[#b9bfca] bg-[#e9ebf0] px-2 py-1.5" role="group" aria-label={t('plant.hmi.groups')}>
          {runnable.map((n) => {
            const on = truthy(liveValue(runFlag(n.part)));
            const al = alarmed.get(n.key);
            return (
              <button key={n.key} type="button" aria-pressed={sel === n.key} onClick={() => onSelect(sel === n.key ? null : n.key)}
                className={`flex min-w-[118px] flex-col items-stretch rounded-[3px] border text-left focus-visible:outline-2 focus-visible:outline-blue ${sel === n.key ? 'border-[#0e9bb5] ring-1 ring-[#0e9bb5]' : 'border-[#9aa2b1]'}`}>
                <span className={`truncate px-2 py-0.5 text-[10.5px] font-bold ${al ? 'bg-[#d6342c] text-white' : on ? 'bg-[#4a5563] text-white' : 'bg-[#c6ccd6] text-[#1d2330]'}`}>{n.part.label}</span>
                <span className="flex items-center justify-between bg-paper px-2 py-0.5 text-[10px] text-ink-68">
                  {on ? t('plant.hmi.on') : t('plant.hmi.off')}
                  <span className={`h-2 w-2 rounded-full ${on ? 'bg-[#4a5563]' : 'bg-[#c6ccd6] ring-1 ring-[#9aa1ad]'}`} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* alarm banner */}
      <div className={`flex h-7 shrink-0 items-center gap-3 border-t border-[#b9bfca] px-3 font-mono text-[11.5px] ${latest ? 'bg-paper text-[#b3261e]' : 'bg-paper text-ink-46'}`} role="status">
        {latest ? (
          <>
            <span className="font-bold">{open.length}</span>
            <span>{new Date(latest.ts).toLocaleTimeString(loc, { hour12: false })}</span>
            <span className="rounded bg-[#d6342c] px-1.5 text-[10px] font-bold uppercase text-white">{latest.severity}</span>
            <span className="truncate">{latest.tag} — {latest.rule}</span>
            <Link to="/alarms" className="ml-auto font-sans text-[11px] font-semibold text-blue hover:underline">{t('plant.hmi.allAlarms')}</Link>
          </>
        ) : <span>{t('plant.hmi.noAlarms')}</span>}
      </div>
    </div>
  );
}
