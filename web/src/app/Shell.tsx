import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { live } from '../lib/live';
import { useNow, useStore, useViewport } from '../lib/hooks';
import { setLang, type Lang } from '../lib/i18n';
import { SIGNALS, shortName } from '../lib/plant';
import { Icon, type IconName } from '../shared/ui/Icon';
import { SignInDialog } from '../features/auth/SignInDialog';
import { FaceplateProvider } from '../features/faceplate/FaceplateContext';
import { FaceplatePanel } from '../features/faceplate/Faceplate';
import { FLOOD_THRESHOLD, useAlarms } from '../features/alarms/alarms';
import { signOut, useRole } from './session';

const NAV: { group: string; items: { to: string; key: string; icon: IconName }[] }[] = [
  { group: 'nav.monitor', items: [
    { to: '/', key: 'nav.overview', icon: 'overview' },
    { to: '/line', key: 'nav.line', icon: 'line' },
    { to: '/line3d', key: 'nav.line3d', icon: 'line3d' },
    { to: '/trends', key: 'nav.trends', icon: 'trends' },
  ] },
  { group: 'nav.operate', items: [
    { to: '/alarms', key: 'nav.alarms', icon: 'alarm' },
    { to: '/commands', key: 'nav.commands', icon: 'commands' },
  ] },
  { group: 'nav.intelligence', items: [
    { to: '/insights', key: 'nav.insights', icon: 'sparkle' },
  ] },
  { group: 'nav.system', items: [
    { to: '/tags', key: 'nav.tags', icon: 'tags' },
    { to: '/health', key: 'nav.health', icon: 'health' },
  ] },
];

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
  const current = NAV.flatMap((g) => g.items).find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));
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
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark"><Icon name="plant" size={20} /></span>
          <span className="brand-text">
            <span className="brand-name">Plant 1</span>
            <span className="brand-sub">{t('shell.product')}</span>
          </span>
        </Link>
        <nav className="nav side-nav" aria-label="primary">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: 'contents' }}>
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

      <div className="main">
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
            <Link to="/alarms?state=active" className="icon-btn" aria-label={t('shell.alarmsButton', { count: active.length })}>
              <Icon name="alarm" />
              {active.length > 0 && <span className="count num">{active.length}</span>}
            </Link>
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
        <AlarmStrip />
        <FaceplateProvider>
          <div className="main-body">
            <main id="content">
              <Outlet />
            </main>
            <FaceplatePanel />
          </div>
        </FaceplateProvider>
      </div>
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
