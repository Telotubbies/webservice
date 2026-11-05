// Toaster + useToast. One module-level queue (toast.ts) behind
// useSyncExternalStore, so any component can raise a toast without a
// provider. Two live regions: polite for info/ok/warn, assertive for crit.
// Mount <Toaster/> once (Shell).

import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { DUR, SPRING, exitOf } from '../theme/motion';
import { expire, pushToast, type ToastItem } from './toast';
import './i18n';

let queue: ToastItem[] = [];
const born = new Map<string, number>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (q: ToastItem[]) => { queue = q; emit(); };

let seq = 0;
export function toast(t: Omit<ToastItem, 'id' | 'ttlMs'> & { id?: string; ttlMs?: number }): void {
  const item: ToastItem = { id: t.id ?? `t${++seq}`, tone: t.tone, text: t.text, ttlMs: t.ttlMs ?? 5000 };
  born.set(item.id, Date.now());
  set(pushToast(queue, item));
}
export const useToast = () => toast;

const dismiss = (id: string) => { born.delete(id); set(queue.filter((x) => x.id !== id)); };

const GLYPH: Record<ToastItem['tone'], { g: string; cls: string }> = {
  info: { g: '●', cls: 'text-info' },
  ok: { g: '✓', cls: 'text-ok' },
  warn: { g: '◆', cls: 'text-warn-ink' },
  crit: { g: '▲', cls: 'text-crit' },
};

function List({ items }: { items: ToastItem[] }) {
  const { t } = useTranslation();
  return (
    <AnimatePresence initial={false}>
      {items.map((x) => (
        <motion.li
          key={x.id} layout
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: exitOf(DUR.base) } }}
          transition={SPRING.snappy}
          className={`pointer-events-auto flex w-[min(360px,calc(100vw-32px))] items-start gap-2 rounded-panel border bg-panel px-3 py-2 text-[13px] text-ink shadow-ply2 ${x.tone === 'crit' ? 'border-crit' : 'border-line'}`}
        >
          <span aria-hidden className={`mt-px text-[11px] ${GLYPH[x.tone].cls}`}>{GLYPH[x.tone].g}</span>
          <span className="min-w-0 flex-1">{x.text}</span>
          <button type="button" onClick={() => dismiss(x.id)} aria-label={t('kit.dismiss')}
            className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink">×</button>
        </motion.li>
      ))}
    </AnimatePresence>
  );
}

export function Toaster() {
  const { t } = useTranslation();
  const items = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => queue, () => queue);
  useEffect(() => {
    if (!items.length) return;
    const id = window.setInterval(() => {
      const next = expire(queue, Date.now(), born);
      if (next.length !== queue.length) set(next);
    }, 500);
    return () => window.clearInterval(id);
  }, [items.length]);
  return (
    <div className="pointer-events-none fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-[60] flex flex-col items-end gap-2 md:bottom-4" aria-label={t('kit.notifications')}>
      <ul aria-live="assertive" className="flex flex-col items-end gap-2"><List items={items.filter((x) => x.tone === 'crit')} /></ul>
      <ul aria-live="polite" className="flex flex-col items-end gap-2"><List items={items.filter((x) => x.tone !== 'crit')} /></ul>
    </div>
  );
}
