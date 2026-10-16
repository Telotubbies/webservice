// Central equipment list of the site: the parts of its active plant model.
// Every page that can narrow by equipment (Tags, Trends, Alarms, Commands, the
// line views) reads the same list and the same selection from here, so
// choosing "Mixer" once follows you across the app.

import { useEffect, useSyncExternalStore } from 'react';
import { getScope, subscribeScope } from './scope';
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

interface State { items: Equipment[]; selected: string | null; loaded: boolean; scope: string }

const KEY = 'wds.equipment';
let state: State = { items: [], selected: read(), loaded: false, scope: '' };
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

export async function loadEquipment(): Promise<void> {
  const scope = getScope()?.siteId ?? '';
  if (!scope) return;
  const mine = ++inflight;
  try {
    const { model, parts } = await plantApi.active();
    if (mine !== inflight) return;
    const items = model ? toEquipment(parts) : [];
    set({ items, loaded: true, scope, selected: items.some((e) => e.id === state.selected) ? state.selected : null });
  } catch {
    if (mine === inflight) set({ items: [], loaded: true, scope });
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
  const current = s.items.find((e) => e.id === s.selected) ?? null;
  return { items: s.items, loaded: s.loaded, current, select: selectEquipment };
}
