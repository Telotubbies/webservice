// Shell — the app chrome: a dark sidebar (200 px, collapsible to 56 px icons),
// a flyout per group, a 40 px topbar (scope / search / alarm summary / live /
// theme / bell / user), and an alarm banner under the bar. The nav model is shared with the palette via ./nav.

import { ScopePicker } from './ScopePicker';
import { ConsentBanner } from '../features/onboarding/ConsentBanner';
import { StartHere } from '../features/onboarding/StartHere';
import { OPEN_EVENT as START_OPEN } from '../features/onboarding/start';
import { ShiftBadge } from '../features/production/ShiftBadge';
import { getScope } from '../lib/scope';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import '../features/guide/i18n';
import { InstallHint, MobileNav, OfflineBanner } from '../features/mobile/MobileChrome';
import { loadOrgPolicy } from '../lib/policy';
import { CLUSTER_LABEL, NAV, activeGroup, type NavGroup, type NavItem, type NavSection } from './nav';
import { enabled } from '../lib/features';
import { normSeverity } from '../shared/ui/Status';
import { Palette } from './Palette';
import { Toaster } from '../ui/Toaster';
import { Drawer } from '../ui/Drawer';
import { Menu } from '../ui/Popover';
import { AlarmCard } from '../features/alarms/AlarmRow';
import { summarizeAlarms } from './alarmSummary';
import { applyTheme, readThemePref, writeThemePref, type ThemePref } from '../theme/theme';
import { readMotionPref, setMotionPref } from '../theme/motion';
import { signOut, useRole } from './session';
import { live } from '../lib/live';
import { reconnectWS } from '../lib/ws';
import { useNow, useStore } from '../lib/hooks';
import { setLang } from '../lib/i18n';
import { Icon } from '../shared/ui/Icon';
import { DdIcon } from '../shared/ui/DdIcon';
import { useAdminOrg, useOperateAnyOrg } from '../features/admin/admin';
import { journalIcon, journalTone, markJournalRead, isUnread } from '../features/notify/journal';
import { useAlarms } from '../features/alarms/alarms';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Closes a popover on Escape (each popover owns its own layer). */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, close]);
}

// ── Overlays ─────────────────────────────────────────────────────────────────

/** `?` overlay — the keyboard-shortcuts help panel. */
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
      <div className="w-[380px] rounded-panel bg-paper p-4 shadow-flyout" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-[15px] font-semibold">{t('shortcuts.title')}</h2>
        <dl className="space-y-2">
          {rows.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-[13px]">
              <dt className="text-ink-68">{d}</dt>
              <dd><kbd className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold">{k}</kbd></dd>
            </div>
          ))}
        </dl>
        <NavLink to="/guide" onClick={onClose} className="mt-4 inline-flex items-center gap-1 text-[13px] text-blue hover:underline focus-visible:outline-2 focus-visible:outline-blue">
          {t('manual.open')} <span aria-hidden>→</span>
        </NavLink>
      </div>
    </div>
  );
}

// ── Topbar pieces ────────────────────────────────────────────────────────────

function LivePill() {
  const { t } = useTranslation();
  const ws = useStore(() => live.ws);
  const label = ws === 'open' ? t('shell.live')
    : ws === 'auth_expired' ? t('shell.sessionExpired')
    : ws === 'closed' ? t('shell.offline') : t('shell.reconnecting');
  return (
    /* .live-pill + data-ws are the UAT hook and drive the tinted not-live styles (index.css). */
    <span
      className="live-pill flex h-6 shrink-0 items-center gap-1.5 rounded border border-rail-line bg-rail-hover px-2 text-[11px] font-semibold text-white/80"
      data-ws={ws} role="status" aria-live="polite" aria-label={label} title={label}
    >
      <span className="livedot" data-ws={ws} aria-hidden />
      {/* phones keep the tinted dot; the word needs ≥sm room */}
      <span className="hidden max-w-[9rem] truncate sm:inline">{label}</span>
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

/** Always-visible alarm summary (ISA-18.2): ▲ critical and ◆ warning counts
 *  over alarms that still need someone (summarizeAlarms: cleared and shelved
 *  are out). A priority keeps its solid fill while any of its alarms is
 *  unacknowledged — critical also blinks at 1 Hz until acked (ISA-101 M2;
 *  reduced motion makes it steady). Opens a drawer of the open alarms. */
function AlarmSummaryChip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = useNow(5000);
  const { open } = useAlarms();
  const [drawer, setDrawer] = useState(false);
  const live_ = open.filter((a) => !a.shelved_until || Date.parse(a.shelved_until) <= now);
  const sum = summarizeAlarms(open, now);
  const critUnacked = live_.some((a) => a.state === 'active' && normSeverity(a.severity) === 'critical');
  const warnUnacked = live_.some((a) => a.state === 'active' && normSeverity(a.severity) === 'warning');
  if (!sum.critical && !sum.warning && !drawer) return null;
  const seg = 'flex h-full items-center gap-1 px-2 tabular-nums';
  return (
    <>
      <button
        type="button" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)}
        className="alarm-chip flex h-9 shrink-0 md:h-6 items-stretch overflow-hidden rounded text-[11px] font-bold ring-1 ring-white/15 hover:ring-white/40"
        aria-label={t('shell.alarmSummary', { crit: sum.critical, warn: sum.warning })}
      >
        {sum.critical > 0 && (
          <span data-motion-data={critUnacked || undefined}
            className={`${seg} ${critUnacked ? 'chip-blink bg-[var(--color-danger-bright)] text-white' : 'text-crit-on-dark'}`}>
            <span aria-hidden className="text-[9px]">▲</span>{sum.critical}
          </span>
        )}
        {sum.warning > 0 && (
          <span className={`${seg} ${warnUnacked ? 'bg-[var(--color-warn)] text-[var(--color-sev-ink)]' : 'text-warn-on-dark'}`}>
            <span aria-hidden className="text-[9px]">◆</span>{sum.warning}
          </span>
        )}
      </button>
      <Drawer
        open={drawer} onClose={() => setDrawer(false)} title={t('shell.alarmDrawer')}
        footer={<button type="button" className="btn btn-sm" onClick={() => { setDrawer(false); navigate('/alarms'); }}>{t('shell.alarmConsole')}</button>}
      >
        {live_.length === 0 ? (
          <p className="p-4 text-[13px] text-ink-3">{t('shell.alarmsNone')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {live_.map((a) => (
              <li key={a.id}><AlarmCard alarm={a} now={now} onOpen={() => { setDrawer(false); navigate(`/alarms/${a.id}`); }} /></li>
            ))}
          </ul>
        )}
      </Drawer>
    </>
  );
}

/** Theme: light / dark / match system — one switch for the whole console. */
function ThemeMenu() {
  const { t } = useTranslation();
  const [pref, setPref] = useState<ThemePref>(() => readThemePref());
  const [calm, setCalm] = useState(() => readMotionPref() === 'calm');
  // "Match system" keeps following the OS while it is the choice.
  useEffect(() => {
    if (pref !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [pref]);
  const choose = (p: ThemePref) => { writeThemePref(p); applyTheme(p); setPref(p); };
  const icon = pref === 'light' ? 'sun' : pref === 'dark' ? 'moon' : 'theme-system';
  return (
    <Menu.Root>
      <Menu.Trigger className={TOP_BTN} aria-label={`${t('shell.theme')}: ${t(`shell.theme${pref === 'system' ? 'System' : pref === 'dark' ? 'Dark' : 'Light'}`)}`}>
        <DdIcon name={icon} size={15} />
      </Menu.Trigger>
      <Menu.List label={t('shell.theme')}>
        <Menu.Item checked={pref === 'light'} onSelect={() => choose('light')}>{t('shell.themeLight')}</Menu.Item>
        <Menu.Item checked={pref === 'dark'} onSelect={() => choose('dark')}>{t('shell.themeDark')}</Menu.Item>
        <Menu.Item checked={pref === 'system'} onSelect={() => choose('system')}>{t('shell.themeSystem')}</Menu.Item>
        <Menu.Item checked={calm} onSelect={() => { const next = !calm; setCalm(next); setMotionPref(next ? 'calm' : 'full'); }}>{t('shell.motionCalm')}</Menu.Item>
      </Menu.List>
    </Menu.Root>
  );
}

/** Data-link strip — shown when the live feed has been down > 5 s, so
 *  values on screen can't be mistaken for live ones. */
function LinkStrip() {
  const { t } = useTranslation();
  const ws = useStore(() => live.ws);
  const rev = useStore(() => live.wsRev);
  // The strip appears once the *current* ws state has lasted 5 s — brief
  // blips and the first connect never flash it.
  const [shownRev, setShownRev] = useState(-1);
  useEffect(() => {
    if (ws === 'open') return;
    const id = setTimeout(() => setShownRev(rev), 5000);
    return () => clearTimeout(id);
  }, [ws, rev]);
  if (ws === 'open' || shownRev !== rev) return null;
  const msg = ws === 'auth_expired' ? t('ui.linkExpired')
    : ws === 'forbidden' ? t('ui.linkForbidden')
    : ws === 'closed' ? t('ui.linkOffline') : t('ui.linkReconnecting');
  return (
    <div className="link-strip" data-ws={ws} role="status">
      <span aria-hidden className="text-[10px]">{ws === 'closed' || ws === 'auth_expired' || ws === 'forbidden' ? '▲' : '◌'}</span>
      {msg}
      {ws === 'forbidden' && (
        <button type="button" className="ml-2 underline" onClick={() => reconnectWS()}>{t('common.retry')}</button>
      )}
    </div>
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
  const closeBell = useCallback(() => setOpen(false), []);
  useEscape(open, closeBell);
  return (
    <div className="relative">
      {/* Hover lifts like every other topbar control — the blue accent is
          kept for the unread badge, not a hover flood. */}
      <button
        className={`relative ${TOP_BTN}`}
        aria-label={`${t('nav.activity')} (${unread})`}
        aria-expanded={open} aria-haspopup="dialog"
        onClick={() => { setOpen((o) => !o); if (!open) setReadAt(markJournalRead(live.journal)); }}
      >
        <DdIcon name="bell" size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-blue px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-10 z-50 w-[340px] overflow-hidden rounded-md border border-line bg-paper text-ink shadow-pop">
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
      {/* The hit area is the full TOP_BTN box; the 24px avatar disc sits inside it. */}
      <button
        className="user-btn group/user grid h-10 w-10 shrink-0 place-items-center rounded md:h-7 md:w-7"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${t('ui.userMenu')}: ${t('roles.' + role, { defaultValue: role })}`}
        aria-expanded={open} aria-haspopup="dialog"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-white/80 group-hover/user:bg-white/15">
          <DdIcon name="user" size={16} />
        </span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-md border border-line bg-paper py-1 text-ink shadow-pop">
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
              onClick={() => { setOpen(false); window.dispatchEvent(new Event(START_OPEN)); }}
            >
              <DdIcon name="signpost" size={14} /> {t('start.menuItem')}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-subtle"
              /* setLang persists the choice and updates <html lang> — Thai
                 line-breaking and the :lang(th) type rules depend on it. */
              onClick={() => setLang(i18n.language === 'th' ? 'en' : 'th')}
            >
              <DdIcon name="globe" size={14} /> {t('shell.language')}: {i18n.language.toUpperCase()}
            </button>
            {/* Sign-out is not an abnormal action — ink, not red (ISA-101 colour discipline). */}
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

// ── Alarm banner ─────────────────────────────────────────────────────────────

/** Critical alarm line under the topbar. Solid red only while a critical
 *  alarm is still unacknowledged (ISA-18.2: unacked is the state that needs
 *  a person); once every critical is acked it steps down to a tinted strip,
 *  so a known, handled alarm stops shouting over the whole console. */
function AlarmBanner() {
  const { t } = useTranslation();
  const { critical, active } = useAlarms();
  if (!critical.length) return null;
  const unacked = critical.filter((a) => a.state === 'active');
  const latest = unacked[0] ?? critical[0];
  return (
    <div role="alert">
      <NavLink
        to="/alarms"
        data-unacked={unacked.length > 0}
        /* min-h + py let a long Thai rule name wrap on mobile instead of
           spilling out of a fixed 32px bar. */
        className={`alarm-banner flex min-h-8 items-center gap-2 px-4 py-1 text-[12px] font-semibold leading-snug ${
          unacked.length
            ? 'bg-[var(--color-danger-bright)] text-white hover:bg-[var(--color-danger)]'
            : 'border-b border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-danger-soft text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,white)]'
        }`}
      >
        <span aria-hidden className="shrink-0 text-[10px]">▲</span>
        <span className="min-w-0">{t('shell.criticalActive', { count: critical.length, what: latest.rule || latest.tag })}</span>
        <span className={`ml-auto shrink-0 whitespace-nowrap font-normal ${unacked.length ? 'text-white/85' : 'text-[var(--color-danger)]'}`}>
          {active.length} {t('alarms.active').toLowerCase()}
        </span>
      </NavLink>
    </div>
  );
}

// ── Nav pieces ───────────────────────────────────────────────────────────────

/** Nav leaf row — shared by the group flyout and the mobile drawer. */
function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to} onClick={onNavigate}
      className={({ isActive }) =>
        `mx-1 flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] ${
          isActive ? 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_var(--color-blue-nav)]' : 'text-nav-dim hover:bg-nav-hover hover:text-white'
        }`
      }
    >
      <DdIcon name={item.icon} size={14} /> {t(item.key)}
    </NavLink>
  );
}

/** Drawer group — same header as the rail row; items render inline-expanded
 *  (no flyout) so the overlay nav works on touch. */
function DrawerGroup({ group, active, onNavigate }: { group: NavGroup; active: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className={`flex h-[31px] items-center gap-2.5 px-2.5 text-[13px] leading-tight ${active ? 'text-white' : 'text-nav-dim'}`}>
        <DdIcon name={group.icon} size={15} />
        <span className="rail-label truncate font-semibold">{t(group.group)}</span>
      </div>
      {group.items.map((i) => (
        <NavItemLink key={i.to} item={i} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

// ── Flyout ───────────────────────────────────────────────────────────────────

/** Flyout leaf — a mega-menu item. It rests dim; only the row under the
 *  pointer (or keyboard focus) brightens, gains a trailing arrow, and lights
 *  its own segment of the column guide line. */
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

/** "+ New …" row — a blue plus sits on the column guide line. */
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

// ── Rail row ─────────────────────────────────────────────────────────────────

const RAIL_ROW = 'flex min-h-[31px] w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] leading-[15px] transition-colors';
const RAIL_ACTIVE = 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_var(--color-blue-nav)]';
const RAIL_IDLE = 'text-nav-dim hover:bg-nav-hover hover:text-white';
const HOVER_MS = 120;
const FOOT_LINK = 'flex flex-1 flex-col items-center gap-0.5 rounded py-1 text-white/55 hover:bg-white/5 hover:text-white';
/* Topbar icon buttons: 40×40 below md (the bar's full height, so a thumb
   has a real target), 28×28 on desktop where a pointer is precise. */
const TOP_BTN = 'grid h-10 w-10 shrink-0 place-items-center rounded text-white/70 hover:bg-white/10 hover:text-white md:h-7 md:w-7';

/** ↑ / ↓ move focus between rail rows (Home / End jump to the ends); Tab
 *  still walks them in order. */
function railArrows(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-rail-row]')];
  const i = rows.indexOf(e.target as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
    : (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
  rows[next].focus();
}

/* Sidebar row — icon + label; opens the group's flyout on hover/focus.
 * A one-page group is a plain link: a flyout holding a single item is a
 * detour. `active` = this group owns the current route (see activeGroup). */
function SideRow({ group, active, openId, setOpenId }: {
  group: NavGroup; active: boolean; openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { t, i18n } = useTranslation();
  const open = openId === group.group;
  const sections = group.sections ?? [{ items: group.items, action: group.action }];
  const flat = !group.sections && group.items.length >= 4;
  /* The rail's overflow-y-auto clips absolutely positioned children, so the
     flyout must be position:fixed, anchored to this row's rect. */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const place = (el: Element) => {
    const r = el.getBoundingClientRect();
    const rail = el.closest('nav')?.getBoundingClientRect();
    setAnchor({ x: rail ? rail.right : r.right, y: r.top });
    /* anchor.y is the row's top, so the panel's top edge lines up with the
       highlighted row; the layout effect below clamps it by the panel's
       *measured* height. */
    setOpenId(group.group);
  };
  const close = () => setOpenId((id) => id === group.group ? null : id);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  /* Hover intent: open and close both wait HOVER_MS, so a diagonal move from
     a row toward a low item in its panel can cross the next rows without
     swapping the flyout (re-entering this row or its panel cancels the close). */
  const timer = useRef<number | undefined>(undefined);
  const clearTimer = () => { window.clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => clearTimer, []);
  const onEnter = (e: React.MouseEvent) => {
    clearTimer();
    if (open) return;
    const el = e.currentTarget;
    timer.current = window.setTimeout(() => place(el), HOVER_MS);
  };
  const onLeave = () => {
    clearTimer();
    if (open) timer.current = window.setTimeout(close, HOVER_MS);
  };
  /* Keyboard: the flyout never opens on focus (that put every flyout link in
     the Tab order). Enter / Space / → open it and move focus to its first
     link; Esc or ← closes it and hands focus back to the row; tabbing out of
     the panel closes it. */
  const focusFirst = useRef(false);
  const focusPanel = () => panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
  useEffect(() => {
    if (open && focusFirst.current) { focusFirst.current = false; focusPanel(); }
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && open)) {
      if (!open) return;
      e.preventDefault(); e.stopPropagation();
      close(); btnRef.current?.focus();
    } else if (e.target === btnRef.current && e.key === 'ArrowRight') {
      e.preventDefault();
      if (open) focusPanel(); else { focusFirst.current = true; place(e.currentTarget); }
    }
  };
  /* Enter / Space arrive as a click with detail 0 — keyboard-opened panels
     take focus, pointer-opened ones leave it where it is. */
  const onClick = (e: React.MouseEvent) => {
    clearTimer();
    if (open) { setOpenId(null); return; }
    focusFirst.current = e.detail === 0;
    place(e.currentTarget);
  };
  const onBlur = (e: React.FocusEvent) => {
    if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };
  /* Near the bottom edge, the panel shifts up just enough to fit — it never
     detaches from the row (a fixed-height guess once left short panels
     floating far above their row). */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !anchor || !el) return;
    const top = Math.max(8, Math.min(anchor.y, window.innerHeight - el.offsetHeight - 8));
    el.style.top = `${top}px`;
  }, [open, anchor]);
  if (group.items.length === 1) {
    const only = group.items[0];
    return (
      <NavLink to={only.to} end={only.to === '/'} data-rail-row title={t(group.group)} className={`${RAIL_ROW} ${active ? RAIL_ACTIVE : RAIL_IDLE}`} aria-current={active ? 'page' : undefined}>
        <DdIcon name={group.icon} size={15} />
        <span className="rail-label rail-text line-clamp-2 min-w-0 tracking-[-0.02em]">{t(group.group)}</span>
      </NavLink>
    );
  }
  return (
    <div className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={btnRef}
        data-rail-row
        className={`${RAIL_ROW} ${open ? `relative z-[51] bg-flyout text-white${active ? ' font-semibold shadow-[inset_3px_0_0_var(--color-blue-nav)]' : ''}` : active ? RAIL_ACTIVE : RAIL_IDLE}`}
        /* The inset bar marks the group of the current page — "where am I" at a glance. */
        aria-current={active ? 'true' : undefined}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={onClick}
      >
        <DdIcon name={group.icon} size={15} />
        {/* Wrap at word boundaries (max 2 lines) instead of ellipsis; the
            tight tracking lets the longest single word ("Infrastructure")
            fit the 160px rail. */}
        <span className="rail-label rail-text line-clamp-2 min-w-0 tracking-[-0.02em]">{t(group.group)}</span>
        {group.items.length > 1 && (
          <DdIcon name="caret-right" size={10} className={`rail-hide ml-auto opacity-50 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        )}
      </button>
      {open && anchor && (
        /* Flush against the row (no gap) and the same colour as the open row,
           so row + panel read as one connected tab. */
        <div ref={panelRef} className="fixed z-50" style={{ left: anchor.x, top: anchor.y }}>
          <div className="flyout-in w-[400px] rounded-r-md border border-l-0 border-white/10 bg-flyout pb-2 shadow-flyout">
            {/* The group title is larger than the rail label so the panel
                reads as its own surface. */}
            {/* The title links to the group's own landing page: it lights up
                with an arrow on hover/focus. */}
            <div className="px-2 pt-2">
              <NavLink
                to={group.href ?? group.items[0]?.to ?? '/'} onClick={() => setOpenId(null)}
                className="group/title flex h-9 items-center gap-2 rounded px-2 text-[17px] font-bold leading-6 text-white outline-none motion-safe:transition-colors hover:bg-nav-action focus-visible:bg-nav-action"
              >
                {t(group.group)}
                <DdIcon name="arrow-right" size={15} className="opacity-0 motion-safe:transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
              </NavLink>
              {/* What the group is for, in one line — new users meet
                  "Connectivity" or "Platform tools" without a manual. */}
              {i18n.exists(`navDesc.${group.group.replace(/^nav\./, '')}`) && (
                <p className="mt-1 px-2 pb-1 text-[12px] leading-4 text-white/65">{t(`navDesc.${group.group.replace(/^nav\./, '')}`)}</p>
              )}
            </div>
            {flat ? (
              /* Groups with ≥4 flat items split into two guide-lined columns. */
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

// ── Shell ────────────────────────────────────────────────────────────────────

export function Shell() {
  const { t } = useTranslation();
  const showAdmin = useOperateAnyOrg();
  const [openId, setOpenId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  // Rail: 200 px with labels, or 56 px icons — remembered per browser.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wds.rail') === 'collapsed'; } catch { return false; } });
  const toggleRail = () => setCollapsed((c) => {
    try { localStorage.setItem('wds.rail', c ? 'expanded' : 'collapsed'); } catch { /* session-only */ }
    return !c;
  });
  const { pathname } = useLocation();
  const groups = NAV.filter((g) => !g.gated || showAdmin);
  const current = activeGroup(pathname, groups);
  const { orgId } = useAdminOrg();
  useEffect(() => { if (orgId) void loadOrgPolicy(orgId); }, [orgId]);

  // `?` opens the shortcut overlay; Esc closes overlays and the drawer.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) setHelpOpen(true);
      if (e.key === 'Escape') { setHelpOpen(false); setNavOpen(false); setOpenId(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Focus the drawer on open; close it on route change (back/forward).
  // On close, focus goes back to the More tab instead of falling to <body>.
  // Layout effect: it must run before the browser's focus fixup blurs the
  // now-inert drawer.
  useLayoutEffect(() => {
    if (navOpen) drawerRef.current?.focus();
    else if (drawerRef.current?.contains(document.activeElement)) {
      document.querySelector<HTMLElement>('button[aria-controls="nav-drawer"]')?.focus();
    }
  }, [navOpen]);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  return (
    /* .app-shell scopes the reduced-motion override; .chrome marks dark
       surfaces so focus rings switch to the light variant (index.css). */
    <div className="app-shell min-h-svh bg-ground text-ink" style={{ '--rail-w': collapsed ? '56px' : '200px' } as React.CSSProperties}>
      <a href="#main" className="skip-link">{t('ui.skipToContent')}</a>
      {/* Sidebar — a full-height dark rail (200 px, or 56 px icons when
          collapsed): wordmark, Plant / Engineering clusters with labels,
          Platform and Admin below a rule, footer shortcuts. Below md it
          becomes a slide-over drawer. */}
      <nav data-collapsed={collapsed} className="side-nav chrome fixed bottom-0 left-0 top-0 z-30 hidden w-[var(--rail-w)] flex-col bg-rail pl-1.5 transition-[width] duration-200 md:flex" aria-label={t('ui.mainNav')}>
        <NavLink to="/" className="flex h-14 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 28, height: 28 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          <span className="rail-hide flex flex-col gap-0.5 leading-none">
            <span className="text-[13px] font-bold tracking-tight">vissointan</span>
            <span className="overline !text-[10px] !text-white/55">{t('shell.product')}</span>
          </span>
        </NavLink>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto pb-2" onKeyDown={railArrows}>
          {groups.map((g, i) => {
            const starts = i === 0 || groups[i - 1].cluster !== g.cluster;
            const label = CLUSTER_LABEL[g.cluster];
            return (
              <Fragment key={g.group}>
                {starts && (label
                  ? <p className="rail-cluster overline px-2.5 pb-1 pt-3 !text-white/55" aria-hidden>{t(label)}</p>
                  : <hr className="mx-2.5 my-2 border-0 border-t border-white/12" aria-hidden />)}
                <SideRow group={g} active={current === g.group} openId={openId} setOpenId={setOpenId} />
              </Fragment>
            );
          })}
        </div>
        <button type="button" data-rail-btn onClick={toggleRail} aria-pressed={collapsed}
          className="mx-1 mb-1 flex h-8 items-center gap-2 rounded px-2 text-[12px] text-white/65 hover:bg-white/5 hover:text-white"
          aria-label={collapsed ? t('shell.railExpand') : t('shell.railCollapse')} title={collapsed ? t('shell.railExpand') : t('shell.railCollapse')}>
          <DdIcon name={collapsed ? 'rail-expand' : 'rail-collapse'} size={15} aria-hidden />
          <span className="rail-text">{t('shell.railCollapse')}</span>
        </button>
        <StartHere />
        {/* Footer — invite / health / help. The visible word is the
            accessible name (WCAG 2.5.3); the title carries the longer form.
            Invite follows the same gate as the Admin group. */}
        <div className="rail-foot flex items-stretch border-t border-white/10 px-1 py-1.5">
          {showAdmin && (
            <NavLink to="/admin/users" className={FOOT_LINK} title={t('nav.adminUsers')}>
              <DdIcon name="users" size={15} aria-hidden />
              <span className="rail-text text-[10px] font-medium">{t('nav.invite')}</span>
            </NavLink>
          )}
          <NavLink to="/connect/health" className={FOOT_LINK} title={t('nav.health')}>
            <DdIcon name="heartbeat" size={15} aria-hidden />
            <span className="rail-text text-[10px] font-medium">{t('nav.healthShort')}</span>
          </NavLink>
          <NavLink to="/guide" className={FOOT_LINK} title={t('manual.open')}>
            <DdIcon name="help" size={15} aria-hidden />
            <span className="rail-text text-[10px] font-medium">{t('nav.help')}</span>
          </NavLink>
        </div>
      </nav>

      {/* Mobile nav drawer — a slide-over reusing the rail rows; items render
          inline-expanded (no flyout) so it works on touch. */}
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
        aria-label={t('ui.mainNav')}
        className={`chrome fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-rail px-1.5 outline-none transition-transform duration-200 ease-out md:hidden ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-16 items-center gap-2 px-1.5 text-white">
          <span className="brand-mark" style={{ width: 30, height: 30 }}>
            <img src="/logo-192.png" alt="" />
          </span>
          {/* Same tagline treatment as the desktop rail (5.6:1, 10px). */}
          <span className="flex flex-col gap-0.5 leading-none">
            <span className="text-[13px] font-bold tracking-tight">vissointan</span>
            <span className="overline !text-[10px] !text-white/55">{t('shell.product')}</span>
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
              <DrawerGroup group={g} active={current === g.group} onNavigate={() => setNavOpen(false)} />
            </Fragment>
          ))}
        </div>
      </aside>

      {/* Top bar — 36px dark, starting after the sidebar (measured); a
          hamburger replaces the rail below md. */}
      {/* Phones open the drawer from the bottom bar's More tab (thumb reach),
          so the topbar carries no second hamburger. While the drawer is open
          everything behind it is inert, keeping Tab inside the drawer. */}
      <header inert={navOpen} className="topbar chrome fixed left-0 right-0 top-0 z-20 flex h-10 items-center gap-1 bg-topbar pl-3 pr-1 transition-[left] duration-200 md:left-[var(--rail-w)] md:gap-2 md:pr-3">
        <button
          className="mx-auto hidden h-6 w-[600px] max-w-[45%] items-center gap-2 rounded bg-white/[0.08] px-2 text-[12px] text-white/80 shadow-dark-btn transition-colors hover:bg-white/[0.12] md:flex"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
        >
          <DdIcon name="search" size={13} /> {t('palette.open')}
          <kbd className="ml-auto hidden rounded border border-white/20 px-1 text-[10px] lg:inline">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-0">
          <ScopePicker />
          <ShiftBadge orgId={getScope()?.orgId ?? null} siteId={getScope()?.siteId ?? null} />
          <AlarmSummaryChip />
          <TopClock />
          <LivePill />
          {enabled('assistant') && (
            <NavLink
              to="/assistant"
              className={({ isActive }) => `hidden h-10 w-10 shrink-0 place-items-center rounded hover:bg-white/10 hover:text-white sm:grid md:h-7 md:w-7 ${isActive ? 'bg-white/10 text-white' : 'text-white/70'}`}
              aria-label={t('shell.assistant')} title={t('shell.assistant')}
            >
              <DdIcon name="ai-search" size={15} />
            </NavLink>
          )}
          {/* The search pill is hidden below md — this icon keeps the palette
              reachable on touch. */}
          <button
            className={`${TOP_BTN} md:hidden`}
            aria-label={t('ui.search')}
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          >
            <DdIcon name="search" size={15} />
          </button>
          <ThemeMenu />
          <NotifyBell />
          <UserMenu />
        </div>
      </header>

      {/* Content */}
      <div inert={navOpen} className="pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-10 transition-[padding] duration-200 md:pb-0 md:pl-[var(--rail-w)]">
        <LinkStrip />
        <AlarmBanner />
        {/* No footer strip: health and audit live in the rail and the palette. */}
        <main id="main" tabIndex={-1} className="min-h-[calc(100svh-var(--h-topbar))] outline-none">
          <ConsentBanner />
          <Outlet />
        </main>
      </div>
      <OfflineBanner />
      <InstallHint />
      <div inert={navOpen}><MobileNav moreOpen={navOpen} onMore={() => setNavOpen((o) => !o)} /></div>
      <Palette />
      <Toaster />
      {helpOpen && <ShortcutOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
