// Landing — LaunchDarkly current-site pattern (video ref): announcement bar,
// full-width dark nav, tight display headline on a faint grid, glowing
// sign-in input with volt button, floating live-stat product cards, feature
// grid, mono spec strip. Console inside stays dd-light — this is the
// marketing skin only.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { signIn } from '../../app/session';
import { api, setSessionToken } from '../../lib/api';
import { LANGS, setLang } from '../../lib/i18n';
import { authConfig } from '../auth/oidc';
import { Icon } from '../../shared/ui/Icon';
import './landing.css';

const FEATURES = [
  { icon: 'line' as const, t: 'f1' },
  { icon: 'alarm' as const, t: 'f2' },
  { icon: 'sparkle' as const, t: 'f3' },
  { icon: 'shield' as const, t: 'f4' },
  { icon: 'lock' as const, t: 'f5' },
  { icon: 'commands' as const, t: 'f6' },
];

/** spec strip rows — landing.specX / specXV key pairs */
const SPEC_KEYS = ['specIngest', 'specRealtime', 'specControl', 'specAuth', 'specAudit'] as const;

/** floating stat cards — landing.mX label keys (+ mClear for the delta word) */
const MINIS: { key: string; value: string; delta: string; deltaKey?: string; up?: boolean; tint: string }[] = [
  { key: 'mBelt', value: '1.42', delta: '+2.1%', up: true, tint: '#d3f138' },
  { key: 'mAlarms', value: '0', delta: 'clear', deltaKey: 'mClear', up: true, tint: '#7ee787' },
  { key: 'mMqtt', value: '102', delta: '-0.4%', tint: '#58a6ff' },
  { key: 'mUptime', value: '99.9%', delta: '7d', up: true, tint: '#c297ff' },
];

/** mini sparkline for the floating stat cards — static decorative series */
function MiniSpark({ color = '#d3f138' }: { color?: string }) {
  const pts = '0,30 14,26 28,32 42,22 56,26 70,18 84,24 98,14 112,20 126,10';
  return (
    <svg viewBox="0 0 126 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MiniCard({ label, value, delta, up, tint = '#d3f138' }: {
  label: string; value: string; delta: string; up?: boolean; tint?: string;
}) {
  return (
    <div className="ld-mini">
      <div className="lbl"><span className="sq" style={{ background: tint }} />{label}</div>
      <div className="val">{value}<span className={`delta ${up ? 'up' : 'dn'}`}>{delta}</span></div>
      <MiniSpark color={tint} />
    </div>
  );
}

export function Landing() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const cfg = authConfig();
  const [token, setToken] = useState('');
  const [bar, setBar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Validate the token against /api/me BEFORE the real sign-in — otherwise
   *  signIn → refreshSession cleared the token and the landing re-rendered
   *  with zero feedback. Staging the token keeps this component mounted
   *  (nothing bumps authRev until the token is known-good). */
  const enter = async () => {
    const tok = token.trim();
    if (!tok || busy) return;
    setBusy(true);
    setSessionToken(tok);
    try {
      await api.me();
      signIn(tok);
      navigate('/');
    } catch {
      setSessionToken('');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing-root">
      <div className="ld-gridbg" />

      {bar && (
        <div className="ld-announce">
          <span><b>{t('landing.headlineA')}</b> — {t('landing.milestone')}</span>
          <Link to="/signin" className="go">{t('shell.signIn')} →</Link>
          <button className="close" onClick={() => setBar(false)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <nav className="ld-nav">
        <Link to="/" className="ld-nav-logo">
          <span className="ld-mark"><img src="/logo-192.png" alt="" /></span>
          <b>Plant Ops OS</b>
        </Link>
        <div className="ld-nav-links">
          <a href="#caps">{t('landing.capsTitle')}</a>
          <a href="#spec">{t('landing.navSpec')}</a>
        </div>
        <span className="spacer" />
        {/* pre-auth language switch — the wall/landing sit outside the shell
            user menu, so expose EN/TH here */}
        <span className="mr-2 flex items-center gap-0.5" role="group" aria-label={t('shell.language')}>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={i18n.language === l}
              onClick={() => setLang(l)}
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${i18n.language === l ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <Link to="/signin" className="ld-signin">{t('shell.signIn')}</Link>
        <Link to="/signin" className="ld-btn ld-btn-primary">{t('landing.ctaCaps')}</Link>
      </nav>

      <header className="ld-hero">
        <h1 className="ld-h1">
          {t('landing.headlineA')}.
          <span className="l2">{t('landing.headlineB')}.</span>
        </h1>
        <p className="ld-sub">{t('landing.sub')}</p>

        <form className="ld-form" onSubmit={(e) => { e.preventDefault(); void enter(); }}>
          <input
            value={token}
            onChange={(e) => { setToken(e.target.value); setFailed(false); }}
            placeholder={cfg?.dev_tokens ? t('auth.demoHint') : t('auth.token')}
            aria-label={t('auth.token')}
            autoComplete="off" spellCheck={false}
          />
          <button type="submit" className="ld-btn ld-btn-primary" disabled={!token.trim() || busy}>
            {busy ? t('auth.signingIn') : `${t('auth.submit')} →`}
          </button>
        </form>
        {failed && (
          <div className="notice notice-error mt-3" role="alert">
            <Icon name="warn" size={16} /> {t('auth.badToken')}
          </div>
        )}
      </header>

      {/* floating live-stat cards — the video's hero-bottom product panels */}
      <div className="ld-cards" aria-hidden>
        {MINIS.map((m) => (
          <MiniCard
            key={m.key}
            label={t(`landing.${m.key}`)}
            value={m.value}
            delta={m.deltaKey ? t(`landing.${m.deltaKey}`) : m.delta}
            up={m.up}
            tint={m.tint}
          />
        ))}
      </div>

      <section className="ld-section" id="caps">
        <span className="ld-kicker"><span className="tag">◆</span>{t('landing.capsTitle')}</span>
        <h2 className="ld-h2">{t('landing.headlineA')}.</h2>
        <div className="ld-grid">
          {FEATURES.map((f) => (
            <div key={f.t} className="ld-card">
              <span className="ico"><Icon name={f.icon} size={17} /></span>
              <h3>{t(`landing.${f.t}Title`)}</h3>
              <p>{t(`landing.${f.t}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ld-section" id="spec">
        <span className="ld-kicker"><span className="tag">◆</span>{t('landing.specTitle')}</span>
        <dl className="ld-spec">
          {SPEC_KEYS.map((k) => (
            <div key={k} className="ld-spec-row">
              <dt>{t(`landing.${k}`)}</dt>
              <dd>{t(`landing.${k}V`)}</dd>
            </div>
          ))}
          <div className="ld-spec-row">
            <dt>{t('landing.specTopic')}</dt>
            <dd><b>{'v2/{org}/{site}/{edge}/…'}</b> — {t('landing.uns')}</dd>
          </div>
        </dl>
      </section>

      <footer className="ld-foot">
        {t('landing.langNote')} · Plant 1 · v0.2
      </footer>
    </div>
  );
}
