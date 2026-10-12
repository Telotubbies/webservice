// Development sign-in (v1 bearer token). Phase 3 replaces this with OIDC
// (ADR-12); the dialog keeps the same entry point in the shell.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn } from '../../app/session';

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setToken(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="signin-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) { signIn(token); onClose(); } }}>
        <div className="dialog-head"><h2 id="signin-title">{t('auth.title')}</h2></div>
        <div className="dialog-body">
          <p>{t('auth.body')}</p>
          <label className="field">
            <span className="field-label">{t('auth.token')}</span>
            <input
              className="input num token-input" value={token} onChange={(e) => setToken(e.target.value)}
              autoComplete="off" spellCheck={false} autoFocus
            />
            <span className="hint">{t('auth.demoHint')}</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('auth.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!token.trim()}>{t('auth.submit')}</button>
        </div>
      </form>
    </dialog>
  );
}
