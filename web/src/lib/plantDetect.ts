// Auto-detect equipment in a plant model, then auto-bind it to tags.
//
// Detection reads what the model offers, in order of trust:
//   1. names from the CAD source (SketchUp keeps them as node extras: Silo2,
//      MALAXEUR75E, Skip, tremiepeseuse, Roots3, Viking …) and layers;
//   2. pipe naming (pipe/bend/flange … DN125) -> one flow part per diameter;
//   3. shape: big cubic open box = bin, tall cylinder = tank/silo, long low
//      box = belt.
// Anything it is unsure about is flagged `med` so the editor can show it for
// review. Nothing here writes: the editor decides what to keep.

import type { NodeInfo } from '../features/line3d/scene';
import type { PlantPart, PlantTag, TagType } from './plantModel';

export interface Candidate {
  label: string;
  kind: string;
  nodes: number[];
  params: Record<string, unknown>;
  conf: 'high' | 'med';
  reason: string;
}

export interface DetectInput {
  nodes: NodeInfo[];
  roots: number[];
  nodeBox: (i: number) => { min: [number, number, number]; max: [number, number, number] } | null;
  /** world width of the plant (scene units) — shapes are judged relative to it */
  footprint: number;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Rule { re: RegExp; kind: string; label: string; params?: Record<string, unknown>; skip?: boolean }

// first match wins; tested against `skp name | definition | layer`
const RULES: Rule[] = [
  { re: /(homme|worker|\bman\b|person|human|tree|arbre|voiture|car\b|camion|truck)/, kind: '', label: '', skip: true },
  { re: /(malaxeu?r|mixer|betonni|planetar)/, kind: 'mixer', label: 'Mixer', params: { axis: 'x', rpm: 40, mix: true } },
  { re: /^skip|\bskip\b|benne|bucket|godet/, kind: 'slider', label: 'Skip hoist', params: { dir: [0.5, 0.85, 0], dist: 28, period: 14 } },
  { re: /silo/, kind: 'vessel', label: 'Cement silo' },
  { re: /(tremie|hopper|doseur|batcher)/, kind: 'vessel', label: 'Weigh hopper' },
  { re: /(cuve|tank|container|reservoir|citerne)/, kind: 'vessel', label: 'Liquid tank' },
  { re: /(vide.?fut|drum)/, kind: 'vessel', label: 'Drum emptier' },
  { re: /(roots|compresseur|compressor|blower|surpress)/, kind: 'pump', label: 'Blower', params: { axis: 'y', rpm: 120 } },
  { re: /(viking|pompe|pump)/, kind: 'pump', label: 'Pump', params: { axis: 'y', rpm: 90 } },
  { re: /(moteur|motor|motoreduct|gearmotor)/, kind: 'motor', label: 'Motor' },
  { re: /(vanne|valve|clapet)/, kind: 'valve', label: 'Valve' },
  { re: /(verin|cylinder|actuator|piston)/, kind: 'valve', label: 'Gate cylinder' },
  { re: /(peson|load ?cell)/, kind: 'indicator', label: 'Load cell' },
  { re: /(convoyeur|tapis|conveyor|\bbelt\b|bande transp)/, kind: 'conveyor', label: 'Belt conveyor' },
  { re: /(\bvis\b|screw|helic|auger)/, kind: 'conveyor', label: 'Screw conveyor' },
  { re: /(filtre|filter|cyclone|dust|depoussi)/, kind: 'indicator', label: 'Dust filter' },
  { re: /\|impeller/, kind: 'motor', label: 'Impeller', params: { self: true, axis: 'y', rpm: 60 } },
];

const PIPE = /^(pipe|bend|union|flange|tee|reducer|elbow|coude|tube)\b/;

const FLUID_BY_DN = (dn: number) => (dn >= 110 ? 'air' : dn >= 90 ? 'cement' : dn >= 45 ? 'admixture' : 'water');

export function detectParts(inp: DetectInput): Candidate[] {
  const { nodes, roots, nodeBox, footprint } = inp;
  const F = footprint;
  const out: Candidate[] = [];
  const pipes = new Map<string, number[]>();
  const memo = new Map<number, ReturnType<typeof nodeBox>>();
  const box = (i: number) => {
    if (!memo.has(i)) memo.set(i, nodeBox(i));
    return memo.get(i)!;
  };
  const size = (i: number): [number, number, number] | null => {
    const b = box(i);
    return b ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] : null;
  };
  const text = (n: NodeInfo) => fold(`${n.skp ?? n.name}|${n.def ?? ''}|${n.layer ?? ''}`);

  const geometric = (i: number, n: NodeInfo): Candidate | null => {
    const s = size(i);
    if (!s) return null;
    const [x, y, z] = s;
    const horiz = Math.max(x, z), wid = Math.min(x, z);
    const big = Math.max(x, y, z) >= 0.07 * F;
    if (!big || n.children.length === 0) return null;
    // long low box -> belt
    if (horiz >= 0.25 * F && horiz >= 4 * Math.max(wid, y) * 0.8 && y >= 0.012 * F && y <= 0.14 * F && wid <= 0.1 * F) {
      return { label: 'Belt conveyor', kind: 'conveyor', nodes: [i], params: { axis: 'auto' }, conf: 'med', reason: 'long low box' };
    }
    // tall slender -> silo / tank
    if (y >= 2 * Math.max(x, z) && y >= 0.22 * F) {
      return { label: 'Tank', kind: 'vessel', nodes: [i], params: {}, conf: 'med', reason: 'tall slender volume' };
    }
    // big near-cubic open box -> bin
    if (x >= 0.1 * F && z >= 0.1 * F && y >= 0.1 * F && y <= 1.5 * Math.max(x, z) && Math.max(x, z) <= 0.35 * F) {
      return { label: 'Aggregate bin', kind: 'vessel', nodes: [i], params: { fill: true }, conf: 'med', reason: 'large cubic volume' };
    }
    return null;
  };

  // a group that contains named equipment (Skip, MALAXEUR…) is a container, not a part
  const named = new Map<number, boolean>();
  const hasNamed = (i: number): boolean => {
    const hit = named.get(i);
    if (hit !== undefined) return hit;
    const n = nodes[i];
    const t = text(n);
    let r = false;
    if (n) {
      for (const k of n.children) {
        const big = (size(k) ?? [0])
          .reduce((m, v) => Math.max(m, v), 0) >= 0.06 * F;   // a small motor on a belt does not make the belt a container
        if ((big && RULES.some((q) => !q.skip && q.re.test(text(nodes[k])))) || hasNamed(k)) { r = true; break; }
      }
    }
    named.set(i, r && !!t);
    return named.get(i)!;
  };

  const visit = (i: number, depth: number) => {
    const n = nodes[i];
    if (!n) return;
    const t = text(n);
    const nm = fold(n.skp ?? n.name);
    for (const r of RULES) {
      if (r.re.test(t)) {
        if (r.skip) return;
        const s = size(i);
        if (!s || Math.max(...s) < 0.012 * F) return;        // a fitting, not equipment
        out.push({ label: r.label, kind: r.kind, nodes: [i], params: { ...(r.params ?? {}) }, conf: 'high', reason: n.skp ?? n.name });
        return;
      }
    }
    if (PIPE.test(nm)) {
      const dn = /dn\s*(\d+)/.exec(nm)?.[1] ?? '0';
      (pipes.get(dn) ?? pipes.set(dn, []).get(dn)!).push(i);
      return;
    }
    if (depth <= 4 && !hasNamed(i)) {
      const g = geometric(i, n);
      if (g) { out.push(g); return; }
    }
    for (const c of n.children) visit(c, depth + 1);
  };
  for (const r of roots) visit(r, 0);

  // pipes -> one flow part per diameter
  for (const [dn, idx] of pipes) {
    if (idx.length < 2) continue;
    const d = Number(dn);
    out.push({
      label: d ? `Pipe line DN${d}` : 'Pipe line', kind: 'pipe', nodes: idx,
      params: { color: FLUID_BY_DN(d) }, conf: 'med', reason: `${idx.length} pipe pieces`,
    });
  }

  // a guessed shape that swallows named equipment is a building/structure, not a part
  const centreIn = (outer: number[], inner: number[]) => {
    const A = box(outer[0]), B = box(inner[0]);
    if (!A || !B) return false;
    return [0, 1, 2].every((k) => (B.min[k] + B.max[k]) / 2 >= A.min[k] && (B.min[k] + B.max[k]) / 2 <= A.max[k]);
  };
  const hi = out.filter((c) => c.conf === 'high');
  for (let k = out.length - 1; k >= 0; k--) {
    const c = out[k];
    if (c.conf === 'med' && c.kind !== 'pipe' && hi.some((h) => centreIn(c.nodes, h.nodes))) out.splice(k, 1);
  }

  // number duplicates in plant order (left to right, then back to front)
  const by = new Map<string, Candidate[]>();
  for (const c of out) (by.get(c.label) ?? by.set(c.label, []).get(c.label)!).push(c);
  for (const [, list] of by) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const A = box(a.nodes[0]), B = box(b.nodes[0]);
      return (A ? A.min[0] + A.min[2] * 0.1 : 0) - (B ? B.min[0] + B.min[2] * 0.1 : 0);
    });
    list.forEach((c, k) => { c.label = `${c.label} ${k + 1}`; });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* auto-bind to existing tags                                           */
/* ------------------------------------------------------------------ */

// role -> words that mark a tag's signal (last path segment)
const ROLE_WORDS: Record<string, RegExp> = {
  run: /^(running|run|start|motor_on)/,
  open: /^(open|gate_open|opened)/,
  door: /(door|gate_open|discharge)/,
  state: /(state|status|on$)/,
  speed: /(speed|rpm|freq)/,
  flow: /(flow|lpm|rate)/,
  pressure: /(pressure|bar|psi)/,
  current: /(current|amp|_a$)/,
  temp: /(temp|_c$)/,
  level: /(level|lvl)/,
  weight: /(weight|kg|mass|load)/,
  high: /(high|hi_)/,
  low: /(low|lo_)/,
  fault: /(fault|alarm|trip)/,
  position: /(position|pos)/,
  value: /./,
};

const STOP = new Set(['batch', 'auto', 'plant', 'line', 'the', 'of']);

function words(s: string): string[] {
  return fold(s).replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
}

const SYN: Record<string, string> = {
  cem: 'cement', agg: 'aggregate', liq: 'liquid', mix: 'mixer', mixer: 'mixer', admix: 'admixture',
  weigh: 'weigh', hopper: 'weigh', tank: 'liquid', blower: 'blower', roots: 'blower', air: 'blower',
  belt: 'belt', conveyor: 'belt', bin: 'bin', silo: 'silo', pump: 'pump', screw: 'screw', water: 'water',
};
const norm = (w: string) => SYN[w] ?? w;

export interface BindResult { bindings: Record<string, string>; unbound: string[] }

/** Best existing tag for each role of `part` (by name overlap with the part
 *  label, number match and the role's signal words). Never reuses a tag across
 *  parts of the same kind for the same role unless it is the only candidate. */
export function autoBind(
  part: Pick<PlantPart, 'label' | 'kind'>, roles: Record<string, { type: TagType; writable: boolean }>,
  tags: PlantTag[], taken: Set<string>,
): BindResult {
  const lw = words(part.label).map(norm);
  const nums = lw.filter((w) => /^\d+$/.test(w));
  const lwText = lw.filter((w) => !/^\d+$/.test(w));
  const bindings: Record<string, string> = {};
  const unbound: string[] = [];
  for (const [role, spec] of Object.entries(roles)) {
    const rx = ROLE_WORDS[role];
    let best: { path: string; score: number } | null = null;
    for (const t of tags) {
      if (t.type !== spec.type || (spec.writable && !t.writable) || taken.has(`${part.label}|${t.path}`)) continue;
      const segs = t.path.split('/');
      const leaf = segs[segs.length - 1];
      if (!rx || !rx.test(fold(leaf))) continue;
      const tw = words(segs.slice(0, -1).join(' ')).map(norm);
      const tnums = tw.filter((w) => /^\d+$/.test(w));
      const tText = tw.filter((w) => !/^\d+$/.test(w));
      let score = 0;
      let hits = 0;
      for (const w of lwText) if (tText.includes(w)) { score += 3; hits++; }
      if (lwText.length && hits === 0) continue;   // a number or a role word alone is not evidence
      if (nums.length && tnums.length) score += nums.every((n) => tnums.includes(n)) ? 4 : -6;
      if (nums.length === 0 && tnums.length) score -= 1;
      if (score > 0 && (!best || score > best.score)) best = { path: t.path, score };
    }
    if (best && best.score >= 3) bindings[role] = best.path; else unbound.push(role);
  }
  return { bindings, unbound };
}

/* ------------------------------------------------------------------ */
/* simulated tags for what could not be bound                           */
/* ------------------------------------------------------------------ */

export interface SimTagDef {
  path: string; type: TagType; writable: boolean; unit?: string;
  behavior: 'state' | 'follow' | 'cycle' | 'wander';
  initial: boolean | number; follows?: string; gain?: number; offset?: number; lag?: number;
  period?: number; lo?: number; hi?: number; min?: number; max?: number;
}

export const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'part';

const LEAF: Record<string, string> = {
  run: 'running', open: 'open', door: 'door_open', state: 'state', fault: 'fault', high: 'high_level',
  low: 'low_level', speed: 'speed_mps', flow: 'flow_lpm', pressure: 'pressure_bar', current: 'current_a',
  temp: 'temp_c', level: 'level_pct', weight: 'weight_kg', position: 'position_pct', value: 'value',
};

export function simTagsFor(
  part: Pick<PlantPart, 'label' | 'bindings'>, missing: string[],
  roles: Record<string, { type: TagType; writable: boolean }>,
): SimTagDef[] {
  const dev = slug(part.label);
  const path = (role: string) => `auto/${dev}/${LEAF[role] ?? slug(role)}`;
  const runPath = part.bindings.run ?? (missing.includes('run') ? path('run') : undefined)
    ?? part.bindings.open ?? (missing.includes('open') ? path('open') : undefined);
  const out: SimTagDef[] = [];
  for (const role of missing) {
    const spec = roles[role];
    if (!spec) continue;
    const p = path(role);
    if (spec.type === 'bool') {
      out.push({ path: p, type: 'bool', writable: spec.writable, behavior: 'state', initial: false });
      continue;
    }
    const f = runPath && role !== 'level' && role !== 'weight' && role !== 'position' ? { follows: runPath } : {};
    switch (role) {
      case 'speed': out.push({ path: p, type: 'number', writable: spec.writable, unit: 'm/s', min: 0, max: 3, behavior: 'follow', initial: 0, gain: 1.2, lag: 1.5, ...f }); break;
      case 'flow': out.push({ path: p, type: 'number', writable: spec.writable, unit: 'L/min', behavior: 'follow', initial: 0, gain: 120, lag: 1.5, ...f }); break;
      case 'pressure': out.push({ path: p, type: 'number', writable: spec.writable, unit: 'bar', behavior: 'follow', initial: 0, gain: 0.8, lag: 3, ...f }); break;
      case 'current': out.push({ path: p, type: 'number', writable: spec.writable, unit: 'A', behavior: 'follow', initial: 0, gain: 60, offset: 4, lag: 2, ...f }); break;
      case 'temp': out.push({ path: p, type: 'number', writable: spec.writable, unit: '°C', behavior: 'follow', initial: 28, gain: 40, offset: 28, lag: 20, ...f }); break;
      case 'level': out.push({ path: p, type: 'number', writable: spec.writable, unit: '%', behavior: 'wander', initial: 60, lo: 15, hi: 95, min: 0, max: 100 }); break;
      case 'weight': out.push({ path: p, type: 'number', writable: spec.writable, unit: 'kg', behavior: 'wander', initial: 400, lo: 0, hi: 1800 }); break;
      case 'position': out.push({ path: p, type: 'number', writable: spec.writable, unit: '%', behavior: 'cycle', initial: 0, period: 14, lo: 0, hi: 100, min: 0, max: 100 }); break;
      default: out.push({ path: p, type: 'number', writable: spec.writable, behavior: 'wander', initial: 50, lo: 0, hi: 100 });
    }
  }
  return out;
}
