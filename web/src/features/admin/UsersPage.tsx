// Users — members + pending invites. Mutations admin|owner only.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, adminApi, type Invite } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { useAdminOrg, canAdmin } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';
import { AdminNav } from './AdminNav';

const ROLES = ['viewer', 'operator', 'admin', 'owner'];

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { orgId, orgRole, loading } = useAdminOrg();
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('viewer');
  const [invToken, setInvToken] = useState('');
  const [tokenCopied, setTokenCopied] = useState(false);
  const [revoke, setRevoke] = useState<Invite | null>(null);

  const members = useQuery({
    queryKey: ['admin-members', orgId],
    queryFn: () => adminApi.members(orgId!),
    enabled: !!orgId,
  });
  const invites = useQuery({
    queryKey: ['admin-invites', orgId],
    queryFn: () => adminApi.invites(orgId!),
    enabled: !!orgId && canAdmin(orgRole ?? 'none'),
  });
  // current user, for the "(You)" marker — 'me' is already cached by useAdminOrg
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const mySub = me.data?.user.sub;

  if (loading || members.isLoading) return <><PageBar title={t('nav.adminUsers')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminUsers')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const mutable = canAdmin(orgRole ?? 'none');
  const pending = (invites.data?.items ?? []).filter((i) => !i.accepted_at);
  const memberItems = members.data?.items ?? [];

  const fail = (e: unknown) => setErr(String((e as Error).message ?? e));

  const createInvite = () => {
    if (!invEmail.trim()) return;
    void adminApi.createInvite(orgId, { email: invEmail.trim(), role: invRole })
      .then((r) => {
        setErr(''); setInvToken(r.token); setTokenCopied(false); setInvEmail('');
        void qc.invalidateQueries({ queryKey: ['admin-invites'] });
      })
      .catch(fail);
  };

  return (
    <>
      <PageBar title={t('nav.adminUsers')} lede={`${t('admin.org')}: ${orgId}`} />
      <div className="flex p-4">
        <AdminNav />
        <div className="grid min-w-0 flex-1 gap-3 pl-4 lg:grid-cols-2">
        <div className="grid min-w-0 gap-3 self-start">
        {!mutable && <Notice tone="info">{t('admin.readOnlyNotice')}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        <Card title={`${t('admin.members')} (${memberItems.length})`} pad={false}>
          {members.isError ? (
            <ErrorState onRetry={() => void members.refetch()} />
          ) : memberItems.length === 0 ? (
            <EmptyState title={t('admin.noMembers')} />
          ) : (
            <Table head={[t('admin.colUser'), t('admin.colRole'), t('admin.colStatus')]}>
              {memberItems.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <span className="font-medium">{m.display_name ?? m.sub}</span>
                    {m.sub === mySub && <span className="ml-2 rounded-full bg-line px-1.5 text-[10px] font-semibold text-ink-68">{t('admin.you')}</span>}
                    {m.email && <span className="ml-2 text-[11px] text-ink-46">{m.email}</span>}
                  </td>
                  <td>
                    {mutable ? (
                      <select
                        className="input h-6 text-[12px]"
                        value={m.role}
                        aria-label={t('admin.roleFor', { name: m.display_name ?? m.sub })}
                        onChange={(e) => {
                          void adminApi.patchMember(orgId, m.user_id, { role: e.target.value })
                            .then(() => { setErr(''); void qc.invalidateQueries({ queryKey: ['admin-members'] }); })
                            .catch(fail);
                        }}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                      </select>
                    ) : (
                      <span className="text-[12px]">{t(`roles.${m.role}`, { defaultValue: m.role })}</span>
                    )}
                  </td>
                  <td>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.disabled ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]' : 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]'}`}>
                      {m.disabled ? t('admin.disabled') : t('admin.active')}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        </div>
        <Card title={mutable ? `${t('admin.invites')} (${pending.length})` : t('admin.invites')} pad={false}>
          {mutable && (
            /* form wrapper so Enter in the email field creates the invite */
            <form
              className="flex items-center gap-2 border-b border-line p-3"
              onSubmit={(e) => { e.preventDefault(); createInvite(); }}
            >
              <input
                className="input h-7 flex-1 text-[12px]"
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                placeholder={t('admin.inviteEmail')}
                aria-label={t('admin.inviteEmail')}
              />
              <select
                className="input h-7 text-[12px]"
                value={invRole}
                aria-label={t('admin.colRole')}
                onChange={(e) => setInvRole(e.target.value)}
              >
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </select>
              <button type="submit" className="btn btn-sm" disabled={!invEmail.trim()}>
                {t('admin.inviteCreate')}
              </button>
            </form>
          )}
          {invToken && (
            <div className="border-b border-line px-3 py-2">
              <p className="text-[11px] text-ink-68">{t('admin.inviteTokenOnce')}</p>
              <code className="block break-all font-mono text-[11px]">{invToken}</code>
              {/* TODO i18n: add 'admin.inviteCopy' (en 'Copy token' / th) */}
              <button
                type="button"
                className="btn btn-sm btn-ghost mt-1"
                onClick={() => {
                  void navigator.clipboard?.writeText(invToken).then(() => setTokenCopied(true));
                }}
              >
                <Icon name="copy" size={12} /> {tokenCopied ? t('tags.copied') : t('admin.inviteCopy', { defaultValue: 'Copy token' })}
              </button>
            </div>
          )}
          {!mutable ? (
            /* invite list is admin|owner-only — a plain "none pending" would lie */
            <EmptyState icon="warn" title={t('admin.restricted')} />
          ) : invites.isLoading ? (
            <div className="space-y-2 p-3">
              {[28, 20].map((h, i) => <Skeleton key={i} h={h} />)}
            </div>
          ) : invites.isError ? (
            <ErrorState onRetry={() => void invites.refetch()} />
          ) : pending.length === 0 ? (
            <EmptyState title={t('admin.noInvites')} />
          ) : (
            <Table head={[t('admin.colEmail'), t('admin.colRole'), t('admin.colExpires'), '']}>
              {pending.map((i) => {
                const expired = Date.parse(i.expires_at) < now;
                return (
                <tr key={i.id}>
                  <td className="font-medium">{i.email}</td>
                  <td className="text-[12px]">{t(`roles.${i.role}`, { defaultValue: i.role })}</td>
                  <td className="font-mono text-[11px] text-ink-68">
                    {expired
                      ? <span className="text-[var(--color-caution)]">{t('admin.inviteExpired')}</span>
                      : new Date(i.expires_at).toLocaleDateString(i18n.language)}
                  </td>
                  <td className="text-right">
                    {mutable && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                        aria-label={`${t('admin.revoke')} ${i.email}`}
                        onClick={() => setRevoke(i)}
                      >
                        {t('admin.revoke')}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </Table>
          )}
        </Card>
        </div>
      </div>
      {revoke && (
        <Confirm
          title={t('admin.revoke')}
          body={t('admin.revokeBody', { email: revoke.email })}
          confirm={t('admin.revoke')}
          onNo={() => setRevoke(null)}
          onYes={() => {
            void adminApi.revokeInvite(orgId, revoke.id)
              .then(() => { setErr(''); void qc.invalidateQueries({ queryKey: ['admin-invites'] }); })
              .catch(fail);
            setRevoke(null);
          }}
        />
      )}
    </>
  );
}
