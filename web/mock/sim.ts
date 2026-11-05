// Plant simulator for the dev mock (MOCK_API=1). One in-process plant:
//  - the concrete batching plant, ported step for step from
//    edge-bridge/edge_bridge/adapters/batching_sim.py (60 s batch cycle);
//  - the sorting line, from adapters/sim.py, with a discharge gate on the
//    bin so its level saw-tooths instead of sitting at 100 %;
//  - a clock-aligned scenario loop (sorter speed-up, planned stop, mixer
//    overload) so alarms raise and clear on their own, every hour, forever;
//  - the alarm engine's raise/clear rule (backend/app/alarming/alarms.py):
//    any open alarm clears when its value is back inside the deadband.
// History is pre-simulated for the last 24 h at startup, so charts, OEE and
// downtime have real data on the first page load. Resets on restart.

import { TAG_SPECS, type TagSpec } from './data/tags.ts';

export const SITE = 'plant1';
export type Val = number | boolean;

// ── Tag catalogue ───────────────────────────────────────────────────────────

export interface SimTag extends TagSpec { name: string; id: string }
export const TAGS: SimTag[] = TAG_SPECS.map((t, i) => ({ ...t, name: `${SITE}.${t.tail}`, id: `tag-${String(i + 1).padStart(3, '0')}` }));
const BY_TAIL = new Map(TAGS.map((t) => [t.tail, t]));
const BY_NAME = new Map(TAGS.map((t) => [t.name, t]));
export const tagByName = (name: string) => BY_NAME.get(name);
export const tagByTail = (tail: string) => BY_TAIL.get(tail);

// ── State ───────────────────────────────────────────────────────────────────

const V: Record<string, Val> = {};
for (const t of TAGS) V[t.tail] = t.initial ?? (t.type === 'bool' ? false : 0);
// scenario-only state, not tags
let sortDischarging = false;
const manualUntil: Record<string, number> = {};   // tail -> ms: operator override wins over the scenario

let seed = 0x5eed1234;
/** mulberry32 — deterministic noise so a restart replays the same plant */
function rnd(lo: number, hi: number): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return lo + (((x ^ (x >>> 14)) >>> 0) / 4294967296) * (hi - lo);
}

const num = (tail: string): number => Number(V[tail] ?? 0);
const on = (tail: string): boolean => V[tail] === true || (typeof V[tail] === 'number' && (V[tail] as number) > 0);
const round = (x: number, d: number) => { const f = 10 ** d; return Math.round(x * f) / f; };
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const follow = (cur: number, target: number, dt: number, lag: number) => cur + (target - cur) * Math.min(dt / lag, 1);
const between = (x: number, w: readonly [number, number]) => w[0] <= x && x < w[1];

// ── Concrete batching plant (batching_sim.py) ───────────────────────────────

const CYCLE_S = 60;
const BATCH_M3 = 1;
const BINS = [1, 2, 3, 4];
const SILOS = [1, 2, 3, 4];
const FEEDERS: Record<number, number[]> = { 1: [1, 2, 3], 2: [1, 2, 3], 3: [5, 6], 4: [5, 6] };
const BELTS = [1, 2, 3, 4, 5, 6];
const COLLECTOR = 4;
const DRUMS = [1, 2];
const AGG = [0, 12] as const, CEM = [10, 20] as const, LIQ = [14, 24] as const, CHARGE = [26, 32] as const;
const SKIP_UP = [26, 29] as const, SKIP_DOWN = [32, 36] as const, MIX = [32, 50] as const, DISCH = [50, 58] as const;

function stepOf(phase: number): number {
  const order: [number, readonly [number, number]][] = [[6, DISCH], [5, MIX], [4, CHARGE], [3, LIQ], [2, CEM], [1, AGG]];
  for (const [idx, w] of order) if (between(phase, w)) return idx;
  return 0;
}

function tickBatch(dt: number, { overload, lateSilo }: Scene): void {
  const b = (t: string) => `batch.${t}`;
  const s = (t: string, v: Val) => { V[b(t)] = v; };
  const n = (t: string) => num(b(t));
  const aggTarget = n('plant.recipe.agg_target_kg') || 1800;
  const cemTarget = n('plant.recipe.cem_target_kg') || 300;
  const liqTarget = n('plant.recipe.water_target_kg') || 160;

  // sequencer
  const auto = on(b('plant.auto.enabled'));
  let cycle = Math.trunc(n('plant.auto.cycle_count'));
  let phase = n('plant.auto.stage');
  if (auto) {
    const prev = phase;
    phase += dt;
    if (prev < DISCH[1] && DISCH[1] <= phase) {      // discharge finished: one truck loaded
      s('mix.truck.count', n('mix.truck.count') + 1);
      s('plant.production.m3_total', round(n('plant.production.m3_total') + BATCH_M3, 3));
    }
    if (phase >= CYCLE_S) { phase -= CYCLE_S; cycle += 1; s('plant.auto.cycle_count', cycle); }
    s('plant.auto.stage', round(phase, 2));
    s('plant.auto.step', stepOf(phase));
    const slot = (AGG[1] - AGG[0]) / BINS.length;
    for (const i of BINS) s(`agg.bin${i}.gate_open`, between(phase, [AGG[0] + (i - 1) * slot, AGG[0] + i * slot]));
    const activeSilo = (cycle % SILOS.length) + 1;
    for (const i of SILOS) s(`cem.screw${i}.running`, i === activeSilo && between(phase, CEM));
    s('liq.water1.open', between(phase, LIQ));
    s('liq.pump1.running', between(phase, LIQ));
    s('liq.admix1.running', between(phase, [LIQ[0] + 2, LIQ[1] - 2]));
    s('mix.mixer1.running', between(phase, [CHARGE[0], DISCH[1]]));
    s('mix.mixer1.door_open', between(phase, DISCH));
  } else {
    s('plant.auto.stage', 0);
    s('plant.auto.step', 0);
  }
  const charging = auto && between(phase, CHARGE);

  // aggregates
  const openBins = BINS.filter((i) => on(b(`agg.bin${i}.gate_open`)));
  if (auto) {
    const feeding = new Set(openBins.flatMap((i) => FEEDERS[i]));
    for (const belt of BELTS) s(`agg.belt${belt}.running`, feeding.has(belt) || (belt === COLLECTOR && between(phase, AGG)));
  }
  for (const belt of BELTS) {
    const run = on(b(`agg.belt${belt}.running`));
    const target = run ? (belt === COLLECTOR ? 1.6 : 0.9) : 0;
    s(`agg.belt${belt}.speed_mps`, round(Math.max(follow(n(`agg.belt${belt}.speed_mps`), target, dt, 1.5) + rnd(-0.01, 0.01), 0), 3));
  }
  for (const i of BINS) {
    let lvl = n(`agg.bin${i}.level_pct`);
    if (openBins.includes(i)) lvl -= 2.2 * dt; else if (lvl < 100) lvl += 0.25 * dt;
    lvl = clamp(lvl, 0, 100);
    s(`agg.bin${i}.level_pct`, round(lvl, 2));
    s(`agg.bin${i}.low_level`, lvl <= 15);
  }
  let w = n('agg.weigh1.weight_kg');
  if (openBins.length && on(b(`agg.belt${COLLECTOR}.running`))) w += (aggTarget / (AGG[1] - AGG[0])) * dt;
  else if (charging) w -= (aggTarget / (CHARGE[1] - CHARGE[0])) * dt;
  s('agg.weigh1.weight_kg', round(clamp(w, 0, aggTarget * 1.1), 1));

  // skip hoist: up, tip into the mixer, back down
  let pos = n('agg.skip1.position_pct');
  if (auto) {
    if (between(phase, SKIP_UP)) pos += (100 / (SKIP_UP[1] - SKIP_UP[0])) * dt;
    else if (between(phase, SKIP_DOWN)) pos -= (100 / (SKIP_DOWN[1] - SKIP_DOWN[0])) * dt;
    else if (!between(phase, [SKIP_UP[1], SKIP_DOWN[0]])) pos -= (100 / (SKIP_DOWN[1] - SKIP_DOWN[0])) * dt;
  }
  pos = clamp(pos, 0, 100);
  const moving = auto && (between(phase, SKIP_UP) || between(phase, SKIP_DOWN));
  s('agg.skip1.position_pct', round(pos, 2));
  s('agg.skip1.moving', moving);
  s('agg.skip1.motor_temp_c', round(follow(n('agg.skip1.motor_temp_c'), moving ? 68 : 34, dt, 40) + rnd(-0.02, 0.02), 2));

  // cement
  const screws = SILOS.filter((i) => on(b(`cem.screw${i}.running`)));
  let cw = n('cem.weigh1.weight_kg');
  if (screws.length && !charging) cw += (cemTarget / (CEM[1] - CEM[0])) * dt * screws.length;
  else if (charging) cw -= (cemTarget / (CHARGE[1] - CHARGE[0])) * dt;
  cw = clamp(cw, 0, cemTarget * 1.1);
  s('cem.weigh1.weight_kg', round(cw, 1));
  s('cem.weigh1.level_pct', round(clamp((cw / (cemTarget * 1.15)) * 100, 0, 100), 1));
  // a bulk tanker refills a low silo pneumatically: the blower pushes cement up DN100
  const filling: Record<number, boolean> = {};
  for (const i of SILOS) {
    const lvl = n(`cem.silo${i}.level_pct`);
    let f = on(b(`cem.silo${i}.filling`));
    if (lvl <= 10) f = true; else if (lvl >= 90) f = false;
    if (i === lateSilo) f = false;                    // scenario: the tanker is late
    filling[i] = f;
  }
  if (auto) s('air.blower1.running', Object.values(filling).some(Boolean));
  const blower = on(b('air.blower1.running'));
  for (const i of SILOS) {
    let lvl = n(`cem.silo${i}.level_pct`);
    if (screws.includes(i)) lvl -= 0.9 * dt;
    if (filling[i] && blower) lvl += 3 * dt;
    lvl = clamp(lvl, 0, 100);
    s(`cem.silo${i}.level_pct`, round(lvl, 2));
    s(`cem.silo${i}.high_level`, lvl >= 90);
    s(`cem.silo${i}.low_level`, lvl <= 10);
    s(`cem.silo${i}.filling`, filling[i]);
  }
  s('air.fill1.flowing', blower && Object.values(filling).some(Boolean));

  // liquids
  const pump = on(b('liq.pump1.running'));
  const valve = on(b('liq.water1.open'));
  const admix = on(b('liq.admix1.running'));
  s('liq.pump1.flow_lpm', round(Math.max(follow(n('liq.pump1.flow_lpm'), pump && valve ? 180 : 0, dt, 1) + rnd(-0.3, 0.3), 0), 1));
  s('liq.admix1.flow_lpm', round(Math.max(follow(n('liq.admix1.flow_lpm'), admix ? 12 : 0, dt, 1) + rnd(-0.05, 0.05), 0), 2));
  let lw = n('liq.weigh1.weight_kg');
  if (pump && valve) lw += (liqTarget / (LIQ[1] - LIQ[0])) * dt;
  else if (charging) lw -= (liqTarget / (CHARGE[1] - CHARGE[0])) * dt;
  lw = clamp(lw, 0, liqTarget * 1.1);
  s('liq.weigh1.weight_kg', round(lw, 1));
  s('liq.weigh1.level_pct', round(clamp((lw / (liqTarget * 1.15)) * 100, 0, 100), 1));
  s('liq.weigh1.discharging', charging && lw > 0.5);
  const tank = clamp(n('liq.tank1.level_pct') + (pump && valve ? -0.45 : 0.15) * dt, 0, 100);
  s('liq.tank1.level_pct', round(tank, 2));
  s('liq.tank1.low_level', tank <= 20);
  const drum = (cycle % DRUMS.length) + 1;
  for (const i of DRUMS) {
    let lvl = n(`liq.drum${i}.level_pct`);
    if (admix && i === drum) lvl -= 0.35 * dt;
    if (lvl <= 3) lvl = 100;                          // operator swaps in a full drum
    s(`liq.drum${i}.level_pct`, round(clamp(lvl, 0, 100), 2));
  }

  // air
  s('air.blower1.pressure_bar', round(Math.max(follow(n('air.blower1.pressure_bar'), blower ? 0.8 : 0, dt, 3) + rnd(-0.005, 0.005), 0), 3));
  const dusty = screws.length > 0 || charging;
  s('air.filter1.active', dusty);
  s('air.filter1.dp_mbar', round(Math.max(follow(n('air.filter1.dp_mbar'), dusty ? 14 : 3, dt, 4) + rnd(-0.05, 0.05), 0), 2));

  // mixer — the scenario's overload drives the current past its HiHi rule
  const mixer = on(b('mix.mixer1.running'));
  const door = on(b('mix.mixer1.door_open'));
  const loaded = n('agg.weigh1.weight_kg') + n('cem.weigh1.weight_kg') > 1 || (auto && between(phase, [CHARGE[0], DISCH[0]]));
  let target = 0;
  if (mixer) target = overload ? 112 : door ? 70 : loaded ? 95 : 55;
  s('mix.mixer1.current_a', round(Math.max(follow(n('mix.mixer1.current_a'), target, dt, 2) + rnd(-0.3, 0.3), 0), 1));
  if (auto) s('mix.truck.present', between(phase, [MIX[0], DISCH[1]]));

  // production rate
  const rate = auto ? (BATCH_M3 * 3600) / CYCLE_S : 0;
  s('plant.production.rate_m3h', round(Math.max(follow(n('plant.production.rate_m3h'), rate, dt, 10), 0), 2));
}

// ── Sorting line (sim.py, with a discharge gate on the bin) ─────────────────

function tickSort(dt: number, { gateStuck }: Scene): void {
  const running = on('sort.line1.motor1.running');
  const load = num('sort.line1.motor1.speed_sp') / 60;
  const target = running ? 2.5 * load : 0;
  V['sort.line1.conv1.speed_mps'] = round(Math.max(follow(num('sort.line1.conv1.speed_mps'), target, dt, 1.5) + rnd(-0.02, 0.02), 0), 3);
  const tempTarget = running ? 28 + (112 - 28) * load : 28;
  V['sort.line1.conv1.temp_c'] = round(follow(num('sort.line1.conv1.temp_c'), tempTarget, dt, 20) + rnd(-0.05, 0.05), 2);
  let level = num('sort.line1.bin1.level_pct');
  // the gate opens at 88 % (below the Hi rule); a stuck gate lets it overfill
  if (level >= 88 && !gateStuck) sortDischarging = true; else if (level <= 15 || gateStuck) sortDischarging = false;
  if (sortDischarging) level -= 2.5 * dt;
  else if (running) level += 0.22 * load * dt;
  else level -= 0.05 * dt;
  V['sort.line1.bin1.level_pct'] = round(clamp(level, 0, 100), 2);
  V['sort.vision.cam1.gravel_ratio'] = round(clamp(num('sort.vision.cam1.gravel_ratio') + rnd(-0.004, 0.004), 0.15, 0.85), 4);
}

// ── Scenario loop (aligned to the wall clock, so history and live agree) ───

interface Scene { overload: boolean; gateStuck: boolean; lateSilo: number }

/** What goes wrong, and when. Alarms come from abnormal events, not from the
 *  normal cycle — about four an hour, under ISA-18.2's flood line:
 *  - sorter, every 40 min: a 5-min speed-up past the belt-temperature HiHi,
 *    then a 3-min planned stop (belt-speed Lo + a downtime to classify);
 *  - every 2 h: the sorter bin's discharge gate sticks for 5 min (level Hi),
 *    and the mixer overloads for 25 s (current HiHi);
 *  - every 3 h: the cement tanker is 40 min late for one silo (silo low);
 *  - every 4 h: the batching plant stops 12 min for a mixer washout. */
function scenario(tMs: number): Scene {
  const sec = tMs / 1000;
  const s = sec % 2400;
  const sp = s >= 720 && s < 1020 ? 44 : 32;
  const run = !(s >= 1800 && s < 1980);
  if (!(manualUntil['sort.line1.motor1.speed_sp'] > tMs)) V['sort.line1.motor1.speed_sp'] = sp;
  if (!(manualUntil['sort.line1.motor1.running'] > tMs)) V['sort.line1.motor1.running'] = run;
  // the batching plant pauses 12 min every 4 h for a mixer washout
  if (!(manualUntil['batch.plant.auto.enabled'] > tMs)) V['batch.plant.auto.enabled'] = !(sec % 14400 >= 9000 && sec % 14400 < 9720);
  const h2 = sec % 7200;
  const h3 = sec % 10800;
  return {
    overload: h2 >= 5400 && h2 < 5425,
    gateStuck: h2 >= 2400 && h2 < 2700,
    lateSilo: h3 >= 3600 && h3 < 6000 ? (Math.floor(sec / 10800) % SILOS.length) + 1 : 0,
  };
}

// ── Alarm rules + engine ────────────────────────────────────────────────────

export interface SimRule {
  id: string; tail: string; name: string; kind: 'hi' | 'hihi' | 'lo' | 'lolo' | 'stale' | 'roc';
  threshold: number | null; stale_s: number | null; window_s: number | null; deadband: number;
  severity: 'info' | 'warning' | 'critical'; enabled: boolean;
}
export const RULES: SimRule[] = [
  { id: 'r-1', tail: 'sort.line1.conv1.temp_c', name: 'Belt temperature HiHi', kind: 'hihi', threshold: 75, stale_s: null, window_s: null, deadband: 1, severity: 'critical', enabled: true },
  { id: 'r-2', tail: 'sort.line1.bin1.level_pct', name: 'Sorter bin level Hi', kind: 'hi', threshold: 90, stale_s: null, window_s: null, deadband: 2, severity: 'warning', enabled: true },
  { id: 'r-3', tail: 'sort.line1.conv1.speed_mps', name: 'Belt speed Lo', kind: 'lo', threshold: 0.5, stale_s: null, window_s: null, deadband: 0.1, severity: 'warning', enabled: true },
  { id: 'r-4', tail: 'sort.vision.cam1.gravel_ratio', name: 'Vision feed stale', kind: 'stale', threshold: null, stale_s: 30, window_s: null, deadband: 0, severity: 'info', enabled: true },
  { id: 'r-5', tail: 'batch.mix.mixer1.current_a', name: 'Mixer current HiHi', kind: 'hihi', threshold: 100, stale_s: null, window_s: null, deadband: 3, severity: 'critical', enabled: true },
  ...SILOS.map((i): SimRule => ({ id: `r-${5 + i}`, tail: `batch.cem.silo${i}.level_pct`, name: `Cement silo ${i} low`, kind: 'lo', threshold: 8, stale_s: null, window_s: null, deadband: 3, severity: 'warning', enabled: true })),
  { id: 'r-10', tail: 'batch.liq.tank1.level_pct', name: 'Water tank low', kind: 'lo', threshold: 20, stale_s: null, window_s: null, deadband: 5, severity: 'warning', enabled: true },
  { id: 'r-11', tail: 'batch.air.filter1.dp_mbar', name: 'Dust filter ΔP Hi', kind: 'hi', threshold: 18, stale_s: null, window_s: null, deadband: 2, severity: 'warning', enabled: true },
  { id: 'r-12', tail: 'batch.agg.skip1.motor_temp_c', name: 'Skip motor temp Hi', kind: 'hi', threshold: 70, stale_s: null, window_s: null, deadband: 3, severity: 'warning', enabled: false },
];

export interface SimAlarm {
  id: number; tag: string; tag_id: string; rule_id: string; rule: string; severity: string;
  state: 'active' | 'acked' | 'cleared'; ts: string; acked_by: string | null; acked_at: string | null;
  cleared_at: string | null; version: number; shelved_until: string | null;
  assigned_to: string | null; assigned_name: string | null;
}
export const ALARMS: SimAlarm[] = [];                   // newest first, capped
const openByRule = new Map<string, SimAlarm>();
let alarmSeq = 1000;

export const ruleText = (r: SimRule): string => {
  const unit = tagByTail(r.tail)?.unit ?? '';
  const op = r.kind === 'lo' || r.kind === 'lolo' ? '<' : '>';
  return r.threshold == null ? `${r.name} > ${r.stale_s ?? 0} s` : `${r.name} ${op} ${r.threshold}${unit ? ` ${unit}` : ''}`;
};

type Emit = (msg: Record<string, unknown>) => void;
const listeners = new Set<Emit>();
export const subscribe = (fn: Emit) => { listeners.add(fn); return () => listeners.delete(fn); };
let emitting = true;                                    // off while pre-simulating history
const emit = (msg: Record<string, unknown>) => { if (emitting) for (const fn of listeners) fn(msg); };

function evalRules(tMs: number): void {
  const iso = new Date(tMs).toISOString();
  for (const r of RULES) {
    if (!r.enabled || r.threshold == null || (r.kind !== 'hi' && r.kind !== 'hihi' && r.kind !== 'lo' && r.kind !== 'lolo')) continue;
    const v = num(r.tail);
    const high = r.kind === 'hi' || r.kind === 'hihi';
    const open = openByRule.get(r.id);
    const tripped = high ? v > r.threshold : v < r.threshold;
    const back = high ? v < r.threshold - r.deadband : v > r.threshold + r.deadband;
    if (!open && tripped) {
      const t = tagByTail(r.tail)!;
      const a: SimAlarm = {
        id: ++alarmSeq, tag: t.name, tag_id: t.id, rule_id: r.id, rule: ruleText(r), severity: r.severity, state: 'active',
        ts: iso, acked_by: null, acked_at: null, cleared_at: null, version: 1, shelved_until: null, assigned_to: null, assigned_name: null,
      };
      ALARMS.unshift(a);
      if (ALARMS.length > 600) ALARMS.length = 600;
      openByRule.set(r.id, a);
      emit({ type: 'alarm', ...a });
    } else if (open && back) {
      Object.assign(open, { state: 'cleared', cleared_at: iso, version: open.version + 1 });
      openByRule.delete(r.id);
      emit({ type: 'alarm_update', ...open });
    }
  }
  // the shift operator acknowledges what the user leaves alone (4 min), so
  // the console doesn't sit on a stale unacked banner forever
  for (const a of openByRule.values()) {
    if (a.state === 'active' && tMs - Date.parse(a.ts) > 240_000) {
      Object.assign(a, { state: 'acked', acked_by: 'shift-operator', acked_at: iso, version: a.version + 1 });
      emit({ type: 'alarm_update', ...a });
    }
  }
}

export function ackAlarm(id: string | number, who: string): SimAlarm | null {
  const a = ALARMS.find((x) => String(x.id) === String(id));
  if (!a || a.state !== 'active') return a ?? null;
  Object.assign(a, { state: 'acked', acked_by: who, acked_at: new Date().toISOString(), version: a.version + 1 });
  emit({ type: 'alarm_update', ...a });
  return a;
}

// ── Downtime: the sorter's stops become events for /stops and OEE ───────────

export interface SimStop { id: string; device_id: string; starts_at: number; ends_at: number | null }
export const STOPS: SimStop[] = [];
let stopSeq = 0;
let lastRun = true;
function trackStops(tMs: number): void {
  const run = on('sort.line1.motor1.running');
  if (lastRun && !run) STOPS.unshift({ id: `dt-${++stopSeq}`, device_id: 'dev-sort-line1-motor1', starts_at: tMs, ends_at: null });
  if (!lastRun && run && STOPS[0] && STOPS[0].ends_at == null) STOPS[0].ends_at = tMs;
  if (STOPS.length > 200) STOPS.length = 200;
  lastRun = run;
}

// ── History ring (10 s samples, 24 h) ───────────────────────────────────────

const STEP_MS = 10_000;
const CAP = 8640;
const hist = new Map<string, Float64Array>();
for (const t of TAGS) hist.set(t.tail, new Float64Array(CAP));
let histStart = 0;   // ms of slot 0 of the oldest stored sample
let histLen = 0;
let histHead = 0;    // next write slot
function record(tMs: number): void {
  if (histLen === 0) histStart = tMs;
  for (const t of TAGS) {
    const v = V[t.tail];
    hist.get(t.tail)![histHead] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  histHead = (histHead + 1) % CAP;
  if (histLen < CAP) histLen += 1; else histStart += STEP_MS;
}
/** Sample of `tail` at time t: the stored 10 s point, or — for windows older
 *  than the 24 h ring — the same time of day from the ring (the plant's day
 *  repeats; good enough for 7- and 30-day charts in a mock). */
export function sampleAt(tail: string, tMs: number): number | null {
  const arr = hist.get(tail);
  if (!arr || histLen === 0) return null;
  const span = histLen * STEP_MS;
  let off = tMs - histStart;
  if (off < 0) off = ((off % span) + span) % span;
  const i = Math.min(histLen - 1, Math.floor(off / STEP_MS));
  return arr[(histHead - histLen + i + CAP) % CAP];
}
export const historyStart = () => histStart;

// ── Commands ────────────────────────────────────────────────────────────────

export type WriteResult = { ok: true } | { ok: false; reason: 'unknown_tag' | 'not_writable' | 'out_of_range' | 'bad_type' };
export function write(name: string, value: unknown): WriteResult {
  const t = BY_NAME.get(name);
  if (!t) return { ok: false, reason: 'unknown_tag' };
  if (!t.writable) return { ok: false, reason: 'not_writable' };
  let v: Val;
  if (t.type === 'bool') {
    if (typeof value !== 'boolean' && value !== 0 && value !== 1) return { ok: false, reason: 'bad_type' };
    v = value === true || value === 1;
  } else {
    const x = Number(value);
    if (!Number.isFinite(x)) return { ok: false, reason: 'bad_type' };
    if ((t.min != null && x < t.min) || (t.max != null && x > t.max)) return { ok: false, reason: 'out_of_range' };
    v = x;
  }
  V[t.tail] = v;
  manualUntil[t.tail] = Date.now() + 10 * 60_000;      // the scenario backs off for 10 minutes
  return { ok: true };
}

// ── Clock ───────────────────────────────────────────────────────────────────

export const value = (name: string): Val | undefined => { const t = BY_NAME.get(name); return t ? V[t.tail] : undefined; };
export const snapshot = () => TAGS.map((t) => ({ name: t.name, v: V[t.tail], q: 'good' as const }));

function step(tMs: number, dt: number): void {
  const scene = scenario(tMs);
  tickBatch(dt, scene);
  tickSort(dt, scene);
  trackStops(tMs);
  evalRules(tMs);
}

/** Pre-simulate the last 24 h at 1 s steps (≈86 k ticks, a few hundred ms). */
function warmUp(now: number): void {
  emitting = false;
  const from = now - CAP * STEP_MS;
  let nextRec = from;
  for (let t = from; t < now; t += 1000) {
    step(t, 1);
    if (t >= nextRec) { record(t); nextRec += STEP_MS; }
  }
  emitting = true;
}

const prev: Record<string, Val> = {};
let loop: ReturnType<typeof setInterval> | undefined;
/** Start the live loop once; returns stop() so a Vite config reload (a fresh
 *  copy of this module) doesn't leave the old plant ticking in the process. */
export function start(): () => void {
  if (loop) return () => {};
  const t0 = Date.now();
  warmUp(t0);
  let lastRec = t0;
  loop = setInterval(() => {
    const now = Date.now();
    step(now, 0.5);
    if (now - lastRec >= STEP_MS) { record(now); lastRec = now; }
    const ts = new Date(now).toISOString();
    for (const t of TAGS) {
      const v = V[t.tail];
      if (prev[t.tail] !== v) { prev[t.tail] = v; emit({ type: 'tag', name: t.name, v, q: 'good', ts }); }
    }
  }, 500);
  loop.unref?.();
  return () => { clearInterval(loop); loop = undefined; };
}
