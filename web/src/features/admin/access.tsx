// Access UX primitives for the admin pages (role badges, the org/role scope
// strip, the role capability guide, restricted states and plain-language
// mutation errors). Goal G6: the tenant being administered must always be
// obvious, and every disabled control must say *why* it is disabled.

import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DdIcon } from '../../shared/ui/DdIcon';
import type { DdIconName } from '../../shared/ui/ddicons';
import { EmptyState } from '../../shared/ui/Feedback';
import { AdminNav } from './AdminNav';

import { ROLE_ORDER, roleDesc, type OrgRole } from './access-util';


/* Each role gets its own glyph, so the badge never relies on colour alone
   (WCAG 1.4.1 / ISA-101). Neutral palette: roles are not alarm states. */
const ROLE_ICON: Record<string, DdIconName> = {
  viewer: 'eye', operator: 'user', admin: 'shield', owner: 'key', none: 'lock',
};

export function RoleBadge({ role, describedBy }: { role: string; describedBy?: string }) {
  const { t } = useTranslation();
  const icon = ROLE_ICON[role] ?? 'user';
  const strong = role === 'admin' || role === 'owner';
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-[11px] font-semibold ${
        strong ? 'border-blue bg-info-soft text-ink' : 'border-line-hard bg-white text-ink'
      }`}
      data-role={role}
      aria-describedby={describedBy}
    >
      <DdIcon name={icon} size={11} />
      {t(`roles.${role}`, { defaultValue: role })}
    </span>
  );
}


/** Org + site + "your role here" strip. Rendered on every admin page so an
 *  admin who belongs to several organizations always sees which tenant the
 *  page reads and writes (anti-goal: cross-org data leaks). */
export function OrgScope({ orgName, orgId, orgRole, site, siteControl }: {
  orgName: string | null; orgId: string; orgRole: string | null;
  site?: { name: string; timezone?: string } | null; siteControl?: ReactNode;
}) {
  const { t } = useTranslation();
  const descId = useId();
  const role = orgRole ?? 'none';
  return (
    <section
      aria-label={t('access.scopeLabel')}
      className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[5px] border border-line bg-subtle px-3 py-2 text-[12px]"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <DdIcon name="organization" size={14} />
        <span className="text-ink-68">{t('access.scopeOrg')}:</span>
        <strong className="truncate font-semibold text-ink" title={orgId}>{orgName ?? orgId}</strong>
      </span>
      {(site || siteControl) && (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-ink-68">{t('access.scopeSite')}:</span>
          {siteControl ?? (
            <span className="font-semibold text-ink">
              {site!.name}{site!.timezone ? <span className="font-normal text-ink-68"> · {site!.timezone}</span> : null}
            </span>
          )}
        </span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-ink-68">{t('access.scopeRole')}:</span>
        <RoleBadge role={role} describedBy={descId} />
        <span id={descId} className="text-ink-68">{roleDesc(t, role)}</span>
      </span>
    </section>
  );
}

/** Responsive admin frame: section nav stacks above the content below md
 *  (at 390 px a fixed 192 px side panel left ~150 px for the tables). */
export function AdminFrame({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page flex flex-col gap-3 p-4 md:flex-row md:gap-0">
      <AdminNav />
      <div className="min-w-0 flex-1 md:pl-4">{children}</div>
    </div>
  );
}

/** Restricted state for admin|owner-only reads — says who can see it and
 *  what the viewer's role is, instead of a bare "no data". */
export function NeedAdmin({ orgName, orgRole }: { orgName: string; orgRole: string | null }) {
  const { t } = useTranslation();
  const role = t(`roles.${orgRole ?? 'none'}`, { defaultValue: orgRole ?? 'none' });
  return (
    <EmptyState
      icon="lock"
      title={t('access.needAdminTitle')}
      body={t('access.needAdmin', { org: orgName, role })}
    />
  );
}

/** Capability matrix — answers "what does this role allow?" before an admin
 *  changes someone's role. Native <details> so it is keyboard/SR friendly. */
const CAPS: { key: string; roles: OrgRole[] }[] = [
  { key: 'capView', roles: ['viewer', 'operator', 'admin', 'owner'] },
  { key: 'capOperate', roles: ['operator', 'admin', 'owner'] },
  { key: 'capConfig', roles: ['admin', 'owner'] },
  { key: 'capAudit', roles: ['admin', 'owner'] },
  { key: 'capOwner', roles: ['owner'] },
];

export function RoleGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { t } = useTranslation();
  return (
    <details className="group rounded-[5px] border border-line bg-white" open={defaultOpen}>
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 px-3 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
        <DdIcon name="help" size={14} />
        {t('access.roleGuideTitle')}
        <DdIcon name="caret-down" size={12} className="ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">{t('access.roleGuideTitle')}</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-3 py-1.5 font-semibold text-ink-68">{t('access.capability')}</th>
              {ROLE_ORDER.map((r) => (
                <th key={r} scope="col" className="px-2 py-1.5 text-center"><RoleBadge role={r} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPS.map((c) => (
              <tr key={c.key} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink">{t(`access.${c.key}`)}</th>
                {ROLE_ORDER.map((r) => {
                  const yes = c.roles.includes(r);
                  return (
                    <td key={r} className="px-2 py-1.5 text-center">
                      {yes
                        ? <DdIcon name="check" size={14} label={t('access.yes')} className="mx-auto text-ink" />
                        : <span className="text-ink-68"><span aria-hidden>—</span><span className="sr-only">{t('access.no')}</span></span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}


/** Polite live region for "saved" confirmations (WCAG 4.1.3). Always
 *  mounted so screen readers pick up the text change. */
export function LiveStatus({ msg }: { msg: string }) {
  return (
    <p role="status" aria-live="polite" className={msg ? 'mb-3 flex items-center gap-1.5 text-[12px] text-ink' : 'sr-only'}>
      {msg && <DdIcon name="check-circled" size={14} />}
      {msg}
    </p>
  );
}
