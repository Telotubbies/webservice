import { useEffect, useRef, useState } from 'react';
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
import { setCalm, useCalm } from '../features/overview/AmbientField';
import { canOperate, signOut, useRole } from './session';
import { palette, usePaletteOpen } from './palette';

interface NavItem { to: string; key: string; icon: IconName }
interface NavGroup { group: string; items: NavItem[]; gated?: boolean }

const NAV: NavGroup[] = [
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
  // v4 T10: org administration — operators+ see it (mutations stay
  // admin|owner server-side); viewers get no admin nav at all. Never in the
  // mobile bar — MOBILE is unchanged (5-item UAT contract).
  { group: 'nav.admin', gated: true, items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'shield' },
    { to: '/admin/rules', key: 'nav.adminRules', icon: 'alarm' },
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'user' },
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'download' },
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
  const calm = useCalm();
  const paletteOpen = usePaletteOpen();
  const palettePanelRef = useRef<HTMLDivElement>(null);

  // Palette placeholder focus: grab focus on open, return it on close.
  // T12 replaces this panel — it must add a real focus trap + arrow-nav.
  useEffect(() => {
    if (!paletteOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    palettePanelRef.current?.focus();
    return () => prev?.focus();
  }, [paletteOpen]);

  // ⌘K / Ctrl+K — command-palette seam (T11). The palette panel is a T12
  // deliverable; the open/close signal and this binding are the contract.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette.toggle();
      } else if (e.key === 'Escape' && palette.isOpen() && !document.querySelector('dialog[open]')) {
        palette.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
      {paletteOpen && (
        <div className="palette-scrim" onClick={() => palette.close()}>
          <div
            className="palette-panel" role="dialog" aria-modal="true"
            aria-label={t('palette.title')} tabIndex={-1} ref={palettePanelRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="palette-head">
              <Icon name="search" size={18} />
              <span>{t('palette.placeholder')}</span>
            </div>
          </div>
        </div>
      )}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
