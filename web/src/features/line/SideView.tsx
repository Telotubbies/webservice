// Side view — a process-flow elevation of the plant. Each mapped part is a
// picture rendered from the real 3D model (scripts/elevations), laid out left
// to right in process order at ONE scale so relative sizes stay true. Live
// state per part comes from the same tag bindings as the Plant twin.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { live, STALE_MS } from '../../lib/live';
import { useNow, useStore } from '../../lib/hooks';
import { liveName, liveValue, truthy, type PlantPart } from '../../lib/plantModel';
import { normSeverity } from '../../shared/ui/severity';
import { useAlarms } from '../alarms/alarms';
import elev from './elevations.json';
import './i18n';

type Pic = { file: string; w: number; h: number; mw: number; mh: number; box: number[] };
const PICS = elev as Record<string, Pic>;

type Group = { id: string; cols: string[][] };
// Process order. Each inner array is a column, stacked bottom to top.
const GROUPS: Group[] = [
  { id: 'agg', cols: [['Aggregate bin 1'], ['Aggregate bin 2'], ['Aggregate bin 3'], ['Aggregate bin 4']] },
  { id: 'belts', cols: [['Aggregate belt', 'Belt conveyor 1', 'Belt conveyor 2', 'Belt conveyor 3'], ['Belt conveyor 5', 'Belt conveyor 6', 'Belt conveyor 7', 'Belt conveyor 8']] },
  { id: 'hoist', cols: [['Skip track']] },
  { id: 'mix', cols: [['Mixer', 'Weigh hopper']] },
  { id: 'liq', cols: [['Liquid tank 1'], ['Liquid tank 2'], ['Drum emptier 1'], ['Drum emptier 2']] },
  { id: 'cem', cols: [['Cement silo 1'], ['Cement silo 2'], ['Cement silo 3'], ['Cement silo 4']] },
  { id: 'air', cols: [['Blower', 'Dust filter 1', 'Dust filter 2', 'Motor']] },
];

const ORDER = GROUPS.flatMap((g) => g.cols.flat()).map((l) => (l === 'Skip track' ? 'Skip hoist' : l));

const LABEL_H = 32;     // two lines of label under every part
const GAP = 6;          // between a part's label and the part stacked above it
const HEAD = 30;        // group heading
const PAD = 8;          // inside a group
const GROUP_GAP = 24;   // between groups (room for the flow arrows)
const MIN_LONG = 28;    // tiny parts (the motor) are enlarged to this long side, in px
const MIN_H = 14;       // thin belts keep at least this height
const BUCKET_DIR: [number, number] = [0.507, 0.862]; // the twin's skip dir (0.5, 0.85, 0), normalised
const BUCKET_DIST = 4.0; // metres of travel from 0 to 100 %

interface Placed { label: string; pic: Pic; x: number; y: number; w: number; h: number; cx: number; slot: number }
interface Layout {
  width: number; height: number; ground: number;
  groups: { id: string; x: number; w: number }[];
  items: Map<string, Placed>;
}

/** Label width: labels wrap to two lines, so the longest word decides. */
const labelW = (s: string) => Math.max(...s.split(' ').map((w) => w.length), Math.ceil(s.length / 2) + 1) * 5.9 + 20;

function layout(k: number): Layout {
  const items = new Map<string, Placed>();
  const groups: Layout['groups'] = [];
  const sizeOf = (label: string) => {
    const p = PICS[label];
    let w = p.mw * k, h = p.mh * k;
    const long = Math.max(w, h);
    if (long < MIN_LONG) { w *= MIN_LONG / long; h *= MIN_LONG / long; }
    return { w, h: Math.max(h, MIN_H) };
  };
  let tallest = 0;
  for (const g of GROUPS) {
    for (const col of g.cols) {
      let top = 0;
      for (const l of col) top += sizeOf(l).h + LABEL_H + (top ? GAP : 0);
      tallest = Math.max(tallest, top);
    }
  }
  const ground = HEAD + PAD + tallest - LABEL_H; // ground line y; the first label sits below it
  let x = 0;
  for (const g of GROUPS) {
    const gx = x;
    x += PAD;
    for (const col of g.cols) {
      const slot = Math.max(...col.map((l) => Math.max(sizeOf(l).w, g.id === 'hoist' ? 0 : labelW(l)))) + (g.id === 'mix' ? 26 : 6);
      let up = 0;
      for (const l of col) {
        const { w, h } = sizeOf(l);
        items.set(l, { label: l, pic: PICS[l], x: x + (slot - w) / 2, y: ground - up - h, w, h, cx: x + slot / 2, slot });
        up += h + LABEL_H + GAP;
      }
      x += slot;
    }
    x += PAD;
    groups.push({ id: g.id, x: gx, w: x - gx });
    x += GROUP_GAP;
  }
  return { width: x - GROUP_GAP, height: ground + LABEL_H + PAD, ground, groups, items };
}

type State = 'run' | 'stop' | 'alarm' | 'stale' | 'live' | 'none';
interface PartState { state: State; sev: 'critical' | 'warning' | null; idx: number }

function useStates(parts: PlantPart[]): Map<string, PartState> {
  const now = useNow();
  const ver = useStore(() => live.version);
  const { open } = useAlarms();
  return useMemo(() => {
    const out = new Map<string, PartState>();
    parts.forEach((p, idx) => {
      const names = Object.values(p.bindings).map(liveName);
      const fresh = (n: string) => { const tv = live.latest.get(n); return !!tv && now - Date.parse(tv.ts) <= STALE_MS; };
      let sev: PartState['sev'] = null;
      for (const a of open) {
        if (!names.includes(a.tag)) continue;
        const s = normSeverity(a.severity);
        if (s === 'critical') sev = 'critical'; else if (s === 'warning' && !sev) sev = 'warning';
      }
      const flag = p.bindings.run ?? p.bindings.open ?? p.bindings.state;
      let state: State;
      if (sev) state = 'alarm';
      else if (names.length === 0) state = 'none';
      else if (!names.some(fresh)) state = 'stale';
      else if (flag) state = fresh(liveName(flag)) && truthy(liveValue(flag)) ? 'run' : 'stop';
      else state = 'live';
      out.set(p.label, { state, sev, idx });
    });
    return out;
  }, [parts, open, now, ver]);
}

const STATE_KEY: Record<State, string> = { run: 'side.run', stop: 'side.stop', alarm: 'side.alarm', stale: 'side.stale', live: 'side.live', none: 'side.none' };

export function SideLegend() {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-68">
      {(['run', 'stop', 'alarm', 'stale', 'none'] as State[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5"><span className={`side-dot side-dot-${s}`} aria-hidden />{t(STATE_KEY[s])}</li>
      ))}
    </ul>
  );
}

/** Compact list of every part with its state — the narrow-screen fallback. */
export function SideList({ parts, sel, onSelect }: { parts: PlantPart[]; sel: string | null; onSelect: (k: string | null) => void }) {
  const { t } = useTranslation();
  const states = useStates(parts);
  return (
    <ul className="grid grid-cols-2 gap-1" aria-label={t('side.parts')}>
      {parts.filter((p) => ORDER.includes(p.label)).sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label)).map((p) => {
        const st = states.get(p.label);
        const key = String(st?.idx);
        return (
          <li key={key}>
            <button type="button" aria-pressed={sel === key} onClick={() => onSelect(sel === key ? null : key)}
              data-state={st?.state} data-sev={st?.sev ?? undefined}
              className={`side-row ${sel === key ? 'border-blue bg-info-soft' : 'border-line'}`}>
              <i className={`side-dot side-dot-${st?.state ?? 'none'}`} />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="sr-only">{t(STATE_KEY[st?.state ?? 'none'])}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SideView({ parts, sel, onSelect }: { parts: PlantPart[]; sel: string | null; onSelect: (k: string | null) => void }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(1200);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // largest scale (px per metre) that fits, 14..26; narrower screens scroll
  const { k, l } = useMemo(() => {
    for (let s = 26; s > 14; s--) { const lay = layout(s); if (lay.width <= avail) return { k: s, l: lay }; }
    return { k: 14, l: layout(14) };
  }, [avail]);
  const states = useStates(parts);
  useStore(() => live.version);

  // bucket position 0..1: the same tag the twin binds (batch/agg/skip1/position_pct)
  const skipSt = states.get('Skip hoist');
  const posPath = parts.find((p) => p.label === 'Skip hoist')?.bindings.position;
  const raw = posPath && skipSt && skipSt.state !== 'stale' ? Number(liveValue(posPath)) : NaN;
  const bucket = Number.isFinite(raw) ? Math.min(Math.max(raw / 100, 0), 1) : null;

  const track = l.items.get('Skip track')!;
  const bk = PICS['Skip hoist'];
  const bw = Math.max(bk.mw * k, MIN_LONG), bh = bw * (bk.mh / bk.mw);
  // bucket centre relative to the track picture, travelling along the twin's skip direction
  const tb = PICS['Skip track'].box;
  const c0x = (bk.box[0] + bk.box[3]) / 2 - (tb[0] + tb[3]) / 2, c0y = (bk.box[1] + bk.box[4]) / 2 - (tb[1] + tb[4]) / 2;
  const m = BUCKET_DIST * (bucket ?? 0);
  const bx = track.x + track.w / 2 + (c0x + BUCKET_DIR[0] * m) * k;
  const by = track.y + track.h / 2 - (c0y + BUCKET_DIR[1] * m) * k;
  const flow = connectors(l);

  const place = (label: string, name: string, box: { left: number; top: number; width: number; height: number }, labelTop: number, cx: number, slot: number) => {
    const st = states.get(label);
    const key = st ? String(st.idx) : null;
    const state = st?.state ?? 'none';
    const pick = () => key !== null && onSelect(sel === key ? null : key);
    return (
      <div key={label}>
        <button type="button" disabled={key === null} aria-pressed={sel === key} aria-label={`${label}, ${t(STATE_KEY[state])}${name}`}
          data-state={state} data-sev={st?.sev ?? undefined} className="side-part" style={box} onClick={pick}>
          <img src={`/elevations/${PICS[label].file}`} alt="" draggable={false} />
        </button>
        <button type="button" tabIndex={-1} aria-hidden disabled={key === null} data-state={state} data-sev={st?.sev ?? undefined}
          className="side-label" style={{ left: cx - (slot - 4) / 2, top: labelTop, width: slot - 4 }} onClick={pick}>
          <i className={`side-dot side-dot-${state}`} />
          <span>{label}</span>
        </button>
      </div>
    );
  };

  return (
    <div ref={host} className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('side.title')}>
      <div className="side-board relative" style={{ width: l.width, height: l.height }}>
        {l.groups.map((g) => (
          <div key={g.id} className="side-group" style={{ left: g.x, width: g.w, height: l.ground + LABEL_H + 8 }}>
            <span className="side-group-title">{t(`side.g_${g.id}`)}</span>
          </div>
        ))}
        <div className="side-ground" style={{ top: l.ground }} />
        <svg className="side-flow" width={l.width} height={l.height} aria-hidden>
          <defs>
            <marker id="side-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" /></marker>
          </defs>
          {flow.map((d, i) => <path key={i} d={d} markerEnd="url(#side-arrow)" />)}
        </svg>
        <img src={`/elevations/${PICS['Skip track'].file}`} alt="" draggable={false} className="side-pic"
          style={{ left: track.x, top: track.y, width: track.w, height: track.h }} />
        {[...l.items.values()].filter((it) => it.label !== 'Skip track').map((it) =>
          place(it.label, '', { left: it.x, top: it.y, width: it.w, height: it.h }, it.y + it.h + 3, it.cx, it.slot))}
        {/* the skip bucket rides its track; its label sits under the track */}
        {place('Skip hoist', bucket === null ? '' : `, ${t('side.bucket', { pct: Math.round(bucket * 100) })}`,
          { left: bx - bw / 2, top: by - bh / 2, width: bw, height: bh }, track.y + track.h + 3, track.x + track.w / 2, Math.max(track.w, labelW('Skip hoist')) + 4)}
      </div>
    </div>
  );
}

/** Elbow connectors (px) between process groups. */
function connectors(l: Layout): string[] {
  const g = (id: string) => l.groups.find((x) => x.id === id)!;
  const it = (n: string) => l.items.get(n)!;
  const gy = l.ground;
  const [agg, belts, hoist, mix, cem] = ['agg', 'belts', 'hoist', 'mix', 'cem'].map(g);
  const track = it('Skip track'), mixer = it('Mixer'), hopper = it('Weigh hopper');
  const out: string[] = [];
  // bins -> belts -> hoist, low along the ground
  out.push(`M${agg.x + agg.w} ${gy - 12} H${belts.x - 2}`);
  out.push(`M${belts.x + belts.w} ${gy - 12} H${hoist.x - 2}`);
  // hoist top -> mixer inlet
  out.push(`M${hoist.x + hoist.w} ${track.y + 8} H${hoist.x + hoist.w + GROUP_GAP / 2} V${mixer.y + mixer.h / 2} H${mixer.x - 2}`);
  // cement silos -> weigh hopper (passes above the liquids row), hopper -> mixer
  out.push(`M${cem.x} ${hopper.y + hopper.h / 2} H${hopper.x + hopper.w + 2}`);
  const fx = hopper.cx + hopper.slot / 2 - 5;
  out.push(`M${fx} ${hopper.y + hopper.h / 2} V${mixer.y - 2}`);
  // water and admixture bus into the mixer's right side
  const drops = ['Liquid tank 1', 'Liquid tank 2', 'Drum emptier 1', 'Drum emptier 2'].map(it);
  const busY = gy - Math.min(Math.max(...drops.map((d) => d.h)) + 8, mixer.h - 4);
  out.push(`M${drops[drops.length - 1].cx} ${busY} H${mix.x + mix.w + 2}`);
  for (const d of drops) out.push(`M${d.cx} ${d.y - 2} V${busY}`);
  return out;
}
