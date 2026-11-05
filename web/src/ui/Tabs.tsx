// Tabs (compound). Roving tabindex — Tab enters the list once, ←/→ (and
// Home/End) move and select. The indicator slides between tabs with a shared
// layoutId; reduced motion makes it jump.

import { createContext, useContext, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { SPRING } from '../theme/motion';

interface Ctx { value: string; set: (v: string) => void; base: string }
const TabsCtx = createContext<Ctx | null>(null);
const useTabs = () => {
  const c = useContext(TabsCtx);
  if (!c) throw new Error('Tabs parts must sit inside Tabs.Root');
  return c;
};

function Root({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) {
  const base = useId();
  return <TabsCtx.Provider value={{ value, set: onValueChange, base }}>{children}</TabsCtx.Provider>;
}

function List({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=tab]:not([disabled])') ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    next.focus();
    next.click();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 border-b border-line">
      {children}
    </div>
  );
}

function Tab({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) {
  const { value: cur, set, base } = useTabs();
  const on = cur === value;
  return (
    <button
      type="button" role="tab" id={`${base}-t-${value}`} aria-selected={on} aria-controls={`${base}-p-${value}`}
      tabIndex={on ? 0 : -1} disabled={disabled} onClick={() => set(value)}
      className={`relative -mb-px h-9 px-3 text-[13px] ${on ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink'} disabled:text-ink-4`}
    >
      {children}
      {on && <motion.span layoutId={`${base}-ind`} transition={SPRING.snappy} className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

function Panel({ value, children }: { value: string; children: ReactNode }) {
  const { value: cur, base } = useTabs();
  if (cur !== value) return null;
  return <div role="tabpanel" id={`${base}-p-${value}`} aria-labelledby={`${base}-t-${value}`} tabIndex={0} className="outline-none">{children}</div>;
}

export const Tabs = { Root, List, Tab, Panel };
