// Drawer (side sheet) and Dialog — native <dialog> + showModal(), so the
// browser supplies the focus trap, inert background, Esc-to-close and the
// top layer. Ply 3: scrim + blur. Focus lands on the close button and goes
// back to whatever opened it. The sheet springs in (SPRING.gentle);
// reduced motion is honoured by MotionConfig.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { SPRING } from '../theme/motion';
import './i18n';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { opener.current = document.activeElement; d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    const onClosed = () => { (opener.current as HTMLElement | null)?.focus?.(); };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClosed);
    return () => { d.removeEventListener('cancel', onCancel); d.removeEventListener('close', onClosed); };
  }, [onClose]);
  return ref;
}

function Header({ id, title, onClose }: { id: string; title: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-2 border-b border-line px-4 py-3">
      <h2 id={id} className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a modal must put focus inside itself */}
      <button type="button" autoFocus onClick={onClose} aria-label={t('kit.close')}
        className="grid h-8 w-8 place-items-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink">×</button>
    </header>
  );
}

const SHELL = 'm-0 max-h-none max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-black/45 backdrop:backdrop-blur-[2px]';

export function Drawer({ open, onClose, title, children, footer, side = 'right', width = 420 }: SheetProps & { side?: 'right' | 'left'; width?: number }) {
  const ref = useModal(open, onClose);
  const id = useId();
  return (
    <dialog
      ref={ref} aria-labelledby={id}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className={`${SHELL} fixed inset-y-0 h-svh ${side === 'right' ? 'left-auto right-0' : 'left-0 right-auto'}`}
      style={{ width: `min(${width}px, 100vw)` }}
    >
      {open && (
        <motion.div
          initial={{ x: side === 'right' ? '100%' : '-100%' }} animate={{ x: 0 }} transition={SPRING.gentle}
          className="flex h-full flex-col bg-panel shadow-ply3"
        >
          <Header id={id} title={title} onClose={onClose} />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </motion.div>
      )}
    </dialog>
  );
}

export function Dialog({ open, onClose, title, children, footer, width = 480 }: SheetProps & { width?: number }) {
  const ref = useModal(open, onClose);
  const id = useId();
  return (
    <dialog
      ref={ref} aria-labelledby={id}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className={`${SHELL} fixed inset-0 m-auto h-fit`}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
    >
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING.snappy}
          className="flex max-h-[85svh] flex-col rounded-overlay bg-panel shadow-ply3"
        >
          <Header id={id} title={title} onClose={onClose} />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </motion.div>
      )}
    </dialog>
  );
}
