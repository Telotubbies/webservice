// AdminNav — dd org-settings pattern: in-content left panel with section
// headers and blue-fill active row. Shared by all /admin/* pages.
// Below md it becomes a horizontally scrolling row of 44 px tabs (390 px
// phones), and NavLink supplies aria-current="page" on the active item.

import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { DdIconName } from '../../shared/ui/ddicons';

const SECTIONS: { headKey: string; items: { to: string; key: string; icon: DdIconName }[] }[] = [
  { headKey: 'admin.navOrg', items: [
    { to: '/admin', key: 'nav.adminOrg', icon: 'organization' },
    { to: '/admin/rules', key: 'nav.adminRules', icon: 'assert-list' },
  ] },
  { headKey: 'admin.navIdentity', items: [
    { to: '/admin/users', key: 'nav.adminUsers', icon: 'users' },
  ] },
  { headKey: 'admin.navAccess', items: [
    { to: '/admin/audit', key: 'nav.adminAudit', icon: 'audit-trail' },
  ] },
];

export function AdminNav() {
  const { t, i18n } = useTranslation();
  // letter-spacing/uppercase splits Thai combining marks — Latin only
  const overline = i18n.language === 'th' ? '' : 'uppercase tracking-wide';
  return (
    <nav
      aria-label={t('nav.admin')}
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 pb-2 md:mx-0 md:block md:w-48 md:overflow-visible md:border-b-0 md:border-r md:px-0 md:pb-0"
    >
      {SECTIONS.map((s) => (
        <div key={s.headKey} className="contents md:mb-3 md:block">
          <p className={`hidden px-3 pb-1 pt-2 text-[11px] font-semibold leading-snug text-ink-68 md:block ${overline}`}>{t(s.headKey)}</p>
          {s.items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/admin'}
              className={({ isActive }) =>
                `flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue md:h-[34px] md:px-4 ${
                  isActive ? 'bg-blue font-semibold text-white' : 'text-ink-68 hover:bg-subtle hover:text-ink'
                }`
              }
            >
              <DdIcon name={i.icon} size={13} /> {t(i.key)}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
