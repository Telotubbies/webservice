// Facet sidebar — Datadog explorer pattern: collapsible groups of checkbox
// values with counts. Selection is OR within a facet, AND across facets; the
// caller owns the state (a Record<facet, Set<value>>) so it can also drive
// the URL or the table. Counts are supplied per value by the caller.

import { useState, type ReactNode } from 'react';
import { DdIcon } from './DdIcon';

export type FacetSel = Record<string, Set<string>>;

export interface FacetValue {
  value: string;
  label: ReactNode;
  count: number;
  /** small leading mark (status stripe, glyph) */
  mark?: ReactNode;
}
export interface FacetDef { id: string; title: string; values: FacetValue[]; /** collapsed on first paint */ closed?: boolean; /** show N values, rest behind "View more" */ limit?: number }

export function toggleFacet(sel: FacetSel, facet: string, value: string): FacetSel {
  const next: FacetSel = { ...sel, [facet]: new Set(sel[facet] ?? []) };
  if (next[facet].has(value)) next[facet].delete(value); else next[facet].add(value);
  return next;
}

/** True when `row`'s value for every active facet is in that facet's selection. */
export function passesFacets(sel: FacetSel, pick: (facet: string) => string | string[], skip?: string): boolean {
  return Object.entries(sel).every(([f, set]) => {
    if (f === skip || set.size === 0) return true;
    const v = pick(f);
    return Array.isArray(v) ? v.some((x) => set.has(x)) : set.has(v);
  });
}

function FacetGroup({ def, sel, onToggle, viewMore }: { def: FacetDef; sel: Set<string>; onToggle: (v: string) => void; viewMore: string }) {
  const [open, setOpen] = useState(!def.closed);
  const [all, setAll] = useState(false);
  const limit = def.limit ?? 6;
  const shown = all ? def.values : def.values.slice(0, limit);
  return (
    <section className="border-b border-line py-2">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 px-1 text-left text-[13px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DdIcon name={open ? 'caret-down' : 'caret-right'} size={10} className="text-ink-46" />
        {def.title}
      </button>
      {open && (
        <ul className="mt-1">
          {def.values.length === 0 && <li className="px-2 py-1 text-[12px] italic text-ink-46">—</li>}
          {shown.map((v) => {
            const id = `facet-${def.id}-${v.value}`;
            return (
              <li key={v.value}>
                <label htmlFor={id} className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-1 text-[13px] hover:bg-info-soft">
                  <input id={id} type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-[var(--color-blue)]" checked={sel.has(v.value)} onChange={() => onToggle(v.value)} />
                  {v.mark}
                  <span className="min-w-0 flex-1 truncate" title={typeof v.label === 'string' ? v.label : undefined}>{v.label}</span>
                  <span className="font-mono text-[12px] tabular-nums text-ink-46">{v.count}</span>
                </label>
              </li>
            );
          })}
          {!all && def.values.length > limit && (
            <li>
              <button type="button" className="px-1 py-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={() => setAll(true)}>{viewMore}</button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export function FacetSidebar({ facets, sel, onToggle, onClear, viewMore, clearLabel, className = '', header }: {
  facets: FacetDef[]; sel: FacetSel; onToggle: (facet: string, value: string) => void; onClear: () => void;
  viewMore: string; clearLabel: string; className?: string; header?: ReactNode;
}) {
  const active = Object.values(sel).reduce((n, s) => n + s.size, 0);
  return (
    <aside className={`min-w-0 text-ink ${className}`}>
      {header}
      {active > 0 && (
        <button type="button" className="mb-1 flex h-7 items-center gap-1 px-1 text-[12px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue" onClick={onClear}>
          <DdIcon name="cancel" size={10} /> {clearLabel} ({active})
        </button>
      )}
      {facets.map((f) => (
        <FacetGroup key={f.id} def={f} sel={sel[f.id] ?? new Set()} onToggle={(v) => onToggle(f.id, v)} viewMore={viewMore} />
      ))}
    </aside>
  );
}
