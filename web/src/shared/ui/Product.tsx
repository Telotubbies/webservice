// Product-page chrome shared by the explorer pages (SLOs, Downtimes,
// Dashboards): header with icon + title + route tabs + right actions, and a
// collapsible facet group with checkbox + count rows.

import type { ReactNode } from 'react';
import type { DdIconName } from './ddicons';
import { PageBar, type PageBarProps, type PageTab } from './Page';

/** Explorer-page header. Kept for existing call sites — it is PageBar with a
 *  required icon, so every page shares one header layout. */
export function ProductHeader({ icon, title, tabs, actions, lede, status, back }: {
  icon: DdIconName; title: string; tabs?: PageTab[]; actions?: ReactNode;
} & Pick<PageBarProps, 'lede' | 'status' | 'back'>) {
  return <PageBar icon={icon} title={title} tabs={tabs} actions={actions} lede={lede} status={status} back={back} />;
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
