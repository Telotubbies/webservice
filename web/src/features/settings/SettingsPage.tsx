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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <span className="w-36 shrink-0 text-ink-68">{label}</span>
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
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#292e39] text-[15px] font-semibold text-white">
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
                <span className="rounded bg-[#e2e5ed] px-1.5 py-0.5 text-[11px] font-semibold">
                  {t(`roles.${me.data.role}`, { defaultValue: me.data.role })}
                </span>
              </Row>
              <Row label={t('settings.provider')}>
                <span className="font-mono text-[12px]">{me.data.kind}</span>
              </Row>
            </Card>

            <Card title={t('settings.orgs')} pad={false}>
              <Table head={[t('settings.orgs'), t('settings.role')]}>
                {me.data.memberships.length === 0 && me.data.orgs.length === 0 && (
                  <tr><td colSpan={2} className="text-ink-46">{t('settings.noOrgs')}</td></tr>
                )}
                {(me.data.memberships.length ? me.data.memberships : me.data.orgs.map((o) => ({
                  org_id: o.org_id, org_name: null, role: o.role, permissions: [] as string[],
                }))).map((m) => (
                  <tr key={m.org_id}>
                    <td>{m.org_name ?? m.org_id}</td>
                    <td><span className="rounded bg-[#e2e5ed] px-1.5 py-0.5 text-[11px] font-semibold">{t(`roles.${m.role}`, { defaultValue: m.role })}</span></td>
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
              <Row label=""><span className="text-[12px] text-ink-46">{t('settings.themeNote')}</span></Row>
              <Row label="">
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link to="/activity" className="text-[12px] font-semibold text-blue hover:underline">
                    {t('settings.activityLink')}
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
              <button type="button" className="btn-ghost inline-flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-semibold text-[var(--color-danger)]" onClick={signOut}>
                <Icon name="logout" size={13} /> {t('shell.signOut')}
              </button>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
