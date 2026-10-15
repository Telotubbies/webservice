// Sticky page bar — dd pattern: 44px, title left, actions right, hairline under.

import type { ReactNode } from 'react';

export function PageBar({ title, lede, actions }: {
  title: string; lede?: string; actions?: ReactNode;
}) {
  return (
    <div className="sticky top-9 z-10 flex h-11 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur">
      <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
      {lede && <span className="hidden text-[12px] text-ink-46 md:block">{lede}</span>}
      <div className="flex-1" />
      {actions}
    </div>
  );
}

export function Card({ title, actions, children, pad = true }: {
  title?: string; actions?: ReactNode; children: ReactNode; pad?: boolean;
}) {
  return (
    <section className="rounded-[5px] border border-line bg-white shadow-card">
      {title && (
        <header className="flex h-9 items-center gap-2 border-b border-line px-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <div className="flex-1" />
          {actions}
        </header>
      )}
      <div className={pad ? 'p-3' : ''}>{children}</div>
    </section>
  );
}

/** dd dense table — 36px rows, hairlines, mono numeric option */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-line text-left">
          {head.map((h, i) => (
            /* dd measured: overline header 11px / 1.8px tracking / uppercase */
            <th key={i} scope="col" className="h-7 px-3 text-[11px] font-semibold uppercase tracking-[1.8px] text-ink-68">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="[&>tr]:h-9 [&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr:hover]:bg-info-soft [&_td]:px-3">
        {children}
      </tbody>
    </table>
  );
}
