// Sign-in wall (v4 T5) — the whole app sits behind this when unauthenticated.
// Prod: SSO redirect only. Dev (APP_ENV=dev): the demo-token path stays for
// UAT/local dev — token field + quick-role buttons.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn } from '../../app/session';
import { authConfig, signInWithSSO } from './oidc';
import { Icon } from '../../shared/ui/Icon';
import './auth.css';

export function SignInWall({ denied = false }: { denied?: boolean }) {
  const { t } = useTranslation();
  const cfg = authConfig();
  const [token, setToken] = useState('');

  const submit = () => { if (token.trim()) signIn(token); };

  return (
    <div className="signin-wall">
      <div className="signin-card" role="main">
        <div className="signin-brand">
          <span className="brand-mark"><Icon name="plant" size={22} /></span>
          <span className="signin-product">{t('shell.product')}</span>
        </div>
        <h1 className="signin-title">{t('auth.wallTitle')}</h1>
        <p className="signin-body muted">
          {denied ? t('auth.denied') : t('auth.wallBody')}
        </p>

        {cfg?.oidc && (
          <button className="btn btn-primary oidc-signin" onClick={() => void signInWithSSO()}>
            {t('auth.sso')}
          </button>
        )}

        {cfg?.dev_tokens && (
          <form className="dev-signin" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <span className="dev-signin-label">{t('auth.devTitle')}</span>
            <div className="dev-signin-row">
              <input
                className="input num token-input" value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('auth.token')} autoComplete="off" spellCheck={false}
              />
              <button type="submit" className="btn signin-btn" disabled={!token.trim()}>
                {t('auth.submit')}
              </button>
            </div>
            <div className="dev-signin-row">
              <button type="button" className="btn btn-ghost dev-signin-op"
                      onClick={() => signIn('demo-operator')}>
                {t('auth.devOperator')}
              </button>
              <button type="button" className="btn btn-ghost dev-signin-viewer"
                      onClick={() => signIn('demo-viewer')}>
                {t('auth.devViewer')}
              </button>
            </div>
            <span className="hint">{t('auth.demoHint')}</span>
          </form>
        )}
      </div>
    </div>
  );
}
