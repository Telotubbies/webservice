// Console v6 chrome (docs/console-v6-plan.md §1.2): Toolbar/ToolGroup/
// ToolButton, SectionTag, CommandChip, RunBar, IoPanel/IoDot, InfoBanner,
// BottomDock and ConnPill. Presentational only — every visible string comes
// from the caller in both languages, so the kit carries no i18n bundle.
// Colours are tokens; command chips code the command TYPE, never a status.

import type { ReactNode } from 'react';
import { DdIcon } from './DdIcon';
import type { DdIconName } from './ddicons';
import { commandKind, type CommandKind } from './commandKind';

/* ── Toolbar ─────────────────────────────────────────────────────────── */

export function Toolbar({ label, children, trailing }: {
  /** accessible name, e.g. the page the tools act on */
  label: string;
  children: ReactNode;
  /** right-hand slot: connection pill, refresh */
  trailing?: ReactNode;
}) {
  return (
    <div role="toolbar" aria-label={label} className="flex min-w-0 items-stretch border-y border-line bg-paper">
      {/* the groups may scroll sideways at 390 instead of clipping a label */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">{children}</div>
      {trailing && <div className="flex shrink-0 items-center gap-2 border-l border-line px-2">{trailing}</div>}
    </div>
  );
}

export function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-stretch border-r border-line px-1 last:border-r-0">
      {children}
    </div>
  );
}

export function ToolButton({ icon, label, onClick, disabled, disabledReason, active }: {
  icon: DdIconName;
  label: string;
  onClick?: () => void;
  /** grey, still focusable, and the reason is spoken and shown on hover */
  disabled?: boolean;
  disabledReason?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      aria-pressed={active}
      title={disabled ? disabledReason : undefined}
      data-tool={label}
      className={`flex min-w-[var(--tool-btn-w)] shrink-0 flex-col items-center justify-center gap-1 px-1.5 py-1.5 text-[12px] leading-tight focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
        disabled
          ? 'cursor-not-allowed text-ink-35'
          : active
            ? 'font-semibold text-blue'
            : 'text-ink-68 hover:bg-subtle hover:text-blue'
      }`}
    >
      <DdIcon name={icon} size={18} />
      <span className="max-w-full whitespace-nowrap text-center">{label}</span>
      {disabled && disabledReason && <span className="sr-only">{disabledReason}</span>}
    </button>
  );
}

/* ── SectionTag ──────────────────────────────────────────────────────── */

export function SectionTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-[3px] bg-[var(--color-accent)] px-2 text-[12px] font-semibold text-[var(--color-on-accent)]">
      {children}
    </span>
  );
}

/* ── CommandChip ─────────────────────────────────────────────────────── */

const CHIP_BG: Record<CommandKind, string> = {
  home: 'bg-[var(--color-cmd-home)]',
  move: 'bg-[var(--color-cmd-move)]',
  set: 'bg-[var(--color-cmd-set)]',
  wait: 'bg-[var(--color-cmd-wait)]',
  loop: 'bg-[var(--color-cmd-loop)]',
  end: 'bg-[var(--color-cmd-end)]',
  other: 'bg-[var(--color-cmd-other)]',
};

export function CommandChip({ code, label }: {
  /** the command word that picks the type, e.g. HOME or SET OUT */
  code: string;
  /** the visible text — a chip is never colour alone */
  label: string;
}) {
  const kind = commandKind(code);
  return (
    <span
      data-kind={kind}
      title={code}
      className={`inline-flex h-5 items-center rounded-[3px] px-2 text-[11px] font-semibold text-[var(--color-cmd-ink)] ${CHIP_BG[kind]}`}
    >
      {label}
    </span>
  );
}

/* ── RunBar ──────────────────────────────────────────────────────────── */

export interface RunBarLabels { run: string; step: string; pause: string; stop: string }

export function RunBar({ state, status, labels, onRun, onStep, onPause, onStop, disabled }: {
  state: 'idle' | 'running' | 'paused';
  /** e.g. "RUNNING · LINE 1 · step 2/5" — running stays neutral grey text */
  status: string;
  labels: RunBarLabels;
  onRun?: () => void;
  /** omit when the API has no step — the button is not rendered */
  onStep?: () => void;
  /** omit when the API has no pause */
  onPause?: () => void;
  onStop?: () => void;
  disabled?: boolean;
}) {
  const off = disabled || state === 'running';
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-line bg-paper px-2 py-1.5" data-run-state={state}>
      <button type="button" className="btn" onClick={onRun} disabled={off}><DdIcon name="play" size={14} />{labels.run}</button>
      {onStep && <button type="button" className="btn btn-ghost" onClick={onStep} disabled={disabled}><DdIcon name="arrow-right" size={14} />{labels.step}</button>}
      {onPause && <button type="button" className="btn btn-ghost" onClick={onPause} disabled={disabled}><DdIcon name="pause" size={14} />{labels.pause}</button>}
      <button type="button" className="btn btn-ghost text-[var(--color-danger)]" onClick={onStop} disabled={disabled}><DdIcon name="stop" size={14} />{labels.stop}</button>
      <span className="ml-auto min-w-0 text-[12px] font-semibold text-ink-68" role="status">{status}</span>
    </div>
  );
}

/* ── IoPanel / IoDot ─────────────────────────────────────────────────── */

export interface IoTab { id: string; label: string; count?: number }
export interface IoItem { id: string; label: string; on: boolean }

/** On = solid dot, off = ring; both carry the on/off word, never colour alone. */
export function IoDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        on ? 'bg-[var(--color-ink)]' : 'border border-[var(--color-ink-46)] bg-transparent'
      }`}
    />
  );
}

export function IoPanel({ title, tabs, active, onTab, items, onLabel, offLabel, emptyLabel }: {
  title: string;
  tabs: IoTab[];
  active: string;
  onTab: (id: string) => void;
  items: IoItem[];
  onLabel: string;
  offLabel: string;
  emptyLabel: string;
}) {
  return (
    <section className="min-w-0 rounded-[5px] border border-line bg-paper" aria-label={title}>
      <header className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </header>
      <div role="tablist" aria-label={title} className="flex gap-1 overflow-x-auto border-b border-line px-2">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tb.id === active}
            onClick={() => onTab(tb.id)}
            className={`h-8 shrink-0 border-b-2 px-2 text-[12px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
              tb.id === active ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
            }`}
          >
            {tb.label}
            {tb.count != null && <span className="ml-1 rounded-[3px] bg-neutral-soft px-1 text-[11px] text-ink-muted">{tb.count}</span>}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-line px-2 py-1">
        {items.length === 0 && <li className="py-2 text-[14px] text-ink-46">{emptyLabel}</li>}
        {items.map((it) => (
          <li key={it.id} className="flex min-h-7 items-center gap-2 py-0.5 text-[13px]">
            <IoDot on={it.on} />
            <span className="min-w-0 flex-1 break-words">{it.label}</span>
            <span className={`shrink-0 text-[12px] font-semibold ${it.on ? 'text-ink' : 'text-ink-46'}`}>{it.on ? onLabel : offLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── InfoBanner ──────────────────────────────────────────────────────── */

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-[4px] bg-[var(--color-blue-soft)] px-3 py-2 text-[14px] leading-snug text-[var(--color-blue-hover)]"
    >
      <DdIcon name="info" size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ── BottomDock ──────────────────────────────────────────────────────── */

export function BottomDock({ label, tabs, active, onTab, collapsed, onToggle, toggleLabel, height = 160, children }: {
  /** accessible name of the tab row */
  label: string;
  tabs: IoTab[];
  active: string;
  onTab: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  toggleLabel: string;
  /** px; a fixed set of heights until D8 wires a drag handle */
  height?: number;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-line bg-paper" data-kit="dock">
      <div className="flex items-center gap-1 px-2">
        <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tb.id === active}
              onClick={() => onTab(tb.id)}
              className={`h-8 shrink-0 border-b-2 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${
                tb.id === active ? 'border-blue font-semibold text-ink' : 'border-transparent text-ink-68 hover:text-blue'
              }`}
            >
              {tb.label}
              {tb.count != null && <span className="ml-1 rounded-[3px] bg-neutral-soft px-1 text-[11px] text-ink-muted">{tb.count}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="btn btn-ghost btn-sm btn-icon shrink-0"
        >
          <DdIcon name={collapsed ? 'caret-up' : 'caret-down'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div style={{ height }} className="overflow-auto border-t border-line px-3 py-2 text-[14px] leading-relaxed">
          {children}
        </div>
      )}
    </section>
  );
}

/* ── ConnPill ────────────────────────────────────────────────────────── */

export function ConnPill({ state, stateLabel, detailLabel }: {
  state: 'live' | 'stale' | 'offline';
  stateLabel: string;
  /** e.g. "Receiving · last value 0.4 s ago" */
  detailLabel: string;
}) {
  const tone =
    state === 'offline'
      ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
      : state === 'stale'
        ? 'border-[var(--color-caution)] bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]'
        : 'border-line bg-subtle text-ink-68';
  return (
    <span data-conn={state} className={`inline-flex items-center gap-2 rounded-[4px] border px-2 py-1 text-[12px] ${tone}`}>
      {state === 'live' ? <IoDot on /> : <DdIcon name={state === 'stale' ? 'clock' : 'attention-circled'} size={13} />}
      <span className="font-semibold text-ink">{stateLabel}</span>
      <span className="min-w-0 break-words">{detailLabel}</span>
    </span>
  );
}
