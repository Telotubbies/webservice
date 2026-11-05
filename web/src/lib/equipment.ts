// Central equipment list of the site: the parts of its active plant model.
// Every page that can narrow by equipment (Tags, Trends, Alarms, Commands, the
// line views) reads the same list and the same selection from here, so
// choosing "Mixer" once follows you across the app.

import { useEffect, useSyncExternalStore } from 'react';
import { getScope, subscribeScope } from './scope';
import { hierarchyApi } from './api';
import { liveName, plantApi, type PlantPart } from './plantModel';

export interface Equipment {
  /** stable within a model: the part's index in the saved list */
  id: string;
  label: string;
  kind: string;
  part: PlantPart;
  /** live-store names (dotted, site-prefixed) of every bound signal */
  tags: string[];
}

/** An ISA-95 area or line: narrows pages to every tag filed under it. */
export interface ScopeGroup { id: string; label: string; kind: 'area' | 'line'; tags: string[] }

interface State { items: Equipment[]; groups: ScopeGroup[]; selected: string | null; loaded: boolean; scope: string }

const KEY = 'wds.equipment';
let state: State = { items: [], groups: [], selected: read(), loaded: false, scope: '' };
const subs = new Set<() => void>();
let inflight = 0;

function read(): string | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}

/** Equipment of a part list (exported for tests and for pages that already hold parts). */
export function toEquipment(parts: PlantPart[]): Equipment[] {
  return parts.map((part, i) => ({
    id: String(i), label: part.label, kind: part.kind, part,
    tags: [...new Set(Object.values(part.bindings))].map(liveName),
  }));
}

async function loadGroups(orgId: string, siteId: string): Promise<ScopeGroup[]> {
  try {
    const { areas } = await hierarchyApi.tree(orgId, siteId, true);
    const out: ScopeGroup[] = [];
    for (const a of areas) {
      const aTags: string[] = [];
      for (const l of a.lines) {
        const lTags = l.equipment.flatMap((e) => (e.tag_paths ?? []).map(liveName));
        aTags.push(...lTags);
        if (lTags.length) out.push({ id: `line:${l.id}`, label: `${a.name} › ${l.name}`, kind: 'line', tags: lTags });
      }
      if (aTags.length) out.push({ id: `area:${a.id}`, label: a.name, kind: 'area', tags: aTags });
    }
    return out;
  } catch {
    return []; // the picker simply offers no areas
  }
}

export async function loadEquipment(): Promise<void> {
  const sc = getScope();
  const scope = sc?.siteId ?? '';
  if (!sc || !scope) return;
  const mine = ++inflight;
  const groups = loadGroups(sc.orgId, sc.siteId);
  try {
    const { model, parts } = await plantApi.active();
    const g = await groups;
    if (mine !== inflight) return;
    const items = model ? toEquipment(parts) : [];
    const known = (id: string | null) => items.some((e) => e.id === id) || g.some((x) => x.id === id);
    set({ items, groups: g, loaded: true, scope, selected: known(state.selected) ? state.selected : null });
  } catch {
    const g = await groups;
    if (mine === inflight) set({ items: [], groups: g, loaded: true, scope });
  }
}

export function selectEquipment(id: string | null): void {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  set({ selected: id });
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snap = () => state;

export function useEquipment() {
  const s = useSyncExternalStore(subscribe, snap, snap);
  useEffect(() => {
    const scope = getScope()?.siteId ?? '';
    if (!s.loaded || s.scope !== scope) void loadEquipment();
    return subscribeScope(() => { void loadEquipment(); });
  }, [s.loaded, s.scope]);
  const current: Pick<Equipment, 'id' | 'label' | 'kind' | 'tags'> | null =
    s.items.find((e) => e.id === s.selected) ?? s.groups.find((g) => g.id === s.selected) ?? null;
  return { items: s.items, groups: s.groups, loaded: s.loaded, current, select: selectEquipment };
}
