// Saved views (F12, Datadog Saved Views) — page-scoped filter states in
// localStorage under `wds.savedViews`. URL params ARE the view: `params` is
// the serialized query string, apply restores it wholesale. Cap 20 per page,
// oldest evicted; saving an existing name overwrites it.
// Cross-tab syncs via the `storage` event; same-tab subscribers are nudged by
// a module revision counter (localStorage writes don't fire `storage` in the
// tab that wrote them).

import { useCallback, useSyncExternalStore } from 'react';

export interface SavedView {
  page: string;
  name: string;
  /** serialized URLSearchParams (`params.toString()`) — the whole view */
  params: string;
  /** ISO timestamp */
  created: string;
}

const KEY = 'wds.savedViews';
const CAP = 20;

let rev = 0;
const listeners = new Set<() => void>();
const bump = () => {
  rev++;
  listeners.forEach((fn) => fn());
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) bump();
  });
}

function readAll(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is SavedView =>
      !!x && typeof x === 'object'
      && typeof (x as SavedView).page === 'string'
      && typeof (x as SavedView).name === 'string'
      && typeof (x as SavedView).params === 'string'
      && typeof (x as SavedView).created === 'string');
  } catch {
    return [];
  }
}

function writeAll(views: SavedView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch { /* storage denied */ }
}

const newestFirst = (a: SavedView, b: SavedView) => b.created.localeCompare(a.created);

export function listViews(page: string): SavedView[] {
  return readAll().filter((v) => v.page === page).sort(newestFirst);
}

export function saveView(page: string, name: string, params: string): SavedView[] {
  const view: SavedView = { page, name, params, created: new Date().toISOString() };
  const all = [view, ...readAll().filter((v) => !(v.page === page && v.name === name))]
    .sort(newestFirst);
  // per-page cap, oldest evicted — entries are already newest-first
  const count = new Map<string, number>();
  const capped = all.filter((v) => {
    const n = (count.get(v.page) ?? 0) + 1;
    count.set(v.page, n);
    return n <= CAP;
  });
  writeAll(capped);
  bump();
  return capped.filter((v) => v.page === page);
}

export function deleteView(page: string, name: string): SavedView[] {
  const rest = readAll().filter((v) => !(v.page === page && v.name === name));
  writeAll(rest);
  bump();
  return rest.filter((v) => v.page === page).sort(newestFirst);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// getSnapshot must be referentially stable between revisions — cache per page
const snaps = new Map<string, { rev: number; views: SavedView[] }>();
function snapshot(page: string): SavedView[] {
  const c = snaps.get(page);
  if (c && c.rev === rev) return c.views;
  const views = listViews(page);
  snaps.set(page, { rev, views });
  return views;
}

/** Saved views for one page. Applying a view is the caller's job:
 *  `setSearchParams(new URLSearchParams(view.params))`. */
export function useSavedViews(page: string): {
  views: SavedView[];
  save: (name: string, params: string) => void;
  remove: (name: string) => void;
} {
  const views = useSyncExternalStore(subscribe, () => snapshot(page));
  const save = useCallback((name: string, params: string) => {
    saveView(page, name, params);
  }, [page]);
  const remove = useCallback((name: string) => {
    deleteView(page, name);
  }, [page]);
  return { views, save, remove };
}
