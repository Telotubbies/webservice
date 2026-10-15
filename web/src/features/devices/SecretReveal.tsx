// One-time credential display with copy buttons. The secret lives only in
// React state for this view — never persisted, never logged.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Eye, EyeOff, TriangleAlert, X } from 'lucide-react';
import { CAUTION_TEXT_CLASS, copyText } from './devices';

/** Copy with visible + announced outcome. On failure (no clipboard on a
 *  plain-HTTP origin) it says so and tells the technician to copy by hand. */
export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied?: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button type="button" aria-label={label} title={label}
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? 'done' : 'fail');
          if (ok) onCopied?.();
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState('idle'), ok ? 2000 : 5000);
        });
      }}
      className={`inline-flex h-8 shrink-0 items-center gap-1 rounded border px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-blue ${
        state === 'done' ? 'border-[var(--color-ok)] bg-[var(--color-ok-soft)]'
          : state === 'fail' ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
            : 'border-line-hard bg-white hover:bg-subtle'}`}>
      {state === 'done' ? <Check size={14} aria-hidden /> : state === 'fail' ? <X size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span aria-live="polite">{state === 'done' ? t('dev.copied') : state === 'fail' ? t('dev.copyFail') : t('dev.copy')}</span>
    </button>
  );
}

/** One-time credential. The key is masked by default but shown IN FULL (wrapped,
 *  click-to-select) when revealed — a technician may have to type it by hand. */
export function SecretReveal({ username, secret, onCopied }: { username: string; secret: string; onCopied?: () => void }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-3">
      <div className={`flex items-start gap-2 rounded border border-[var(--color-warn)] bg-[var(--color-caution-soft)] px-3 py-2 text-[12.5px] ${CAUTION_TEXT_CLASS}`} role="note">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span><strong className="font-semibold">{t('dev.secretOnceTitle')}</strong> {t('dev.secretOnce')}</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-[96px_1fr_auto] sm:items-center sm:gap-2">
        <span className="text-[12px] font-semibold text-ink-68">{t('dev.username')}</span>
        <code className="min-w-0 select-all break-all rounded bg-subtle px-2 py-1.5 font-mono text-[12px]">{username}</code>
        <span className="flex justify-end"><CopyButton text={username} label={t('dev.copyUsername')} /></span>
      </div>
      <div className="grid gap-1 sm:grid-cols-[96px_1fr_auto] sm:items-center sm:gap-2">
        <span className="text-[12px] font-semibold text-ink-68">{t('dev.secret')}</span>
        <code className="min-w-0 select-all break-all rounded bg-subtle px-2 py-1.5 font-mono text-[12px]" data-testid="device-secret">
          {show ? secret : '•'.repeat(24)}
        </code>
        <span className="flex justify-end gap-1.5">
          <button type="button" aria-label={show ? t('dev.hide') : t('dev.show')} title={show ? t('dev.hide') : t('dev.show')} aria-pressed={show} onClick={() => setShow((s) => !s)}
            className="grid h-8 w-8 place-items-center rounded border border-line-hard bg-white hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
            {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
          <CopyButton text={secret} label={t('dev.copySecret')} onCopied={onCopied} />
        </span>
      </div>
    </div>
  );
}
