// Shell — Datadog-pattern chrome: expanded dark sidebar (icon + label rows),
// dark flyout per group, 44px topbar (search / live / bell / user), alarm
// banner under the bar. Nav model shared with the palette via ./nav.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { NAV, type NavGroup, type NavItem, type NavSection } from './nav';
import { Palette } from './Palette';
import { signOut, useRole } from './session';
import { live } from '../lib/live';
import { useStore } from '../lib/hooks';
import { Icon } from '../shared/ui/Icon';
import { DdIcon } from '../shared/ui/DdIcon';
import { useOperateAnyOrg } from '../features/admin/admin';
import { journalIcon, journalTone, markJournalRead, isUnread } from '../features/notify/journal';
import { useAlarms } from '../features/alarms/alarms';

/** `?` overlay — dd keyboard-shortcuts pattern */
function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ['Ctrl K', t('palette.open')],
    ['Esc', 'Close overlay / flyout'],
    ['?', t('shortcuts.title')],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
      <div className="w-[380px] rounded-panel bg-white p-4 shadow-flyout" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-[15px] font-semibold">{t('shortcuts.title')}</h2>
        <dl className="space-y-2">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-[13px]">
              <dt className="text-ink-68">{d}</dt>
              <dd><kbd className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold">{k}</kbd></dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function LivePill() {
  const { t } = useTranslation();
  const ws = useStore(() => live.ws);
  const label = ws === 'open' ? t('shell.live')
    : ws === 'closed' || ws === 'auth_expired' ? t('shell.offline') : t('shell.reconnecting');
  return (
    <span className="flex h-6 items-center gap-1.5 rounded border border-rail-line bg-rail-hover px-2 text-[11px] font-semibold text-white/80">
      <span className="livedot" data-ws={ws} />
      {label}
    </span>
  );
}

function NotifyBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const journal = useStore(() => live.journalRev);
  const entries = useMemo(() => live.journal.slice(0, 20), [journal]);
  const [readAt, setReadAt] = useState(() => Date.now());
  const unread = useMemo(
    () => live.journal.filter((e) => isUnread(e, readAt)).length,
    [journal, readAt],
  );
  return (
    <div className="relative">
      <button
        className="relative grid h-6 w-6 place-items-center rounded text-white/70 hover:bg-blue hover:text-white"
        aria-label={t('shell.alarmsButton', { count: unread })}
        onClick={() => { setOpen((o) => !o); if (!open) setReadAt(markJournalRead(live.journal)); }}
      >
        <DdIcon name="bell" size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--color-danger-bright)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-9 z-50 w-[340px] overflow-hidden rounded-md border border-line bg-white text-ink shadow-pop">
            <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">
              {t('nav.activity')}
            </div>
            <ul className="max-h-[320px] overflow-y-auto">
              {entries.length === 0 && (
                <li className="px-3 py-6 text-center text-[12px] text-[var(--color-muted-pill)]">{t('alarms.empty')}</li>
              )}
              {entries.map((ev) => (
                <li key={ev.id}>
                  <NavLink
                    to={ev.href ?? '/alarms'}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2 hover:bg-subtle"
                  >
                    <span className={`mt-0.5 ${journalTone(ev) === 'critical' ? 'text-[var(--color-danger-bright)]' : journalTone(ev) === 'warning' ? 'text-[var(--color-warn)]' : 'text-[#5d6670]'}`}>
                      <Icon name={journalIcon(ev)} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{t(ev.title, ev.params)}</span>
                      <span className="block text-[11px] text-[var(--color-muted-pill)]">
                        {ev.tag && <span className="font-mono">{ev.tag.split('.').slice(-1)[0]} · </span>}
                        {new Date(ev.ts).toLocaleTimeString()}
                      </span>
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
            <NavLink
              to="/activity"
              onClick={() => setOpen(false)}
              className="flex h-8 items-center justify-center border-t border-line text-[12px] font-semibold text-blue hover:bg-subtle"
            >
              {t('insights.viewAll')}
            </NavLink>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { t, i18n } = useTranslation();
  const role = useRole();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('roles.' + role, { defaultValue: role })}
      >
        <DdIcon name="user" size={16} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-md border border-line bg-white py-1 text-ink shadow-pop">
            <div className="border-b border-line px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted-pill)]">{t('roles.' + role, { defaultValue: role })}</div>
            </div>
            <NavLink
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-subtle"
            >
              <DdIcon name="cog" size={14} /> {t('nav.settings')}
            </NavLink>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-subtle"
              onClick={() => void i18n.changeLanguage(i18n.language === 'th' ? 'en' : 'th')}
            >
              <DdIcon name="globe" size={14} /> {t('shell.language')}: {i18n.language.toUpperCase()}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[var(--color-danger)] hover:bg-subtle"
              onClick={() => { setOpen(false); signOut(); }}
            >
              <Icon name="logout" size={14} /> {t('shell.signOut')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AlarmBanner() {
  const { t } = useTranslation();
  const { critical, active } = useAlarms();
  if (!critical.length) return null;
  const latest = critical[0];
  return (
    <NavLink
      to="/alarms"
      className="flex h-8 items-center gap-2 bg-[var(--color-danger)] px-4 text-[12px] font-semibold text-white hover:bg-[var(--color-danger-hover)]"
    >
      <DdIcon name="attention-circled" size={14} />
      {t('shell.criticalActive', { count: critical.length, what: latest.rule || latest.tag })}
      <span className="ml-auto font-normal text-white/75">{active.length} {t('alarms.active').toLowerCase()}</span>
    </NavLink>
  );
}

/** Nav leaf row — shared by the group flyout and the mobile drawer. */
function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to} onClick={onNavigate}
      className={({ isActive }) =>
        `mx-1 flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] ${
          isActive ? 'bg-blue font-semibold text-white' : 'text-nav-dim hover:bg-[#0953bf] hover:text-white'
        }`
      }
    >
      <DdIcon name={item.icon} size={14} /> {t(item.key)}
    </NavLink>
  );
}

/** Drawer group — same header as the rail row, items rendered inline-expanded
 *  (no flyout) so the overlay nav works on touch. */
function DrawerGroup({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = group.items.some((i) => i.to === '/' ? pathname === '/' : pathname.startsWith(i.to));
  return (
    <div>
      <div className={`flex h-[31px] items-center gap-2.5 px-2.5 text-[13px] leading-[13px] ${active ? 'text-white' : 'text-nav-dim'}`}>
        <DdIcon name={group.icon} size={15} />
        <span className="truncate font-semibold">{t(group.group)}</span>
      </div>
      {group.items.map((i) => (
        <NavItemLink key={i.to} item={i} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/** Flyout leaf — dd mega-menu item: text-only row, optional purple NEW badge */
function FlyoutItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to} onClick={onNavigate}
      className={({ isActive }) =>
        `flex h-8 items-center gap-1.5 rounded px-3 text-[13px] ${
          isActive ? 'bg-[#0953bf] font-semibold text-white' : 'text-white/75 hover:bg-[#0953bf] hover:text-white'
        }`
      }
    >
      {t(item.key)}
      {item.badge === 'new' && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-[#b372f0]">{t('nav.newBadge')}</span>
      )}
    </NavLink>
  );
}

/** One flyout section — bold title (optional NEW), left items + optional
 *  right secondary column, blue +action row in the left column. */
function FlyoutSection({ sec, onNavigate }: { sec: NavSection; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-1 pb-1">
      {sec.title && (
        <p className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[14px] font-bold text-white">
          {t(sec.title)}
          {sec.badge === 'new' && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#b372f0]">{t('nav.newBadge')}</span>
          )}
        </p>
      )}
      <div className="flex">
        <div className="min-w-0 flex-1">
          {sec.items.map((i) => <FlyoutItem key={i.to} item={i} onNavigate={onNavigate} />)}
          {sec.action && (
            <NavLink
              to={sec.action.to}
              onClick={onNavigate}
              className="mt-0.5 flex h-8 items-center gap-2 rounded bg-[#0d62c9] px-3 text-[13px] font-semibold text-white hover:bg-[#0953bf]"
            >
              <DdIcon name="plus" size={11} /> {t(sec.action.key)}
            </NavLink>
          )}
        </div>
        {sec.secondary && (
          <div className="w-36 shrink-0 border-l border-white/10 pl-1">
            {sec.secondary.map((i) => <FlyoutItem key={i.to} item={i} onNavigate={onNavigate} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* Sidebar row — icon + label; opens the dd mega-menu flyout on hover/focus.
 * Active when any child route matches. */
function SideRow({ group, openId, setOpenId }: {
  group: NavGroup; openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const open = openId === group.group;
  const active = group.items.some((i) => i.to === '/' ? pathname === '/' : pathname.startsWith(i.to));
  const sections = group.sections ?? [{ items: group.items, action: group.action }];
  const flat = !group.sections && group.items.length >= 4;
  /* the rail's overflow-y-auto clips absolutely-positioned children — the
     flyout must be position:fixed, anchored to this row's rect */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const open_ = (e: React.SyntheticEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: r.right, y: Math.min(r.top, window.innerHeight - 360) });
    setOpenId(group.group);
  };
  const close = () => setOpenId((id) => id === group.group ? null : id);
  return (
    <div className="relative" onMouseEnter={open_} onMouseLeave={close}>
      <button
        className={`flex min-h-[31px] w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] leading-[15px] transition-colors ${
          open || active ? 'bg-white/10 text-white' : 'text-nav-dim hover:bg-[#0953bf] hover:text-white'
        }`}
        aria-expanded={open}
        aria-haspopup="true"
        onFocus={open_}
        onClick={(e) => (open ? setOpenId(null) : open_(e))}
      >
        <DdIcon name={group.icon} size={15} />
        {/* wrap at word boundaries (max 2 lines) instead of ellipsis; tight
            tracking lets the longest single word ("Infrastructure") fit the 160px rail */}
        <span className="line-clamp-2 min-w-0 tracking-[-0.02em]">{t(group.group)}</span>
        {group.items.length > 1 && (
          <DdIcon name="caret-right" size={10} className={`ml-auto opacity-50 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        )}
      </button>
      {open && anchor && (
        /* pl-1 bridges the rail→panel gap so hover doesn't drop across it */
        <div className="fixed z-50 pl-1" style={{ left: anchor.x, top: anchor.y }}>
          <div className="flyout-in w-[360px] rounded-md border border-white/10 bg-topbar py-1.5 shadow-flyout">
            {flat ? (
              /* ≥4 flat items → two columns like dd's wide sections */
              <div className="grid grid-cols-2 gap-x-1 px-1">
                {group.items.map((i) => (
                  <FlyoutItem key={i.to} item={i} onNavigate={() => setOpenId(null)} />
                ))}
              </div>
            ) : (
              sections.map((sec, si) => (
                <FlyoutSection key={si} sec={sec} onNavigate={() => setOpenId(null)} />
              ))
            )}
            {!group.sections && group.action && (
              <div className="px-1 pt-0.5">
                <NavLink
                  to={group.action.to}
                  onClick={() => setOpenId(null)}
                  className="flex h-8 items-center gap-2 rounded bg-[#0d62c9] px-3 text-[13px] font-semibold text-white hover:bg-[#0953bf]"
                >
                  <DdIcon name="plus" size={11} /> {t(group.action.key)}
                </NavLink>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { t } = useTranslation();
  const showAdmin = useOperateAnyOrg();
  const [openId, setOpenId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const groups = NAV.filter((g) => !g.gated || showAdmin);

  // `?` opens the shortcut overlay (dd pattern); Esc closes overlays/drawer
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) setHelpOpen(true);
      if (e.key === 'Escape') { setHelpOpen(false); setNavOpen(false); setOpenId(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // focus the drawer on open; close it on route change (back/forward)
  useEffect(() => { if (navOpen) drawerRef.current?.focus(); }, [navOpen]);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  return (
    <div className="min-h-svh bg-paper text-ink">
      {/* sidebar — full height, expanded ~168px dark rail (measured layout:
          logo header inside the rail, icon+label rows, footer icons).
          Below md the rail hides and nav opens as a slide-over drawer. */}
      <nav className="fixed bottom-0 left-0 top-0 z-30 hidden w-40 flex-col bg-rail px-1.5 md:flex">
        <NavLink to="/" className="flex h-16 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 30, height: 30 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-bold tracking-tight">Plant Ops OS</span>
            <span className="text-[8px] uppercase tracking-wider text-white/40">{t('shell.product')}</span>
          </span>
        </NavLink>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2">
          {groups.map((g) => (
            <SideRow key={g.group} group={g} openId={openId} setOpenId={setOpenId} />
          ))}
        </div>
        {/* footer — invite / support / help with labels (dd bottom rail) */}
        <div className="flex items-stretch border-t border-white/10 px-1 py-1.5">
          <NavLink to="/admin/users" className="flex flex-1 flex-col items-center gap-0.5 rounded py-1 text-white/40 hover:bg-white/5 hover:text-white" aria-label={t('nav.adminUsers')}>
            <DdIcon name="users" size={15} />
            <span className="text-[9px] font-medium">{t('nav.invite')}</span>
          </NavLink>
          <NavLink to="/health" className="flex flex-1 flex-col items-center gap-0.5 rounded py-1 text-white/40 hover:bg-white/5 hover:text-white" aria-label={t('nav.health')}>
            <DdIcon name="books" size={15} />
            <span className="text-[9px] font-medium">{t('nav.support')}</span>
          </NavLink>
          <button className="flex flex-1 flex-col items-center gap-0.5 rounded py-1 text-white/40 hover:bg-white/5 hover:text-white" aria-label={t('shortcuts.title')} onClick={() => setHelpOpen(true)}>
            <DdIcon name="help" size={15} />
            <span className="text-[9px] font-medium">{t('nav.help')}</span>
          </button>
        </div>
      </nav>

      {/* mobile nav drawer — slide-over reusing the rail rows; items render
          inline-expanded (no flyout) so it works on touch */}
      <div
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity md:hidden ${navOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setNavOpen(false)}
        aria-hidden
      />
      <aside
        id="nav-drawer"
        ref={drawerRef}
        tabIndex={-1}
        inert={!navOpen}
        aria-label={t('shell.openMenu')}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-rail px-1.5 outline-none transition-transform duration-200 ease-out md:hidden ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-16 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 30, height: 30 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-bold tracking-tight">Plant Ops OS</span>
            <span className="text-[8px] uppercase tracking-wider text-white/40">{t('shell.product')}</span>
          </span>
          <button
            className="ml-auto grid h-7 w-7 place-items-center rounded text-white/60 hover:bg-white/10 hover:text-white"
            aria-label={t('common.close')}
            onClick={() => setNavOpen(false)}
          >
            <DdIcon name="cancel" size={15} />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2">
          {groups.map((g) => (
            <DrawerGroup key={g.group} group={g} onNavigate={() => setNavOpen(false)} />
          ))}
        </div>
      </aside>

      {/* top bar — 36px dark, starts after the sidebar (measured); hamburger
          replaces the rail below md */}
      <header className="fixed left-0 right-0 top-0 z-20 flex h-9 items-center gap-2 bg-topbar pl-3 pr-3 md:left-40">
        <button
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white md:hidden"
          aria-expanded={navOpen}
          aria-controls="nav-drawer"
          aria-label={t('shell.openMenu')}
          onClick={() => setNavOpen((o) => !o)}
        >
          <DdIcon name="indented-list" size={16} />
        </button>
        <button
          className="mx-auto hidden h-6 w-[600px] max-w-[45%] items-center gap-2 rounded bg-white/[0.08] px-2 text-[12px] text-white/80 shadow-dark-btn transition-colors hover:bg-white/[0.12] md:flex"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
        >
          <DdIcon name="search" size={13} /> {t('palette.open')}
          <kbd className="ml-auto hidden rounded border border-white/20 px-1 text-[10px] lg:inline">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <LivePill />
          <NotifyBell />
          <UserMenu />
        </div>
      </header>

      {/* content */}
      <div className="pt-9 md:pl-40">
        <AlarmBanner />
        <main className="min-h-[calc(100svh-36px-26px)]">
          <Outlet />
        </main>
        {/* footer bar — dd chrome pattern */}
        <footer className="flex h-[26px] items-center justify-center gap-3 border-t border-line text-[11px] text-ink-46">
          <span className="hidden sm:inline">Plant Ops OS</span>
          <NavLink to="/health" className="hover:text-ink">{t('nav.health')}</NavLink>
          <NavLink to="/admin/audit" className="hover:text-ink">{t('nav.adminAudit')}</NavLink>
        </footer>
      </div>
      <Palette />
      {helpOpen && <ShortcutOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
