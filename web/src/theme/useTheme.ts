// The resolved theme as React state — follows <html data-theme>, which only
// theme.ts writes. Canvas charts read it to rebuild with the right colours
// (a canvas cannot resolve var(--…) on its own).

import { useSyncExternalStore } from 'react';
import type { Theme } from './theme';

function subscribe(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
const snapshot = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function useThemeName(): Theme {
  return useSyncExternalStore(subscribe, snapshot, () => 'light');
}

/** Resolve a CSS custom property to its current value (for canvas drawing). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
