// Public landing (v4): the anonymous front door every SaaS has — until now
// unauthenticated visitors hit the sign-in wall directly. Dark canvas + the
// same static CSS contour motif as the wall (duplicated here, not imported —
// auth.css stays scoped to auth). The product preview is a stylised console
// mock drawn in DOM/SVG — decorative shapes in token colours, no screenshot
// and no fake data. No metrics are claimed anywhere on this page.
//
// Routing contract (see App.tsx Boot): anonymous at '/' -> this page; at any
// other path -> SignInWall; the wall itself lives at /signin, reached via the
// Sign-in CTAs below or by hitting a deep link signed out.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { setLang, type Lang } from '../../lib/i18n';
import { Icon, type IconName } from '../../shared/ui/Icon';
import './landing.css';

interface Feature { icon: IconName; title: string; body: string; ai?: boolean }

const FEATURES: Feature[] = [
  { icon: 'line', title: 'landing.f1Title', body: 'landing.f1Body' },
  { icon: 'alarm', title: 'landing.f2Title', body: 'landing.f2Body' },
  { icon: 'sparkle', title: 'landing.f3Title', body: 'landing.f3Body', ai: true },
  { icon: 'globe', title: 'landing.f4Title', body: 'landing.f4Body' },
  { icon: 'shield', title: 'landing.f5Title', body: 'landing.f5Body' },
  { icon: 'commands', title: 'landing.f6Title', body: 'landing.f6Body' },
];

// honest capability strip — a list of what the system is, never numbers
const STRIP = ['landing.s1', 'landing.s2', 'landing.s3', 'landing.s4', 'landing.s5'];

/** One gauge arc: muted track + a partial value arc. Shapes only — the arcs
 * carry no labels or numbers so nothing reads as a real measurement. */
function GaugeArc({ pct, tone }: { pct: number; tone: 'live' | 'run' | 'dim' }) {
  const d = 'M14 40 A 22 22 0 0 1 58 40';
  return (
    <svg className="mk-gauge" viewBox="0 0 72 46" aria-hidden="true">
      <path className="mk-track" d={d} />
      <path className={`mk-arc mk-arc-${tone}`} d={d} pathLength={100} strokeDasharray={`${pct} 100`} />
      <line className="mk-tick" x1="14" y1="40" x2="20" y2="40" />
      <line className="mk-tick" x1="52" y1="40" x2="58" y2="40" />
    </svg>
  );
}

/** Stylised mini-console: a chrome strip, a mimic run (motor -> belt -> bin,
 * camera on post) and three gauge arcs. Entirely decorative. */
function ConsoleMock() {
  return (
    <div className="landing-mock" aria-hidden="true">
      <div className="landing-mock-head">
        <span className="mk-brand" />
        <span className="mk-pill"><i /></span>
        <span className="mk-line" />
      </div>
      <svg className="landing-mimic" viewBox="0 0 320 84">
        {/* operator selection ring on the motor — the cyan live/selection hue */}
        <rect className="mk-sel" x="9" y="27" width="50" height="38" rx="6" />
        <rect className="mk-running" x="16" y="34" width="36" height="24" rx="3" />
        <circle className="mk-mid" cx="34" cy="46" r="6" />
        {/* conveyor: belt body, tread marks, two legs, material on top */}
        <rect className="mk-belt" x="62" y="41" width="116" height="10" rx="5" />
        {[76, 92, 108, 124, 140, 156].map((x) => (
          <line key={x} className="mk-tread" x1={x} y1="42" x2={x} y2="50" />
        ))}
        <line className="mk-leg" x1="80" y1="51" x2="80" y2="64" />
        <line className="mk-leg" x1="160" y1="51" x2="160" y2="64" />
        <circle className="mk-material" cx="96" cy="36" r="3" />
        <circle className="mk-material" cx="132" cy="36" r="3" />
        {/* receiving bin with a level mark */}
        <path className="mk-body" d="M194 24 h50 l-7 30 h-36 z" />
        <line className="mk-tread" x1="204" y1="40" x2="236" y2="40" />
        {/* vision camera on a post */}
        <rect className="mk-mid" x="262" y="12" width="20" height="16" rx="2" />
        <line className="mk-leg" x1="272" y1="28" x2="272" y2="58" />
        {/* flow baseline under the run */}
        <line className="mk-edge" x1="64" y1="72" x2="238" y2="72" />
      </svg>
      <div className="landing-gauges">
        <GaugeArc pct={62} tone="live" />
        <GaugeArc pct={38} tone="run" />
        <GaugeArc pct={80} tone="dim" />
      </div>
    </div>
  );
}

export function Landing() {
  const { t, i18n } = useTranslation();
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-brand">
          <span className="brand-mark landing-mark"><Icon name="plant" size={20} /></span>
          <span className="landing-wordmark">Plant Ops OS</span>
        </span>
        <div className="landing-nav-actions">
          <div className="lang-toggle" role="group" aria-label={t('shell.language')}>
            {(['th', 'en'] as Lang[]).map((l) => (
              <button key={l} type="button" aria-pressed={i18n.language === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <Link to="/signin" className="btn btn-sm btn-primary landing-signin">{t('shell.signIn')}</Link>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Plant Ops OS</p>
            <h1 className="landing-headline">{t('landing.headline')}</h1>
            <p className="landing-sub">{t('landing.sub')}</p>
            <div className="landing-cta">
              <Link to="/signin" className="btn btn-primary landing-signin">{t('shell.signIn')}</Link>
              <a href="#capabilities" className="btn btn-ghost">{t('landing.ctaCaps')}</a>
            </div>
          </div>
          <ConsoleMock />
        </section>

        <ul className="landing-strip">
          {STRIP.map((k) => <li key={k}>{t(k)}</li>)}
        </ul>

        <section id="capabilities" className="landing-caps">
          <h2 className="landing-caps-title">{t('landing.capsTitle')}</h2>
          <div className="landing-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className={`landing-card${f.ai ? ' is-ai' : ''}`}>
                <Icon name={f.icon} size={22} />
                <h3>{t(f.title)}</h3>
                <p>{t(f.body)}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span className="landing-foot-product">Plant Ops OS · v0.2</span>
        <nav className="landing-foot-nav" aria-label={t('landing.footNav')}>
          <Link to="/signin">{t('shell.signIn')}</Link>
        </nav>
        <span className="landing-foot-note dim">{t('landing.langNote')}</span>
      </footer>
    </div>
  );
}
