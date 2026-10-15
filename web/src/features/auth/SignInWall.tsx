// Sign-in wall — Hex app.hex.tech/login anatomy on the landing's noir surface:
// logo top-left, centered "Log in", corner-tick panel with SSO/Google rows,
// "or log in with a token" divider, dev-token field (APP_ENV=dev), sign-up
// link and terms line below. All auth logic unchanged — skin only.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { refreshSession, signIn, signOut } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { setLang } from '../../lib/i18n';
import { authConfig, signInWithGoogle, signInWithMicrosoft, signInWithSSO } from './oidc';
import { Icon } from '../../shared/ui/Icon';
import '../landing/landing.css';
import './auth.css';

/** Official multicolor Google "G" (Google sign-in branding guidelines). */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Microsoft four-square mark (Fluent branding). */
function MsMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function SignInWall({ denied = false }: { denied?: boolean }) {
  const { t, i18n } = useTranslation();
  const cfg = authConfig();
  // Provider rows follow the backend's /api/auth/config `idps` list — a row
  // only appears once its IdP is provisioned in Keycloak (`make idp`).
  const idps = cfg?.idps ?? [];
  const google = !!cfg?.oidc && idps.includes('google');
  const microsoft = !!cfg?.oidc && idps.includes('microsoft');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // FR-28 no-access state: who is signed in, and a way out / a re-check
  const [who, setWho] = useState('');
  const [checking, setChecking] = useState(false);
  const [stillDenied, setStillDenied] = useState(false);

  useEffect(() => {
    if (!denied) return;
    let live = true;
    void api.me().then((m) => { if (live) setWho(m.user.display_name || m.user.sub); }).catch(() => {});
    return () => { live = false; };
  }, [denied]);

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    setStillDenied(false);
    const role = await refreshSession();
    // a granted role re-renders App into the shell; only "still none" stays here
    if (role === 'none') { setChecking(false); setStillDenied(true); }
  };

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
    <div className="signin-wall signin-noir">
      <div className="hx-noise" aria-hidden />
      {/* Hex login bg: tiled pink hairline every 290px + viewport edge frame */}
      <div className="signin-stripes" aria-hidden />
      <div className="signin-frame" aria-hidden />

      <Link to="/" className="signin-brand">
        <span className="hx-logo"><span className="hx-logo-mark"><img src="/logo-192.png" alt="" /></span><b>vissointan</b></span>
      </Link>
      <span className="signin-lang" role="group" aria-label={t('shell.language')}>
        <button type="button" lang="en" aria-pressed={i18n.language === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" lang="th" aria-pressed={i18n.language === 'th'} onClick={() => setLang('th')}>TH</button>
      </span>

      <h1 className="signin-title">{denied ? t('access.deniedTitle') : t('auth.title')}</h1>

      <main className="signin-card">
        <span className="hx-corners" aria-hidden><i /><i /><i /><i /></span>
        {denied ? (
          <>
            {/* account state, not an alarm — neutral callout, role=alert so the
                denial is announced when the wall mounts */}
            <div className="signin-denied signin-denied-box" role="alert">
              <Icon name="lock" size={16} />
              <div>
                <p>{t('access.deniedBody')}</p>
                {who && (
                  <p className="signin-who">
                    {t('access.deniedAs')} <strong translate="no">{who}</strong>
                  </p>
                )}
                <p>{t('access.deniedNext')}</p>
              </div>
            </div>
            <div className="signin-actions">
              <button type="button" className="signin-choice signin-primary" onClick={() => void recheck()} aria-disabled={checking || undefined}>
                <Icon name="refresh" size={15} />
                {checking ? t('access.deniedChecking') : t('access.deniedRetry')}
              </button>
              <button type="button" className="signin-choice" onClick={signOut}>
                <Icon name="logout" size={15} />
                {t('access.deniedSwitch')}
              </button>
            </div>
            <p className="signin-still" role="status">{stillDenied ? t('access.deniedStill') : ''}</p>
          </>
        ) : (
          <>
            {(cfg?.oidc || google) && (
              <div className="signin-actions">
                {cfg?.oidc && (
                  <button type="button" className="signin-choice" onClick={() => void signInWithSSO()}>
                    <Icon name="shield" size={15} />
                    {t('auth.company')}
                  </button>
                )}
                {google && (
                  <button type="button" className="signin-choice" onClick={() => void signInWithGoogle()}>
                    <GoogleG />
                    {t('auth.google')}
                  </button>
                )}
                {microsoft && (
                  <button type="button" className="signin-choice" onClick={() => void signInWithMicrosoft()}>
                    <MsMark />
                    {t('auth.microsoft')}
                  </button>
                )}
              </div>
            )}

            {cfg?.dev_tokens && (
              <>
                {(cfg.oidc || google || microsoft) && <div className="signin-or" role="separator"><span>{t('auth.or')}</span></div>}
                <form className="dev-signin" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                  <label className="dev-signin-label" htmlFor="signin-token">{t('auth.tokenLabel')}</label>
                  <input
                    id="signin-token" className="dev-input" value={token}
                    onChange={(e) => { setToken(e.target.value); setFailed(false); }}
                    placeholder="demo-operator"
                    aria-invalid={failed} aria-describedby={failed ? 'signin-bad-token' : undefined}
                    autoComplete="off" spellCheck={false}
                  />
                  <button type="submit" className="signin-choice" disabled={!token.trim() || busy}>
                    {busy ? t('auth.signingIn') : t('auth.submit')}
                  </button>
                  {failed && (
                    <p className="signin-denied" role="alert" id="signin-bad-token">
                      <Icon name="warn" size={14} />
                      <span>{t('auth.badToken')}</span>
                    </p>
                  )}
                  <div className="dev-signin-demos" role="group" aria-label={t('auth.devTitle')}>
                    <button type="button" className="dev-demo" translate="no" onClick={() => signIn('demo-operator')}>
                      {t('auth.devOperator')}
                    </button>
                    <button type="button" className="dev-demo" translate="no" onClick={() => signIn('demo-viewer')}>
                      {t('auth.devViewer')}
                    </button>
                    <button type="button" className="dev-demo" translate="no" onClick={() => signIn('demo-admin')}>
                      {t('auth.devAdmin')}
                    </button>
                  </div>
                  <span className="hint">{t('auth.demoHint')}</span>
                </form>
              </>
            )}
          </>
        )}
      </main>

      <Link to="/" className="signin-signup">{t('auth.signup')}</Link>

      <footer className="signin-terms">
        {t('auth.termsPre')} <Link to="/">{t('auth.termsT')}</Link> {t('auth.termsAnd')}{' '}
        <Link to="/">{t('auth.termsP')}</Link>
      </footer>
    </div>
  );
}
