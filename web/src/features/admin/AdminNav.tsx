// AdminNav — dd org-settings pattern: in-content left panel with uppercase
// section headers and blue-fill active row. Shared by all /admin/* pages.

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
  const { t } = useTranslation();
  return (
    <nav aria-label={t('nav.admin')} className="w-48 shrink-0 border-r border-line pr-0">
      {SECTIONS.map((s) => (
        <div key={s.headKey} className="mb-3">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-46">{t(s.headKey)}</p>
          {s.items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/admin'}
              className={({ isActive }) =>
                `flex h-[34px] items-center gap-2 rounded px-4 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
                  isActive ? 'bg-blue text-white' : 'text-ink-68 hover:bg-subtle hover:text-ink'
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
