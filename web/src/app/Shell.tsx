// Shell — Datadog-pattern chrome: expanded dark sidebar (icon + label rows),
// dark flyout per group, 44px topbar (search / live / bell / user), alarm
// banner under the bar. Nav model shared with the palette via ./nav.

import { OrgSwitcher } from '../features/orgs/OrgSwitcher';
import { ConsentBanner } from '../features/onboarding/ConsentBanner';
import { ShiftBadge } from '../features/production/ShiftBadge';
import { getScope } from '../lib/scope';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { NAV, type NavGroup, type NavItem, type NavSection } from './nav';
import { Palette } from './Palette';
import { signOut, useRole } from './session';
import { live } from '../lib/live';
import { useNow, useStore } from '../lib/hooks';
import { setLang } from '../lib/i18n';
import { Icon } from '../shared/ui/Icon';
import { DdIcon } from '../shared/ui/DdIcon';
import { useOperateAnyOrg } from '../features/admin/admin';
import { journalIcon, journalTone, markJournalRead, isUnread } from '../features/notify/journal';
import { useAlarms } from '../features/alarms/alarms';

/** `?` overlay — dd keyboard-shortcuts pattern */
function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ['Ctrl K', t('shortcuts.palette')],
    ['↑ ↓', t('shortcuts.nav')],
    ['Enter', t('shortcuts.select')],
    ['Esc', t('shortcuts.close')],
    ['?', t('shortcuts.help')],
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
    : ws === 'auth_expired' ? t('shell.sessionExpired')
    : ws === 'closed' ? t('shell.offline') : t('shell.reconnecting');
  return (
    /* .live-pill + data-ws: UAT hook and the tinted not-live styles (index.css) */
    <span
      className="live-pill flex h-6 shrink-0 items-center gap-1.5 rounded border border-rail-line bg-rail-hover px-2 text-[11px] font-semibold text-white/80"
      data-ws={ws} role="status" aria-live="polite"
    >
      <span className="livedot" data-ws={ws} aria-hidden />
      <span className="max-w-[9rem] truncate">{label}</span>
    </span>
  );
}

/** Plant clock (HH:MM) — operators log events against wall time all shift. */
function TopClock() {
  const { t, i18n } = useTranslation();
  const now = useNow(1000);
  const d = new Date(now);
  return (
    <time
      className="top-clock hidden font-mono text-[12px] font-semibold text-white/80 sm:block"
      dateTime={d.toISOString()} title={`${t('ui.clock')} ${d.toLocaleString(i18n.language)}`}
    >
      {d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false })}
    </time>
  );
}

/** Persistent critical count in the always-visible topbar — the banner
 *  below scrolls away; this doesn't (ISA-18.2: critical stays in view).
 *  Red only when abnormal, with ▲ shape + text. */
function CriticalChip() {
  const { t } = useTranslation();
  const { critical } = useAlarms();
  if (!critical.length) return null;
  return (
    <NavLink
      to="/alarms"
      className="flex h-6 shrink-0 items-center gap-1 rounded bg-[var(--color-danger-bright)] px-2 text-[11px] font-bold text-white hover:bg-[var(--color-danger)]"
      aria-label={t('shell.criticalActive', { count: critical.length, what: critical[0].rule || critical[0].tag })}
    >
      <span aria-hidden className="text-[9px]">▲</span>
      {t('ui.criticalChip', { count: critical.length })}
    </NavLink>
  );
}

/** Data-link strip — shown when the live feed has been down > 5 s, so
 *  values on screen can't be mistaken for live ones (honest status). */
function LinkStrip() {
  const { t } = useTranslation();
  const ws = useStore(() => live.ws);
  const rev = useStore(() => live.wsRev);
  // the strip appears once the *current* ws state has lasted 5 s — brief
  // blips and the first connect never flash it
  const [shownRev, setShownRev] = useState(-1);
  useEffect(() => {
    if (ws === 'open') return;
    const id = setTimeout(() => setShownRev(rev), 5000);
    return () => clearTimeout(id);
  }, [ws, rev]);
  if (ws === 'open' || shownRev !== rev) return null;
  const msg = ws === 'auth_expired' ? t('ui.linkExpired')
    : ws === 'closed' ? t('ui.linkOffline') : t('ui.linkReconnecting');
  return (
    <div className="link-strip" data-ws={ws} role="status">
      <span aria-hidden className="text-[10px]">{ws === 'closed' || ws === 'auth_expired' ? '▲' : '◆'}</span>
      {msg}
    </div>
  );
}

/** Close a popover on Escape (each popover owns its own layer). */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, close]);
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
  const closeBell = useCallback(() => setOpen(false), []);
  useEscape(open, closeBell);
  return (
    <div className="relative">
      <button
        className="relative grid h-6 w-6 place-items-center rounded text-white/70 hover:bg-blue hover:text-white"
        aria-label={t('shell.alarmsButton', { count: unread })}
        aria-expanded={open} aria-haspopup="true"
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
                    <span className={`mt-0.5 ${journalTone(ev) === 'critical' ? 'text-[var(--color-danger-bright)]' : journalTone(ev) === 'warning' ? 'text-[var(--color-warn)]' : 'text-ink-muted'}`}>
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
  const closeMenu = useCallback(() => setOpen(false), []);
  useEscape(open, closeMenu);
  return (
    <div className="relative">
      <button
        className="user-btn grid h-6 w-6 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${t('ui.userMenu')}: ${t('roles.' + role, { defaultValue: role })}`}
        aria-expanded={open} aria-haspopup="true"
      >
        <DdIcon name="user" size={16} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div className="absolute right-0 top-9 z-50 w-52 overflow-hidden rounded-md border border-line bg-white py-1 text-ink shadow-pop">
            <div className="border-b border-line px-3 py-2">
              <div className="overline">{t('roles.' + role, { defaultValue: role })}</div>
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
              /* setLang persists the choice and updates <html lang> (Thai
                 line-breaking + the :lang(th) type rules depend on it) */
              onClick={() => setLang(i18n.language === 'th' ? 'en' : 'th')}
            >
              <DdIcon name="globe" size={14} /> {t('shell.language')}: {i18n.language.toUpperCase()}
            </button>
            {/* sign-out is not abnormal — ink, not red (ISA-101 colour discipline) */}
            <button
              className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-[12.5px] hover:bg-subtle"
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
    <div role="alert">
      <NavLink
        to="/alarms"
        /* min-h + py: a long Thai rule name wraps on mobile instead of
           spilling out of a fixed 32px bar */
        className="flex min-h-8 items-center gap-2 bg-[var(--color-danger)] px-4 py-1 text-[12px] font-semibold leading-snug text-white hover:bg-[var(--color-danger-hover)]"
      >
        <DdIcon name="attention-circled" size={14} className="shrink-0" />
        <span className="min-w-0">{t('shell.criticalActive', { count: critical.length, what: latest.rule || latest.tag })}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-white/80">{active.length} {t('alarms.active').toLowerCase()}</span>
      </NavLink>
    </div>
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
          isActive ? 'bg-blue font-semibold text-white' : 'text-nav-dim hover:bg-nav-hover hover:text-white'
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
      <div className={`flex h-[31px] items-center gap-2.5 px-2.5 text-[13px] leading-tight ${active ? 'text-white' : 'text-nav-dim'}`}>
        <DdIcon name={group.icon} size={15} />
        <span className="truncate font-semibold">{t(group.group)}</span>
      </div>
      {group.items.map((i) => (
        <NavItemLink key={i.to} item={i} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/** Flyout leaf — dd mega-menu item. Rests dim; only the row under the pointer
 *  (or keyboard focus) brightens, gains a trailing arrow, and lights its own
 *  segment of the column guide line. */
function FlyoutItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to} onClick={onNavigate}
      className={({ isActive }) =>
        `group/item -ml-px flex h-[30px] items-center gap-1.5 border-l pl-3.5 pr-2 text-[14px] outline-none motion-safe:transition-colors motion-safe:duration-150 ${
          isActive
            ? 'border-white font-semibold text-white'
            : 'border-transparent text-white/70 hover:border-white hover:bg-white/[0.06] hover:text-nav-flyout-hi focus-visible:border-white focus-visible:bg-white/[0.06] focus-visible:text-nav-flyout-hi'
        }`
      }
    >
      <span className="truncate">{t(item.key)}</span>
      {item.badge === 'new' && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-nav-badge">{t('nav.newBadge')}</span>
      )}
      <DdIcon
        name="arrow-right" size={11} aria-hidden
        className="shrink-0 opacity-0 motion-safe:-translate-x-1 motion-safe:transition-[opacity,transform] motion-safe:duration-150 group-hover/item:translate-x-0 group-hover/item:opacity-100 group-focus-visible/item:translate-x-0 group-focus-visible/item:opacity-100"
      />
    </NavLink>
  );
}

/** "+ New …" row — a blue plus sits on the column guide line, like dd. */
function FlyoutAction({ action, onNavigate }: { action: { to: string; key: string }; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <Link
      to={action.to} onClick={onNavigate}
      className="group/act relative -ml-px flex h-[30px] items-center border-l border-transparent pl-3.5 pr-2 text-[14px] text-white/70 outline-none motion-safe:transition-colors hover:bg-white/[0.06] hover:text-nav-flyout-hi focus-visible:bg-white/[0.06] focus-visible:text-nav-flyout-hi"
    >
      <DdIcon name="plus" size={11} aria-hidden className="absolute -left-[6px] top-1/2 -translate-y-1/2 bg-flyout py-px text-[#1e90ff]" />
      <span className="truncate">{t(action.key)}</span>
    </Link>
  );
}

/** A column of flyout items hanging off a faint vertical guide line; the line
 *  firms up while the pointer is anywhere in the column. */
function FlyoutColumn({ items, onNavigate, className = '', action }: { items: NavItem[]; onNavigate: () => void; className?: string; action?: { to: string; key: string } }) {
  return (
    <div className={`group/col min-w-0 border-l border-white/15 motion-safe:transition-colors motion-safe:duration-200 hover:border-white/40 focus-within:border-white/40 ${className}`}>
      {items.map((i) => <FlyoutItem key={i.to} item={i} onNavigate={onNavigate} />)}
      {action && <FlyoutAction action={action} onNavigate={onNavigate} />}
    </div>
  );
}

/** One flyout section — optional sub-title (NEW badge), left items + optional
 *  right secondary column. the "+ New …" action is the last row of the left column. */
function FlyoutSection({ sec, onNavigate }: { sec: NavSection; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 pb-2">
      {sec.title && (
        <p className="flex items-center gap-1.5 pb-1.5 pt-2 text-[13px] font-semibold text-white/90">
          {t(sec.title)}
          {sec.badge === 'new' && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-nav-badge">{t('nav.newBadge')}</span>
          )}
        </p>
      )}
      <div className="flex gap-5">
        <FlyoutColumn items={sec.items} onNavigate={onNavigate} className="flex-1" action={sec.action} />
        {sec.secondary && sec.secondary.length > 0 && (
          <FlyoutColumn items={sec.secondary} onNavigate={onNavigate} className="w-40 shrink-0" />
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
    const rail = e.currentTarget.closest('nav')?.getBoundingClientRect();
    setAnchor({ x: rail ? rail.right : r.right, y: r.top });
    /* y = row top, so the panel's top edge lines up with the highlighted row;
       the layout effect below clamps it by the panel's *measured* height */
    setOpenId(group.group);
  };
  const close = () => setOpenId((id) => id === group.group ? null : id);
  const panelRef = useRef<HTMLDivElement>(null);
  /* near the bottom, shift up just enough to fit — never detach from the row
     (a fixed 440px guess left short panels floating far above their row) */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !anchor || !el) return;
    const top = Math.max(8, Math.min(anchor.y, window.innerHeight - el.offsetHeight - 8));
    el.style.top = `${top}px`;
  }, [open, anchor]);
  return (
    <div className="relative" onMouseEnter={open_} onMouseLeave={close}>
      <button
        className={`flex min-h-[31px] w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] leading-[15px] transition-colors ${
          open ? 'relative z-[51] bg-flyout text-white' : active ? 'bg-white/10 text-white' :'text-nav-dim hover:bg-nav-hover hover:text-white'
        } ${active ? 'font-semibold shadow-[inset_3px_0_0_var(--color-blue-nav)]' : ''}`}
        /* inset bar marks the group of the current page — "where am I" at a glance */
        aria-current={active ? 'true' : undefined}
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
        /* flush against the row (no gap) and the same colour as the open row,
           so row + panel read as one connected tab */
        <div ref={panelRef} className="fixed z-50" style={{ left: anchor.x, top: anchor.y }}>
          <div className="flyout-in w-[400px] rounded-r-md border border-l-0 border-white/10 bg-flyout pb-2 shadow-flyout">
            {/* group title — larger than the rail label so the panel reads as its own surface */}
            {/* the title is the group's own landing page: lights blue with an arrow on hover/focus (dd "Monitors →") */}
            <div className="px-2 pt-2">
              <NavLink
                to={group.href ?? group.items[0]?.to ?? '/'} onClick={() => setOpenId(null)}
                className="group/title flex h-9 items-center gap-2 rounded px-2 text-[17px] font-bold leading-6 text-white outline-none motion-safe:transition-colors hover:bg-nav-action focus-visible:bg-nav-action"
              >
                {t(group.group)}
                <DdIcon name="arrow-right" size={15} className="opacity-0 motion-safe:transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
              </NavLink>
            </div>
            {flat ? (
              /* ≥4 flat items → two guide-lined columns like dd's wide sections */
              <div className="flex gap-5 px-4 pb-1 pt-1">
                <FlyoutColumn items={group.items.slice(0, Math.ceil(group.items.length / 2))} onNavigate={() => setOpenId(null)} className="flex-1" />
                <FlyoutColumn items={group.items.slice(Math.ceil(group.items.length / 2))} onNavigate={() => setOpenId(null)} className="flex-1" />
              </div>
            ) : (
              sections.map((sec, si) => (
                <FlyoutSection key={si} sec={sec} onNavigate={() => setOpenId(null)} />
              ))
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
    /* .app-shell scopes the reduced-motion override; .chrome marks dark
       surfaces so focus rings switch to the light variant (index.css) */
    <div className="app-shell min-h-svh bg-paper text-ink">
      <a href="#main" className="skip-link">{t('ui.skipToContent')}</a>
      {/* sidebar — full height, expanded ~168px dark rail (measured layout:
          logo header inside the rail, icon+label rows, footer icons).
          Below md the rail hides and nav opens as a slide-over drawer. */}
      <nav className="side-nav chrome fixed bottom-0 left-0 top-0 z-30 hidden w-40 flex-col bg-rail pl-1.5 md:flex" aria-label={t('ui.mainNav')}>
        <NavLink to="/" className="flex h-16 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 30, height: 30 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-bold tracking-tight">vissointan</span>
            <span className="text-[8px] uppercase tracking-wider text-white/40">{t('shell.product')}</span>
          </span>
        </NavLink>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2">
          {groups.map((g, i) => (
            <Fragment key={g.group}>
              {i > 0 && groups[i - 1].cluster !== g.cluster && <hr className="mx-2.5 my-1.5 border-0 border-t border-white/15" aria-hidden />}
              <SideRow group={g} openId={openId} setOpenId={setOpenId} />
            </Fragment>
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
        className={`chrome fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-rail px-1.5 outline-none transition-transform duration-200 ease-out md:hidden ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-16 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 30, height: 30 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-bold tracking-tight">vissointan</span>
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
          {groups.map((g, i) => (
            <Fragment key={g.group}>
              {i > 0 && groups[i - 1].cluster !== g.cluster && <hr className="mx-2.5 my-1.5 border-0 border-t border-white/15" aria-hidden />}
              <DrawerGroup group={g} onNavigate={() => setNavOpen(false)} />
            </Fragment>
          ))}
        </div>
      </aside>

      {/* top bar — 36px dark, starts after the sidebar (measured); hamburger
          replaces the rail below md */}
      <header className="topbar chrome fixed left-0 right-0 top-0 z-20 flex h-9 items-center gap-2 bg-topbar pl-3 pr-3 md:left-40">
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
        <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
          <OrgSwitcher />
          <ShiftBadge orgId={getScope()?.orgId ?? null} siteId={getScope()?.siteId ?? null} />
          <CriticalChip />
          <TopClock />
          <LivePill />
          {/* the search pill is hidden below md — keep the palette reachable on touch */}
          <button
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white md:hidden"
            aria-label={t('ui.search')}
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          >
            <DdIcon name="search" size={15} />
          </button>
          <NotifyBell />
          <UserMenu />
        </div>
      </header>

      {/* content */}
      <div className="pt-9 md:pl-40">
        <LinkStrip />
        <AlarmBanner />
        <main id="main" tabIndex={-1} className="min-h-[calc(100svh-36px-26px)] outline-none">
          <ConsentBanner />
          <Outlet />
        </main>
        {/* footer bar — dd chrome pattern */}
        <footer className="flex h-[26px] items-center justify-center gap-3 border-t border-line text-[11px] text-ink-46">
          <span className="hidden sm:inline">vissointan</span>
          <NavLink to="/health" className="hover:text-ink">{t('nav.health')}</NavLink>
          <NavLink to="/admin/audit" className="hover:text-ink">{t('nav.adminAudit')}</NavLink>
        </footer>
      </div>
      <Palette />
      {helpOpen && <ShortcutOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
