// One-shot "auto-setup" for a plant model: detect equipment, bind it to the
// site's existing tags, and work out which simulated tags would still be
// needed. Pure planning — the editor shows the result and performs the calls.

import { autoBind, detectParts, simTagsFor, type Candidate, type DetectInput, type SimTagDef } from './plantDetect';
import type { Kinds, PlantPart, PlantTag } from './plantModel';

/** Roles worth a tag when nothing real exists (the rest stay unbound). */
export const CORE_ROLES: Record<string, string[]> = {
  motor: ['run', 'speed'],
  conveyor: ['run', 'speed'],
  vessel: ['level'],
  valve: ['open'],
  pump: ['run', 'flow'],
  mixer: ['run', 'current', 'door'],
  indicator: ['state'],
  pipe: [],
  slider: ['position'],
};

/** Pipes flow when the nearest pump/mixer runs: copy that part's `run` binding. */
export function linkPipes(parts: PlantPart[], input: Pick<DetectInput, 'nodeBox'>): void {
  const centre = (p: PlantPart) => {
    const b = input.nodeBox(p.nodes[0]);
    return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0];
  };
  const movers = parts.filter((p) => (p.kind === 'pump' || p.kind === 'mixer') && p.bindings.run);
  if (!movers.length) return;
  for (const p of parts) {
    if (p.kind !== 'pipe' || p.bindings.run) continue;
    const c = centre(p);
    let best: PlantPart | null = null, bd = Infinity;
    for (const m of movers) {
      const mc = centre(m);
      const d = (c[0] - mc[0]) ** 2 + (c[1] - mc[1]) ** 2 + (c[2] - mc[2]) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    if (best) p.bindings.run = best.bindings.run;
  }
}

export interface SetupPlan {
  parts: PlantPart[];
  candidates: Candidate[];
  simTags: SimTagDef[];
  /** parts whose roles were bound to existing tags / left for sim tags */
  boundCount: number;
}

export function planSetup(
  input: DetectInput, kinds: Kinds, tags: PlantTag[], keep: PlantPart[] = [],
): SetupPlan {
  const have = new Set(keep.flatMap((p) => p.nodes));
  const candidates = detectParts(input).filter((c) => !c.nodes.some((n) => have.has(n)));
  const labels = new Set(keep.map((p) => p.label));
  const parts: PlantPart[] = [...keep];
  const taken = new Set<string>();
  const simTags: SimTagDef[] = [];
  let boundCount = 0;

  for (const c of candidates) {
    let label = c.label;
    for (let n = 2; labels.has(label); n++) label = `${c.label} ${n}`;
    labels.add(label);
    const part: PlantPart = { label, kind: c.kind, nodes: c.nodes, bindings: {}, params: c.params };
    const roles = kinds[c.kind]?.roles ?? {};
    const { bindings } = autoBind(part, roles, tags, taken);
    part.bindings = bindings;
    for (const path of Object.values(bindings)) taken.add(`${label}|${path}`);
    boundCount += Object.keys(bindings).length;
    parts.push(part);
  }

  linkPipes(parts, input);

  // what is still missing -> simulated tags (core roles only)
  const seen = new Set<string>();
  for (const p of parts) {
    if (keep.includes(p)) continue;
    const roles = kinds[p.kind]?.roles ?? {};
    const missing = (CORE_ROLES[p.kind] ?? []).filter((r) => roles[r] && !p.bindings[r]);
    for (const def of simTagsFor(p, missing, roles)) {
      if (seen.has(def.path)) continue;
      seen.add(def.path);
      simTags.push(def);
    }
  }
  // order: sources before followers (the API validates `follows` against known + same batch)
  simTags.sort((a, b) => Number(!!a.follows) - Number(!!b.follows));
  return { parts, candidates, simTags, boundCount };
}

/** After the sim tags exist, bind each part's missing core roles to them. */
export function bindSimTags(
  parts: PlantPart[], kinds: Kinds, created: Set<string>, from: number, input: Pick<DetectInput, 'nodeBox'>,
): PlantPart[] {
  const out = parts.map((p, i) => {
    if (i < from) return p;
    const b = { ...p.bindings };
    for (const role of CORE_ROLES[p.kind] ?? []) {
      if (b[role] || !kinds[p.kind]?.roles[role]) continue;
      const def = simTagsFor({ label: p.label, bindings: b }, [role], kinds[p.kind].roles)[0];
      if (def && created.has(def.path)) b[role] = def.path;
    }
    return { ...p, bindings: b };
  });
  linkPipes(out, input);
  return out;
}
