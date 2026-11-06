// Shelve dialog (ISA-18.2): a shelf silences notifications for one alarm, so it
// needs a reason, a time limit (one week at most) and a name on it. Nothing is
// sent until both are set. Focus starts on the first reason, Tab stays inside,
// Escape cancels and focus returns to the button that opened it.

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { notifyApi } from '../notify/api';
import { SHELVE_MINUTES, SHELVE_REASONS, type ShelveReason } from './shelfApi';
import type { Alarm } from '../../types';
import './i18n';

const FOCUSABLE = 'button, input, select, textarea';

export function ShelveDialog({ alarm, orgId, onClose }: { alarm: Alarm; orgId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [why, setWhy] = useState<ShelveReason | ''>('');
  const [note, setNote] = useState('');
  const [mins, setMins] = useState<number>(60);
  const [touched, setTouched] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      const a = document.activeElement;
      if (e.shiftKey ? a === first || !boxRef.current.contains(a) : a === last || !boxRef.current.contains(a)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);

  const reasonText = why ? [t(`shelve.why_${why}`), note.trim()].filter(Boolean).join(': ') : '';
  const missing = !why ? 'shelve.errPick' : why === 'other' && note.trim().length < 3 ? 'shelve.errOther' : '';

  const shelve = useMutation({
    mutationFn: () => notifyApi.shelve(orgId, String(alarm.id), mins, reasonText),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alarm-events', orgId, String(alarm.id)] });
      void qc.invalidateQueries({ queryKey: ['alarm-shelf', orgId] });
      void qc.invalidateQueries({ queryKey: ['site-alarms'] });
      onClose();
    },
  });
  const serverErr = shelve.error instanceof ApiError
    ? (shelve.error.status === 409 ? t('shelve.errCleared') : shelve.error.status === 422 ? t('shelve.errServerReason') : t('shelve.errFailed'))
    : shelve.error ? t('shelve.errFailed') : '';

  const submit = () => {
    setTouched(true);
    if (missing) return;
    shelve.mutate();
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/30" onClick={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="max-h-[calc(100svh-24px)] w-[440px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-md border border-line bg-paper shadow-flyout"
        onClick={(e) => e.stopPropagation()}>
        <div id={titleId} className="border-b border-line px-4 py-3 text-[14px] font-semibold">{t('shelve.title', { name: alarm.rule })}</div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-[13px] text-ink-68">{t('shelve.body')}</p>
          <fieldset>
            <legend className="mb-1 text-[12px] font-semibold text-ink-68">{t('shelve.whyLabel')}</legend>
            <div className="grid gap-1">
              {SHELVE_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-line px-3 text-[13px] has-[:checked]:border-blue has-[:checked]:bg-info-soft">
                  <input type="radio" name="shelve-why" className="h-4 w-4" checked={why === r} onChange={() => setWhy(r)} />
                  {t(`shelve.why_${r}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="shelve-note" className="mb-1 block text-[12px] font-semibold text-ink-68">
              {why === 'other' ? t('shelve.noteRequired') : t('shelve.noteOptional')}
            </label>
            <input id="shelve-note" className="input h-10 w-full" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label htmlFor="shelve-mins" className="mb-1 block text-[12px] font-semibold text-ink-68">{t('shelve.forLabel')}</label>
            <select id="shelve-mins" className="input h-10 w-full" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
              {SHELVE_MINUTES.map((m) => <option key={m} value={m}>{t(`al.m${m}`)}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-ink-46">{t('shelve.limitHint')}</p>
          </div>
          {((touched && missing) || serverErr) && (
            <p className="text-[12px] text-[var(--color-danger)]" role="alert">{serverErr || t(missing)}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn btn-ghost min-h-11" onClick={onClose}>{t('shelve.cancel')}</button>
          <button type="button" className="btn min-h-11" disabled={shelve.isPending} onClick={submit}>
            {shelve.isPending ? t('shelve.busy') : t('shelve.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
