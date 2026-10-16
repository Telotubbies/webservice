// Monitor template packs (dd "Create monitors from templates") — curated
// plant rule bundles. Each rule definition binds to site tags by suffix
// regex so a pack adapts to however many conveyors/bins/cameras the plant
// actually has. Pure: page and tests share the derivation.

import type { AdminRule, AdminTag, RuleInput } from '../../lib/api';
import type { DdIconName } from '../../shared/ui/ddicons';

export interface PackRuleDef {
  /** literal rule name; gets a ` · <equip>` suffix when the pack binds the
   *  same definition to more than one tag */
  name: string;
  kind: RuleInput['kind'];
  threshold?: number | null;
  stale_s?: number | null;
  window_s?: number | null;
  deadband: number;
  severity: RuleInput['severity'];
  /** full-path match, e.g. /\.conv\d+\.temp_c$/ */
  tagRe: RegExp;
}

export interface RulePack {
  id: string;
  icon: DdIconName;
  rules: PackRuleDef[];
}

export const PACKS: RulePack[] = [
  {
    id: 'conveyor',
    icon: 'line',
    rules: [
      { name: 'Conveyor temp HiHi', kind: 'hihi', threshold: 75, deadband: 1, severity: 'critical', tagRe: /\.conv\d+\.temp_c$/ },
      { name: 'Conveyor temp Hi', kind: 'hi', threshold: 68, deadband: 1, severity: 'warning', tagRe: /\.conv\d+\.temp_c$/ },
      { name: 'Belt speed Lo', kind: 'lo', threshold: 1.0, deadband: 0.05, severity: 'warning', tagRe: /\.conv\d+\.speed_mps$/ },
      { name: 'Belt signal stale', kind: 'stale', stale_s: 60, deadband: 0, severity: 'info', tagRe: /\.conv\d+\.speed_mps$/ },
    ],
  },
  {
    id: 'bin',
    icon: 'container',
    rules: [
      { name: 'Bin level HiHi', kind: 'hihi', threshold: 96, deadband: 2, severity: 'critical', tagRe: /\.bin\d+\.level_pct$/ },
      { name: 'Bin level Hi', kind: 'hi', threshold: 90, deadband: 2, severity: 'warning', tagRe: /\.bin\d+\.level_pct$/ },
      { name: 'Bin level stale', kind: 'stale', stale_s: 120, deadband: 0, severity: 'info', tagRe: /\.bin\d+\.level_pct$/ },
    ],
  },
  {
    id: 'vision',
    icon: 'eye',
    rules: [
      { name: 'Vision result stale', kind: 'stale', stale_s: 30, deadband: 0, severity: 'info', tagRe: /\.vision\..+/ },
      { name: 'Vision result stale long', kind: 'stale', stale_s: 300, deadband: 0, severity: 'warning', tagRe: /\.vision\..+/ },
    ],
  },
];

/** the equipment segment used to disambiguate a rule bound to N tags:
 *  `plant1.sort.line1.conv2.temp_c` → `conv2` */
function equipOf(path: string): string {
  const segs = path.split('.');
  return segs[segs.length - 2] ?? path;
}

export type PackItemStatus = 'create' | 'exists' | 'notag';

export interface PackItem {
  def: PackRuleDef;
  /** resolved rule name (equip suffix when the def fans out) */
  name: string;
  tag: AdminTag | null;
  status: PackItemStatus;
}

/** Expand a pack against the site's real tags and existing rules:
 *  every def × matching tag becomes one item; defs with no tag land as a
 *  single `notag` item so the preview stays honest. `exists` = a rule with
 *  the same name already sits on that tag (the backend unique key). */
export function expandPack(pack: RulePack, tags: AdminTag[], existing: AdminRule[]): PackItem[] {
  const items: PackItem[] = [];
  const taken = new Set(existing.map((r) => `${r.tag_id}::${r.name}`));
  for (const def of pack.rules) {
    const hits = tags.filter((tg) => def.tagRe.test(tg.path));
    if (!hits.length) {
      items.push({ def, name: def.name, tag: null, status: 'notag' });
      continue;
    }
    for (const tag of hits) {
      const name = hits.length > 1 ? `${def.name} · ${equipOf(tag.path)}` : def.name;
      items.push({ def, name, tag, status: taken.has(`${tag.id}::${name}`) ? 'exists' : 'create' });
    }
  }
  return items;
}

/** RuleInput body for one installable item. */
export function packItemBody(it: PackItem): RuleInput | null {
  if (!it.tag || it.status !== 'create') return null;
  return {
    name: it.name, tag_id: it.tag.id, kind: it.def.kind,
    threshold: it.def.threshold ?? null, stale_s: it.def.stale_s ?? null,
    window_s: it.def.window_s ?? null, deadband: it.def.deadband,
    severity: it.def.severity, enabled: true,
  };
}

/** One-line condition for the preview table — same vocabulary as the
 *  monitors list (`mon.cond.*`), evaluated by the caller via t(). */
export function packItemCond(def: PackRuleDef): { key: string; v?: number } {
  if (def.kind === 'stale') return { key: 'mon.cond.stale', v: def.stale_s ?? undefined };
  if (def.kind === 'roc') return { key: 'mon.cond.roc', v: def.threshold ?? undefined };
  if (def.threshold == null) return { key: 'mon.cond.none' };
  return { key: def.kind === 'lo' || def.kind === 'lolo' ? 'mon.cond.lt' : 'mon.cond.gt', v: def.threshold };
}
