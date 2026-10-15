// Product-page chrome shared by the explorer pages (SLOs, Downtimes,
// Dashboards): header with icon + title + route tabs + right actions, and a
// collapsible facet group with checkbox + count rows.

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { DdIcon } from './DdIcon';
import type { DdIconName } from './ddicons';

export function ProductHeader({ icon, title, tabs, actions }: {
  icon: DdIconName; title: string; tabs?: { to: string; label: string; end?: boolean }[]; actions?: ReactNode;
}) {
  return (
    <div className="sticky top-9 z-10 flex h-11 items-center gap-1 border-b border-line bg-white px-4">
      <DdIcon name={icon} size={16} />
      <h1 className="mr-4 ml-1.5 text-[15px] font-semibold">{title}</h1>
      {tabs && (
        <nav className="flex self-stretch" aria-label={title}>
          {tabs.map((tb) => (
            <NavLink
              key={tb.to} to={tb.to} end={tb.end}
              className={({ isActive }) => `flex items-center border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                isActive ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
              }`}
            >{tb.label}</NavLink>
          ))}
        </nav>
      )}
      <span className="flex-1" />
      {actions}
    </div>
  );
}

export interface FacetOption { value: string; label: string; count: number }

export function FacetGroup({ title, options, off, onToggle, emptyLabel }: {
  title: string; options: FacetOption[]; off: Set<string>; onToggle: (v: string) => void; emptyLabel: string;
}) {
  return (
    <details open className="group border-b border-line px-3 py-2 last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-blue">
        <span aria-hidden className="text-[10px] text-ink-46 transition-transform group-open:rotate-90">▶</span>
        {title}
      </summary>
      <div className="mt-1">
        {options.length === 0 && <p className="py-0.5 text-[11px] italic text-ink-46">{emptyLabel}</p>}
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12px] text-ink-68 hover:text-ink">
            <input type="checkbox" checked={!off.has(o.value)} onChange={() => onToggle(o.value)} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            <span className="font-mono text-[11px] text-ink-46">{o.count}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** Count values of `key` across rows → facet options, most frequent first. */
export function facetOptions<T>(rows: T[], key: (r: T) => string, label: (v: string) => string = (v) => v): FacetOption[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: label(value), count }));
}

export function toggleIn(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}
