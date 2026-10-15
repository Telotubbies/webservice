// Sign-in wall — the whole app sits behind this when unauthenticated.
// Account-chooser style: one centered card on a quiet background, company SSO
// first, Google (only when Keycloak brokers it) second, and the dev-token path
// (APP_ENV=dev) visually subordinate below an "or" divider.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { setLang } from '../../lib/i18n';
import { authConfig, signInWithGoogle, signInWithSSO } from './oidc';
import { Icon } from '../../shared/ui/Icon';
import './auth.css';

/** Official multicolor Google "G" (Google sign-in branding guidelines). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function SignInWall({ denied = false }: { denied?: boolean }) {
  const { t, i18n } = useTranslation();
  const cfg = authConfig();
  const google = !!cfg?.oidc && (cfg.idps ?? []).includes('google');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Validate the token against /api/me before the real signIn — a bad token
   *  used to fail silently (signIn → refreshSession cleared it and the wall
   *  remounted blank). Staging the token without bumping authRev keeps this
   *  component mounted so the error can render. */
  const submit = async () => {
    const tok = token.trim();
    if (!tok || busy) return;
    setBusy(true);
    setSessionToken(tok);
    try {
      await api.me();
      signIn(tok);
    } catch {
      setSessionToken('');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-wall">
      <main className="signin-card">
        <span className="brand-mark signin-mark"><img src="/logo-192.png" alt="" /></span>
        <h1 className="signin-title">{t('auth.title')}</h1>
        {denied ? (
          // account state, not an alarm — neutral callout, role=alert so the
          // denial is announced when the wall mounts
          <p className="signin-body signin-denied" role="alert">
            <Icon name="lock" size={16} />
            <span>{t('auth.denied')}</span>
          </p>
        ) : (
          <p className="signin-body muted">{t('auth.signInSub')}</p>
        )}

        {(cfg?.oidc || google) && (
          <div className="signin-actions">
            {cfg?.oidc && (
              <button className="btn btn-primary signin-choice" onClick={() => void signInWithSSO()}>
                <Icon name="shield" size={18} />
                {t('auth.company')}
              </button>
            )}
            {google && (
              <button className="btn signin-choice signin-google" onClick={() => void signInWithGoogle()}>
                <GoogleG />
                {t('auth.google')}
              </button>
            )}
          </div>
        )}

        {cfg?.dev_tokens && (
          <>
            {cfg.oidc && <div className="signin-or" role="separator"><span>{t('auth.or')}</span></div>}
            <form className="dev-signin" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <span className="dev-signin-label" id="dev-signin-label">{t('auth.devTitle')}</span>
              <label className="hint" htmlFor="signin-token">{t('auth.token')}</label>
              <div className="dev-signin-row">
                <input
                  id="signin-token" className="input num token-input" value={token}
                  onChange={(e) => { setToken(e.target.value); setFailed(false); }}
                  placeholder="demo-operator"
                  aria-invalid={failed} aria-describedby={failed ? 'signin-bad-token' : undefined}
                  autoComplete="off" spellCheck={false}
                />
                <button type="submit" className="btn signin-btn" disabled={!token.trim() || busy}>
                  {busy ? t('auth.signingIn') : t('auth.submit')}
                </button>
              </div>
              {failed && (
                <p className="signin-denied" role="alert" id="signin-bad-token">
                  <Icon name="warn" size={14} />
                  <span>{t('auth.badToken')}</span>
                </p>
              )}
              <div className="dev-signin-row dev-signin-demos" aria-labelledby="dev-signin-label" role="group">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => signIn('demo-operator')}>
                  {t('auth.devOperator')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => signIn('demo-viewer')}>
                  {t('auth.devViewer')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => signIn('demo-admin')}>
                  {t('auth.devAdmin')}
                </button>
              </div>
              <span className="hint">{t('auth.demoHint')}</span>
            </form>
          </>
        )}
      </main>
      <footer className="signin-foot">
        <span aria-hidden>Plant Ops OS · v0.2</span>
        <span className="signin-lang" role="group" aria-label={t('shell.language')}>
          <button type="button" lang="en" aria-pressed={i18n.language === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" lang="th" aria-pressed={i18n.language === 'th'} onClick={() => setLang('th')}>ไทย</button>
        </span>
      </footer>
    </div>
  );
}
