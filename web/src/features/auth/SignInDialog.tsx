// Development sign-in (v1 bearer token). Phase 3 replaces this with OIDC
// (ADR-12); the dialog keeps the same entry point in the shell.
// Same language as the sign-in wall: product mark + mono caps dev label,
// dashed-border demo ghosts (APP_ENV=dev only), token field as the control.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn } from '../../app/session';
import { authConfig } from './oidc';
import { Icon } from '../../shared/ui/Icon';
import './auth.css';

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');
  const cfg = authConfig();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setToken(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const demo = (tok: string) => { signIn(tok); onClose(); };

  return (
    <dialog ref={ref} className="dialog auth-dialog" aria-labelledby="signin-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) { signIn(token); onClose(); } }}>
        <div className="dialog-head">
          <span className="brand-mark auth-dialog-mark"><img src="/logo-192.png" alt="" /></span>
          <div className="auth-dialog-title">
            <h2 id="signin-title">{t('auth.title')}</h2>
            {cfg?.dev_tokens && <span className="dev-signin-label">{t('auth.devTitle')}</span>}
          </div>
        </div>
        <div className="dialog-body">
          <p>{t('auth.body')}</p>
          <label className="field">
            <span className="field-label">{t('auth.token')}</span>
            <input
              className="input num token-input" value={token} onChange={(e) => setToken(e.target.value)}
              autoComplete="off" spellCheck={false} autoFocus
            />
          </label>
          {cfg?.dev_tokens && (
            <>
              <div className="dev-signin-row">
                <button type="button" className="btn btn-ghost btn-sm dev-signin-op"
                        onClick={() => demo('demo-operator')}>
                  {t('auth.devOperator')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm dev-signin-viewer"
                        onClick={() => demo('demo-viewer')}>
                  {t('auth.devViewer')}
                </button>
              </div>
              <span className="hint">{t('auth.demoHint')}</span>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('auth.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!token.trim()}>{t('auth.submit')}</button>
        </div>
      </form>
    </dialog>
  );
}
