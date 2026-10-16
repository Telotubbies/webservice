// Account settings — dd account-preferences pattern: profile card with
// identity fields, org membership list, per-browser preference toggles.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState } from '../../shared/ui/Feedback';
import { Segmented } from '../../shared/ui/Segmented';
import { Icon } from '../../shared/ui/Icon';
import { setLang } from '../../lib/i18n';
import { signOut } from '../../app/session';
import { RoleBadge } from '../admin/access';
import { roleDesc } from '../admin/access-util';
import '../platform/i18n'; // registers the `plat` bundle for the links below

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-2 text-[13px] last:border-0 sm:flex-row sm:items-center sm:gap-4">
      {label && <span className="shrink-0 text-ink-68 sm:w-36">{label}</span>}
      {!label && <span aria-hidden className="hidden shrink-0 sm:block sm:w-36" />}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });

  return (
    <>
      <PageBar title={t('nav.settings')} />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {me.isPending ? (
          <PageSkeleton rows={3} />
        ) : me.isError ? (
          <Card pad={false}><ErrorState onRetry={() => void me.refetch()} /></Card>
        ) : (
          <>
            <Card title={t('settings.profile')}>
              <div className="mb-3 flex items-center gap-3">
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-rail text-[15px] font-semibold text-white">
                  {(me.data.user.display_name || me.data.user.sub).slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="text-[15px] font-semibold">{me.data.user.display_name || me.data.user.sub}</div>
                </div>
              </div>
              <Row label={t('settings.userId')}>
                <span className="font-mono text-[12px]">{me.data.user.sub}</span>
              </Row>
              <Row label={t('settings.role')}>
                <span className="flex flex-wrap items-center gap-2">
                  <RoleBadge role={me.data.role} />
                  <span className="text-[12px] text-ink-68">{roleDesc(t, me.data.role)}</span>
                </span>
              </Row>
              <Row label={t('settings.provider')}>
                <span className="font-mono text-[12px]">{me.data.kind}</span>
              </Row>
            </Card>

            <Card title={t('settings.orgs')} pad={false}>
              <Table head={[t('settings.orgs'), t('settings.role')]}>
                {me.data.memberships.length === 0 && me.data.orgs.length === 0 && (
                  <tr><td colSpan={2} className="text-ink-68">{t('settings.noOrgs')}</td></tr>
                )}
                {(me.data.memberships.length ? me.data.memberships : me.data.orgs.map((o) => ({
                  org_id: o.org_id, org_name: null, role: o.role, permissions: [] as string[],
                }))).map((m) => (
                  <tr key={m.org_id}>
                    <td>{m.org_name ?? m.org_id}</td>
                    <td><RoleBadge role={m.role} /></td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card title={t('settings.prefs')}>
              <Row label={t('shell.language')}>
                <Segmented
                  value={i18n.language === 'th' ? 'th' : 'en'}
                  onChange={(l) => setLang(l)}
                  label={t('shell.language')}
                  options={[
                    { value: 'en', label: 'EN' },
                    { value: 'th', label: 'TH' },
                  ]}
                />
              </Row>
              <Row label=""><span className="text-[12px] text-ink-68">{t('settings.themeNote')}</span></Row>
              <Row label="">
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link to="/activity" className="text-[12px] font-semibold text-blue hover:underline">
                    {t('settings.activityLink')}
                  </Link>
                  {/* plan/usage + lifecycle — routes land with the platform
                      feature wiring (App.tsx is frozen this change) */}
                  <Link to="/settings/plan" className="text-[12px] font-semibold text-blue hover:underline">
                    {t('plat.planTitle')}
                  </Link>
                  <Link to="/settings/org" className="text-[12px] font-semibold text-blue hover:underline">
                    {t('plat.dangerTitle')}
                  </Link>
                  <Link to="/platform" className="text-[12px] font-semibold text-blue hover:underline">
                    {t('plat.platformTitle')}
                  </Link>
                  {/* opens the same `?` overlay the shell keyboard handler owns */}
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-blue hover:underline"
                    onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
                  >
                    {t('settings.shortcutsLink')}
                  </button>
                </span>
              </Row>
            </Card>

            <Card>
              <button type="button" className="btn btn-ghost h-9 text-[13px] font-semibold text-[var(--color-danger)]" onClick={signOut}>
                <Icon name="logout" size={13} /> {t('shell.signOut')}
              </button>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
