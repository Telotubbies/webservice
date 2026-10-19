// Phone chrome: bottom navigation (Overview · Alarms · Trends · More), the
// offline banner and the install hint. All three only exist below md.

import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAlarms } from '../alarms/alarms';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { DdIconName } from '../../shared/ui/ddicons';
import { dismissInstall, isIOS, promptInstall, useInstallOffer, useOnline, canPromptInstall } from '../../lib/pwa';
import './i18n';

const TABS: { to: string; key: string; icon: DdIconName; end?: boolean; badge?: boolean }[] = [
  { to: '/', key: 'nav.overview', icon: 'home', end: true },
  { to: '/alarms', key: 'nav.alarms', icon: 'attention-circled', badge: true },
  { to: '/trends', key: 'nav.trends', icon: 'graph-line' },
];

/** Fixed bottom bar; every target is at least 56 px tall. */
export function MobileNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { t } = useTranslation();
  const { active } = useAlarms();
  const base = 'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white';
  return (
    <nav aria-label={t('mob.navLabel')} className="chrome fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-rail pb-[env(safe-area-inset-bottom)] md:hidden">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}
          className={({ isActive }) => `${base} ${isActive ? 'font-semibold text-white' : 'text-white/65'}`}>
          <span className="relative">
            <DdIcon name={tab.icon} size={20} />
            {tab.badge && active.length > 0 && (
              <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-danger-bright px-1 text-center text-[10px] font-bold leading-4 text-white"
                aria-label={t('mob.activeAlarms', { count: active.length })}>{active.length > 99 ? '99+' : active.length}</span>
            )}
          </span>
          {t(tab.key)}
        </NavLink>
      ))}
      <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-controls="nav-drawer"
        className={`${base} ${moreOpen ? 'font-semibold text-white' : 'text-white/65'}`}>
        <DdIcon name="indented-list" size={20} />
        {t('mob.more')}
      </button>
    </nav>
  );
}

/** Says out loud that what is on screen may not be current. */
export function OfflineBanner() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-9 z-30 flex items-center gap-2 bg-[var(--color-warn)] px-4 py-2 text-[13px] font-semibold text-black">
      <span aria-hidden>⚠</span> {t('mob.offline')}
    </div>
  );
}

/** Quiet nudge, from the third visit on a phone: installing is what makes
 *  alarm notifications possible on iOS, and more reliable elsewhere. */
export function InstallHint() {
  const { t } = useTranslation();
  const offer = useInstallOffer();
  if (!offer) return null;
  return (
    <div className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 rounded-[5px] border border-line bg-white p-3 text-[13px] shadow-flyout md:hidden" role="region" aria-label={t('mob.installTitle')}>
      <p className="font-semibold">{t('mob.install')}</p>
      {!canPromptInstall() && isIOS() && <p className="mt-1 text-ink-68">{t('mob.installIos')}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost min-h-11" onClick={dismissInstall}>{t('mob.notNow')}</button>
        {canPromptInstall() && <button type="button" className="btn min-h-11" onClick={() => void promptInstall()}>{t('mob.add')}</button>}
      </div>
    </div>
  );
}
