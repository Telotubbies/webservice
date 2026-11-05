// Popover, Menu, Tooltip (spec §6.5). Built on the HTML popover attribute,
// so content renders in the top layer: no overflow clipping, no z-index wars,
// and light-dismiss (Esc, click outside) comes from the browser. Placement is
// place.ts; focus returns to the trigger on close. Enter is a short spring
// (M11); exit is the browser's instant hide — leaving never holds you up.

import {
  cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { SPRING } from '../theme/motion';
import { placeFloating, type Side } from './place';

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  id: string;
  side: Side;
  anchor: React.RefObject<HTMLButtonElement | null>;
  role: 'dialog' | 'menu';
}
const PopCtx = createContext<Ctx | null>(null);
const usePop = () => {
  const c = useContext(PopCtx);
  if (!c) throw new Error('Popover parts must sit inside Popover.Root');
  return c;
};

function Root({ children, side = 'bottom', open: controlled, onOpenChange, role = 'dialog' }: {
  children: ReactNode; side?: Side; open?: boolean; onOpenChange?: (v: boolean) => void; role?: 'dialog' | 'menu';
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = useCallback((v: boolean) => { setInner(v); onOpenChange?.(v); }, [onOpenChange]);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  return <PopCtx.Provider value={{ open, setOpen, id, side, anchor, role }}>{children}</PopCtx.Provider>;
}

function Trigger({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, id, anchor, role } = usePop();
  return (
    <button
      type="button" ref={anchor} className={className}
      aria-expanded={open} aria-controls={id} aria-haspopup={role}
      onClick={() => setOpen(!open)}
      {...rest}
    >
      {children}
    </button>
  );
}

function Content({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  const { open, setOpen, id, side, anchor, role } = usePop();
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    if (open && !node.matches(':popover-open')) node.showPopover();
    if (!open && node.matches(':popover-open')) node.hidePopover();
    if (!open || !anchor.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = placeFloating({ x: a.left, y: a.top, w: a.width, h: a.height }, { w: node.offsetWidth, h: node.offsetHeight },
      { w: window.innerWidth, h: window.innerHeight }, side);
    setPos({ x: p.x, y: p.y });
  }, [open, side, anchor]);

  // Light-dismiss (Esc / outside click) closes natively — mirror it into state
  // and hand focus back to the trigger.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') {
        setOpen(false);
        if (node.contains(document.activeElement) || document.activeElement === document.body) anchor.current?.focus();
      }
    };
    node.addEventListener('toggle', onToggle);
    return () => node.removeEventListener('toggle', onToggle);
  }, [setOpen, anchor]);

  return (
    <div
      ref={el} id={id} popover="auto" role={role} aria-label={label}
      className="m-0 overflow-visible border-0 bg-transparent p-0"
      style={{ position: 'fixed', inset: 'auto', left: pos?.x ?? 0, top: pos?.y ?? 0 }}
    >
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING.snappy}
          className={`min-w-40 rounded-overlay border border-line bg-panel p-1 text-ink shadow-ply2 ${className}`}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

export const Popover = { Root, Trigger, Content };

/* ── Menu: a popover whose items take roving focus ─────────────────────── */

function MenuList({ children, label }: { children: ReactNode; label?: string }) {
  const { open } = usePop();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[role^=menuitem]:not([disabled])')?.focus());
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
  };
  return (
    <Content label={label}>
      <div ref={list} onKeyDown={onKey} className="flex flex-col">{children}</div>
    </Content>
  );
}

function MenuItem({ children, onSelect, disabled, checked }: { children: ReactNode; onSelect: () => void; disabled?: boolean; checked?: boolean }) {
  const { setOpen } = usePop();
  return (
    <button
      type="button" role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked}
      disabled={disabled} tabIndex={-1}
      onClick={() => { onSelect(); setOpen(false); }}
      className="flex h-8 items-center gap-2 rounded-control px-2 text-left text-[13px] hover:bg-panel-2 focus-visible:bg-panel-2 disabled:text-ink-4"
    >
      {checked !== undefined && <span aria-hidden className="w-3 text-accent">{checked ? '✓' : ''}</span>}
      {children}
    </button>
  );
}

/** A menuitemradio is still a menu item for roving focus. */
export const Menu = {
  Root: (p: Omit<Parameters<typeof Root>[0], 'role'>) => <Root {...p} role="menu" />,
  Trigger,
  List: MenuList,
  Item: MenuItem,
};

/* ── Tooltip: hover after 400 ms, focus at once; never the only way to read a value ── */

export function Tooltip({ label, children, side = 'bottom' }: { label: string; children: ReactElement<Record<string, unknown>>; side?: Side }) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const anchorEl = useRef<HTMLElement | null>(null);

  const show = useCallback((target: HTMLElement) => {
    const node = tip.current;
    if (!node) return;
    anchorEl.current = target;
    if (!node.matches(':popover-open')) node.showPopover();
    const a = target.getBoundingClientRect();
    const p = placeFloating({ x: a.left, y: a.top, w: a.width, h: a.height }, { w: node.offsetWidth, h: node.offsetHeight },
      { w: window.innerWidth, h: window.innerHeight }, side);
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
  }, [side]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (tip.current?.matches(':popover-open')) tip.current.hidePopover();
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => show(target), 400);
  }, [show]);
  const child = cloneElement(children, {
    'aria-describedby': id,
    onMouseEnter: onEnter,
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
    onBlur: hide,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') hide(); },
  });
  return (
    <>
      {child}
      <div
        ref={tip} id={id} role="tooltip" popover="manual"
        className="pointer-events-none m-0 max-w-64 rounded-control border-0 bg-chrome px-2 py-1 text-[12px] leading-4 text-white shadow-ply2"
        style={{ position: 'fixed', inset: 'auto' }}
      >
        {label}
      </div>
    </>
  );
}
