// One-time credential display with copy buttons. The secret lives only in
// React state for this view — never persisted, never logged.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Eye, EyeOff, TriangleAlert } from 'lucide-react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label} title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-line px-2 text-[12px] hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
      {done ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span aria-live="polite">{done ? t('dev.copied') : t('dev.copy')}</span>
    </button>
  );
}

export function SecretReveal({ username, secret }: { username: string; secret: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded border border-[#f3c97a] bg-[var(--color-caution-soft)] px-3 py-2 text-[12px] text-[#6b4700]" role="note">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        {t('dev.secretOnce')}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[12px] font-semibold text-ink-68">{t('dev.username')}</span>
        <code className="min-w-0 flex-1 truncate rounded bg-subtle px-2 py-1 font-mono text-[12px]">{username}</code>
        <CopyButton text={username} label={t('dev.copyUsername')} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[12px] font-semibold text-ink-68">{t('dev.secret')}</span>
        <code className="min-w-0 flex-1 truncate rounded bg-subtle px-2 py-1 font-mono text-[12px]">{show ? secret : '•'.repeat(24)}</code>
        <button type="button" aria-label={show ? t('dev.hide') : t('dev.show')} aria-pressed={show} onClick={() => setShow((s) => !s)}
          className="grid h-7 w-7 place-items-center rounded border border-line hover:bg-subtle focus-visible:outline-2 focus-visible:outline-blue">
          {show ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
        </button>
        <CopyButton text={secret} label={t('dev.copySecret')} />
      </div>
    </div>
  );
}
