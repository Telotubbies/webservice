import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { live } from '../lib/live';
import { useNow, useStore, useViewport } from '../lib/hooks';
import { setLang, type Lang } from '../lib/i18n';
import { SIGNALS, shortName } from '../lib/plant';
import { Icon } from '../shared/ui/Icon';
import { SignInDialog } from '../features/auth/SignInDialog';
import { CommandPalette, ShortcutsOverlay } from '../shared/ui/CommandPalette';
import { FaceplateProvider } from '../features/faceplate/FaceplateContext';
import { FaceplatePanel } from '../features/faceplate/Faceplate';
import { FLOOD_THRESHOLD, useAlarms } from '../features/alarms/alarms';
import { setCalm, useCalm } from '../features/overview/AmbientField';
import { canOperate, signOut, useRole } from './session';
import { NAV } from './nav';
import { palette, usePaletteOpen } from './palette';

const MOBILE = new Set(['/', '/alarms', '/trends', '/line', '/insights']);

function LivePill() {
  const { t } = useTranslation();
  const ws = useStore(() => live.ws);
  const health = useStore(() => live.health);
  const edgeDown = health?.edge === 'stale';
  const key = ws === 'open' ? (edgeDown ? 'health.stale' : 'shell.live')
    : ws === 'auth_expired' ? 'shell.sessionExpired' : ws === 'closed' ? 'shell.offline' : `shell.${ws}`;
  return (
    <span className={`live-pill${ws === 'open' && !edgeDown ? ' is-live' : ' is-down'}`} role="status">
      <span className="dot" aria-hidden />{t(key)}
    </span>
  );
}

function AlarmStrip() {
  const { t } = useTranslation();
  const { critical, active } = useAlarms();
  const loc = useLocation();
  const label = (n: string) => (SIGNALS[n] ? t(SIGNALS[n].labelKey) : shortName(n));
  if (active.length >= FLOOD_THRESHOLD) {
    return (
      <div className="alarm-strip is-flood" role="alert">
        <Icon name="warn" className="sev-icon" size={22} />
        <span className="grow">{t('shell.flood', { count: active.length })}</span>
        {loc.pathname !== '/alarms' && <Link className="btn btn-sm" to="/alarms?state=active">{t('shell.viewAlarms')}</Link>}
      </div>
    );
  }
  const unacked = critical.filter((a) => a.state === 'active');
  if (unacked.length === 0) return null;
  return (
    <div className="alarm-strip" role="alert">
      <Icon name="warn" className="sev-icon" size={22} />
      <span className="grow">{t('shell.criticalActive', { count: unacked.length, what: label(unacked[0].tag) })}</span>
      {loc.pathname !== '/alarms' && <Link className="btn btn-sm" to="/alarms?state=active">{t('shell.viewAlarm')}</Link>}
    </div>
  );
}

export function Shell() {
  const { t, i18n } = useTranslation();
  const role = useRole();
  const vp = useViewport();
  const now = useNow(1000);
  const { active } = useAlarms();
  const loc = useLocation();
  const [signInOpen, setSignInOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const calm = useCalm();
  const paletteOpen = usePaletteOpen();
  const mainRef = useRef<HTMLDivElement>(null);

  // kiosk/wallboard mode (v4 T12): ?kiosk=1 hides nav+topbar chrome and makes
  // every control inert — the ops plane doubles as an Andon board. inert (not
  // CSS-only) so pointer AND keyboard/SR interaction is suppressed.
  const kiosk = new URLSearchParams(loc.search).get('kiosk') === '1';
  useEffect(() => {
    mainRef.current?.toggleAttribute('inert', kiosk);
    // every overlay lives outside .main's inert scope — shut them all on
    // entry so nothing interactive leaks onto the wallboard (T12 review)
    if (kiosk) { palette.close(); setHelpOpen(false); setSignInOpen(false); }
  }, [kiosk]);

  // ⌘K / Ctrl+K palette + ? shortcuts overlay. The palette's open/close signal
  // is the palette.ts seam (T11); the panel itself is the T12 component.
  // Kiosk suppresses all overlays — a wallboard takes no input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (kiosk) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
          && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        palette.toggle();
      } else if (e.key === '?' && !typing && !palette.isOpen()
          && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      } else if (e.key === 'Escape' && palette.isOpen() && !document.querySelector('dialog[open]')) {
        palette.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kiosk]);
  // exact-or-segment match so '/admin' doesn't shadow '/admin/rules'
  const current = NAV.flatMap((g) => g.items).find(
    (i) => (i.to === '/' ? loc.pathname === '/'
      : loc.pathname === i.to || loc.pathname.startsWith(`${i.to}/`)));
  const mobile = vp === 'xs';

  if (vp === 'tiny') {
    return (
      <div className="too-small">
        <h1>{t('shell.tooSmallTitle')}</h1>
        <p className="muted">{t('shell.tooSmallBody')}</p>
      </div>
    );
  }

  return (
    <div className={`app${kiosk ? ' is-kiosk' : ''}`}>
      {!kiosk && (
      <aside className="sidebar">
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark"><Icon name="plant" size={20} /></span>
          <span className="brand-text">
            <span className="brand-name">Plant 1</span>
            <span className="brand-sub">{t('shell.product')}</span>
          </span>
        </Link>
        <nav className="nav side-nav" aria-label="primary">
          {NAV.filter((g) => !g.gated || canOperate(role)).map((g, gi) => (
            <div key={g.group} style={{ display: 'contents' }}>
              {/* icon rail: group labels stay in the a11y name of each item;
                  a hairline separator keeps the group structure visible */}
              {!mobile && gi > 0 && <span className="nav-sep" aria-hidden />}
              {!mobile && <span className="nav-group">{t(g.group)}</span>}
              {g.items.filter((i) => !mobile || MOBILE.has(i.to)).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-item tab" aria-label={t(i.key)}>
                  <Icon name={i.icon} />
                  <span className="label">{t(i.key)}</span>
                  {i.to === '/alarms' && active.length > 0 && (
                    <span className="nav-badge alarm-count num" aria-label={t('shell.alarmsButton', { count: active.length })}>
                      {active.length}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <p className="sidebar-foot">v0.2</p>
      </aside>
      )}

      <div className="main" ref={mainRef}>
        {!kiosk && (
        <header className="topbar">
          <div className="crumbs">
            <span className="site">plant1</span>
            <span className="sep" aria-hidden>/</span>
            <span>{current ? t(current.key) : ''}</span>
          </div>
          <div className="top-actions">
            <LivePill />
            <span className="clock top-clock" aria-label="time">
              {new Date(now).toLocaleTimeString('en-GB', { hour12: false })}
            </span>
            <button
              type="button" className="icon-btn"
              aria-label={t('palette.open')} title={t('palette.open')}
              onClick={() => palette.open()}
            >
              <Icon name="search" />
            </button>
            <Link to="/alarms?state=active" className="icon-btn" aria-label={t('shell.alarmsButton', { count: active.length })}>
              <Icon name="alarm" />
              {active.length > 0 && <span className="count num">{active.length}</span>}
            </Link>
            <button
              type="button" className="icon-btn calm-toggle"
              aria-pressed={calm} aria-label={t('shell.calm')} title={t('shell.calm')}
              onClick={() => setCalm(!calm)}
            >
              <Icon name="waves" />
            </button>
            <div className="lang-toggle" role="group" aria-label={t('shell.language')}>
              {(['th', 'en'] as Lang[]).map((l) => (
                <button key={l} type="button" aria-pressed={i18n.language === l} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            {role === 'none' ? (
              <button className="btn btn-sm btn-primary signin-btn" onClick={() => setSignInOpen(true)}>
                {t('shell.signIn')}
              </button>
            ) : (
              <button className="user-btn" onClick={signOut} title={t('shell.signOut')}>
                <span className="avatar" aria-hidden><Icon name="user" size={16} /></span>
                <span className="role-tag">{t(`roles.${role}`)}</span>
                <span className="sr-only">{t('shell.signOut')}</span>
              </button>
            )}
          </div>
        </header>
        )}
        <AlarmStrip />
        <FaceplateProvider>
          <div className="main-body">
            <main id="content">
              <Outlet />
            </main>
            {/* wallboard: the faceplate is a control surface — never renders in kiosk */}
            {!kiosk && <FaceplatePanel />}
          </div>
          {paletteOpen && !kiosk && <CommandPalette />}
        </FaceplateProvider>
      </div>
      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
