// Dropdown — trigger button + anchored panel for explorer tool rows (saved
// views, share fallback, related-items lists). Esc layering (PARITY §0.4):
// Esc closes ONLY the open dropdown — the handler runs in the window capture
// phase and stops propagation so a flyout or drawer underneath stays open.
// Outside click closes; focus returns to the trigger. Kiosk chrome never
// renders these (they live in page tool rows inside the non-kiosk shell).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Dropdown({ label, title, children, align = 'right', className = '', panelClass = '', triggerClass }: {
  /** trigger content */
  label: ReactNode;
  /** accessible name + tooltip for the trigger */
  title: string;
  /** panel body; a function receives `close` */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  className?: string;
  panelClass?: string;
  triggerClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    // move focus into the panel so keyboard users land on its first control
    const first = root.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not([data-trigger]), a[href]');
    first?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} className={`relative inline-flex ${className}`}>
      <button
        ref={trigger}
        type="button"
        data-trigger
        className={triggerClass ?? 'btn btn-sm btn-ghost'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="true"
        title={title}
        aria-label={typeof label === 'string' ? undefined : title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={title}
          className={`xp-pop absolute top-full z-30 mt-1 min-w-[260px] max-w-[calc(100vw-24px)] rounded-dd border border-line bg-white text-left shadow-flyout ${align === 'right' ? 'right-0' : 'left-0'} ${panelClass}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
