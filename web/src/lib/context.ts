// Cross-page selection context (F06) — global scope carried in the URL.
// ?fp / ?eq / ?w / ?q params that belong to another page surface as chips;
// a chip is suppressed on the page that owns the param (its own filter row
// already shows the value). 'fp' chips carry no href — the faceplate opens
// in place via FaceplateContext.openFaceplate.

import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router';

export type ContextChipKind = 'fp' | 'eq' | 'w' | 'q';

export interface ContextChip {
  kind: ContextChipKind;
  /** raw param value (tag name, equipment id, window key, query text) */
  label: string;
  /** pivot target — '' for 'fp' (opens the faceplate in place) */
  href: string;
  /** removes the param from the current URL */
  clear: () => void;
}

/** Pages that consume a param as their own filter — the chip stays hidden
 *  there. fp has no owner: it is global overlay state, always context. */
const OWNERS: Record<Exclude<ContextChipKind, 'fp'>, readonly string[]> = {
  eq: ['/line', '/line3d', '/tags'],
  w: ['/trends'],
  q: ['/alarms', '/tags', '/commands'],
};

/** Canonical destination a foreign chip pivots to. */
const HOMES: Record<Exclude<ContextChipKind, 'fp'>, string> = {
  eq: '/line',
  w: '/trends',
  q: '/tags',
};

export function useContextChips(): { chips: ContextChip[] } {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();

  const clearParam = useCallback((key: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  const chips: ContextChip[] = [];
  const fp = params.get('fp');
  if (fp) {
    chips.push({ kind: 'fp', label: fp, href: '', clear: () => clearParam('fp') });
  }
  for (const kind of ['eq', 'w', 'q'] as const) {
    const v = params.get(kind);
    if (!v || OWNERS[kind].includes(pathname)) continue;
    chips.push({
      kind,
      label: v,
      href: `${HOMES[kind]}?${kind}=${encodeURIComponent(v)}`,
      clear: () => clearParam(kind),
    });
  }
  return { chips };
}
