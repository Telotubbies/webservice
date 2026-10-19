// Sticky page bar — dd pattern: 44px, [back] icon + title [status] + tabs +
// lede, actions right, hairline under. ONE header for every page:
// ProductHeader (Product.tsx) renders through this too.
// Below md the bar wraps: title + actions on row 1, tabs scroll on row 2,
// the title truncates instead of breaking the 44px row.

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DdIcon } from './DdIcon';
import type { DdIconName } from './ddicons';

export interface PageTab {
  to: string; label: string; end?: boolean;
  /** optional count chip, e.g. active alarms */
  count?: number;
}

export interface PageBarProps {
  title: string;
  /** one-line context, hidden below md */
  lede?: string;
  /** right-aligned controls (time range, primary button…) */
  actions?: ReactNode;
  /** product icon left of the title (same name set as the rail) */
  icon?: DdIconName;
  /** route tabs; active tab follows the URL */
  tabs?: PageTab[];
  /** detail pages: link back to the list (keeps the operator oriented) */
  back?: { to: string; label?: string };
  /** inline status next to the title, e.g. <StatePill/> or <Freshness/> */
  status?: ReactNode;
}

export function PageBar({ title, lede, actions, icon, tabs, back, status }: PageBarProps) {
  const { t } = useTranslation();
  return (
    <div className="pagebar sticky top-9 z-10 flex min-h-11 flex-wrap items-center gap-x-3 border-b border-line bg-paper px-4 md:flex-nowrap">
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2 md:flex-initial">
        {back && (
          <NavLink to={back.to} className="btn btn-ghost btn-sm btn-icon shrink-0" aria-label={back.label ?? t('ui.back')} title={back.label ?? t('ui.back')}>
            <DdIcon name="caret-left" size={14} />
          </NavLink>
        )}
        {icon && <DdIcon name={icon} size={16} className="shrink-0 text-ink-68" />}
        <h1 className="truncate text-[15px] font-semibold text-ink" title={title}>{title}</h1>
        {status && <span className="flex shrink-0 items-center">{status}</span>}
      </div>
      {tabs && tabs.length > 0 && (
        <nav
          className="order-last -mx-4 flex h-10 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-2 md:order-none md:mx-0 md:ml-2 md:h-11 md:w-auto md:self-stretch md:border-0 md:px-0"
          aria-label={title}
        >
          {tabs.map((tb) => (
            <NavLink
              key={tb.to} to={tb.to} end={tb.end}
              className={({ isActive }) => `flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                isActive ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
              }`}
            >
              {tb.label}
              {tb.count != null && (
                <span className="rounded-[3px] bg-neutral-soft px-1 text-[11px] font-semibold text-ink-muted">{tb.count}</span>
              )}
            </NavLink>
          ))}
        </nav>
      )}
      {lede && <span className="hidden min-w-0 truncate text-[12px] text-ink-46 md:block">{lede}</span>}
      <div className="hidden flex-1 md:block" />
      {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 pb-2 md:w-auto md:shrink-0 md:flex-nowrap md:pb-0">{actions}</div>}
    </div>
  );
}

/** Standard content area under the PageBar: 16px padding (12px mobile),
 *  16px vertical rhythm between sections. */
export function PageBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page-body ${className}`}>{children}</div>;
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
            <th key={i} scope="col" className="overline h-7 px-3">
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
