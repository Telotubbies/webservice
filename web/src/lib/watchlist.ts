// Watchlist / pinned tags (F10) — a tag-name set in localStorage under
// `wds.watchlist`. Cross-tab syncs via the `storage` event; same-tab
// subscribers are nudged by a module revision counter (localStorage writes
// don't fire `storage` in the tab that wrote them).

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'wds.watchlist';

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

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** All pinned tags, in pin order. */
export function pinnedTags(): string[] {
  return read();
}

export function isPinned(tag: string): boolean {
  return read().includes(tag);
}

/** Toggle membership; returns the new pinned state. */
export function togglePin(tag: string): boolean {
  const set = new Set(read());
  const on = !set.has(tag);
  if (on) set.add(tag);
  else set.delete(tag);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch { /* storage denied */ }
  bump();
  return on;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// getSnapshot must be referentially stable between revisions
let snap: { rev: number; pinned: string[] } = { rev: -1, pinned: [] };
function snapshot(): string[] {
  if (snap.rev !== rev) snap = { rev, pinned: read() };
  return snap.pinned;
}

export function useWatchlist(): {
  pinned: string[];
  isPinned: (tag: string) => boolean;
  togglePin: (tag: string) => void;
} {
  const pinned = useSyncExternalStore(subscribe, snapshot);
  const isPinnedCb = useCallback((tag: string) => pinned.includes(tag), [pinned]);
  const toggle = useCallback((tag: string) => {
    togglePin(tag);
  }, []);
  return { pinned, isPinned: isPinnedCb, togglePin: toggle };
}
