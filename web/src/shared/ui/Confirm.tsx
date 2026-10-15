// Confirm — dd-pattern destructive-action modal. dim overlay, title,
// consequence line, ghost cancel + danger primary.
// Focus: Cancel receives focus on open (dd convention — an impatient Enter
// must never trigger the dangerous action), Tab/Shift+Tab are trapped
// inside the dialog, Escape cancels, and focus returns to the element
// that opened the dialog on close.

import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Confirm({ title, body, confirm, danger = true, onYes, onNo }: {
  title: string; body?: string; confirm: string; danger?: boolean;
  onYes: () => void; onNo: () => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // latest onNo without re-running the mount effect (callers pass inline fns)
  const onNoRef = useRef(onNo);
  useEffect(() => { onNoRef.current = onNo; }, [onNo]);

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // don't close whatever is under the dialog too
        onNoRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // wrap at both ends; also re-capture focus if it somehow left the dialog
      if (e.shiftKey ? active === first || !box.contains(active)
                    : active === last || !box.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus(); // restore focus to the control that opened the dialog
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/30" onClick={onNo}>
      <div
        ref={boxRef}
        className="w-[400px] max-w-[92vw] rounded-md border border-line bg-white shadow-flyout"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
      >
        <div id={titleId} className="border-b border-line px-4 py-3 text-[14px] font-semibold">{title}</div>
        {body && <p id={bodyId} className="px-4 py-3 text-[13px] text-ink-68">{body}</p>}
        <div className="flex justify-end gap-2 px-4 py-3">
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onNo}>{t('control.cancel')}</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : ''}`}
            onClick={onYes}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
