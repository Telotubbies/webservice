// Users — members + pending invites for ONE organization (shown in the scope
// strip). Every read here is admin|owner-only server-side (member:manage),
// so operators/viewers get an explained restricted state and no request is
// sent (zero-4xx gate). Role changes and removals always confirm, and every
// control that cannot be used says why in visible text.

import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, adminApi, type Invite, type Member } from '../../lib/api';
import { useNow } from '../../lib/hooks';
import { useAdminOrg, canAdmin } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState, Skeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { Confirm } from '../../shared/ui/Confirm';
import { AdminFrame, OrgScope, NeedAdmin, RoleBadge, RoleGuide, LiveStatus } from './access';
import { ROLE_ORDER, explainError, roleDesc } from './access-util';

/** Owners are created by promoting a member — the invites table CHECK only
 *  accepts these three (backend INVITABLE_ROLES). */
const INVITE_ROLES = ['viewer', 'operator', 'admin'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const now = useNow(30_000);
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const isAdmin = canAdmin(orgRole ?? 'none');
  const isOwner = orgRole === 'owner';
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<string>('viewer');
  const [emailErr, setEmailErr] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invToken, setInvToken] = useState('');
  const [tokenCopied, setTokenCopied] = useState(false);
  const [revoke, setRevoke] = useState<Invite | null>(null);
  const [roleChange, setRoleChange] = useState<{ m: Member; to: string } | null>(null);
  const [remove, setRemove] = useState<Member | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const ids = { email: useId(), emailHint: useId(), emailErr: useId(), role: useId(), roleHint: useId(), ownerHint: useId() };

  const members = useQuery({
    queryKey: ['admin-members', orgId],
    queryFn: () => adminApi.members(orgId!),
    enabled: !!orgId && isAdmin,
  });
  const invites = useQuery({
    queryKey: ['admin-invites', orgId],
    queryFn: () => adminApi.invites(orgId!),
    enabled: !!orgId && isAdmin,
  });
  // current user, for the "(You)" marker — 'me' is already cached by useAdminOrg
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const mySub = me.data?.user.sub;

  if (loading || (isAdmin && members.isLoading)) return <><PageBar title={t('nav.adminUsers')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminUsers')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const org = orgName ?? orgId;
  const scope = <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} />;

  if (!isAdmin) {
    return (
      <>
        <PageBar title={t('nav.adminUsers')} lede={t('admin.usersLede')} />
        <AdminFrame>
          {scope}
          <div className="grid gap-3">
            <Card title={t('admin.members')} pad={false}><NeedAdmin orgName={org} orgRole={orgRole} /></Card>
            <RoleGuide defaultOpen />
          </div>
        </AdminFrame>
      </>
    );
  }

  const pending = (invites.data?.items ?? []).filter((i) => !i.accepted_at);
  const memberItems = members.data?.items ?? [];
  const nameOf = (m: Member) => m.display_name ?? m.email ?? m.sub;
  const roleName = (r: string) => t(`roles.${r}`, { defaultValue: r });

  const fail = (e: unknown) => { setMsg(''); setErr(explainError(t, e)); };
  const done = (text: string, key: string) => {
    setErr(''); setMsg(text);
    void qc.invalidateQueries({ queryKey: [key] });
  };

  /** Why this member's role can't be changed by me — null when it can. */
  const lockReason = (m: Member): string | null => {
    if (m.sub === mySub) return t('access.whyOwnRole');
    if (m.role === 'owner' && !isOwner) return t('access.whyOwnerRow');
    return null;
  };

  const createInvite = () => {
    const email = invEmail.trim();
    const problem = !email ? t('access.emailRequired') : !EMAIL_RE.test(email) ? t('access.emailInvalid') : '';
    setEmailErr(problem);
    if (problem) { emailRef.current?.focus(); return; }
    if (inviting) return;
    setInviting(true);
    void adminApi.createInvite(orgId, { email, role: invRole })
      .then((r) => {
        setInvToken(r.token); setTokenCopied(false); setInvEmail('');
        done(t('access.inviteCreated', { email }), 'admin-invites');
      })
      .catch(fail)
      .finally(() => setInviting(false));
  };

  return (
    <>
      <PageBar title={t('nav.adminUsers')} lede={t('admin.usersLede')} />
      <AdminFrame>
        {scope}
        <LiveStatus msg={msg} />
        {err && <div className="mb-3"><Notice tone="error">{err}</Notice></div>}
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="grid min-w-0 gap-3 self-start">
            <Card title={`${t('admin.members')} (${memberItems.length})`} pad={false}>
              {members.isError ? (
                <ErrorState onRetry={() => void members.refetch()} />
              ) : memberItems.length === 0 ? (
                <EmptyState title={t('admin.noMembers')} />
              ) : (
                <div className="admin-table overflow-x-auto">
                  <Table head={[t('admin.colUser'), t('admin.colRole'), t('admin.colStatus'), <span key="a" className="sr-only">{t('access.colActions')}</span>]}>
                    {memberItems.map((m) => {
                      const why = lockReason(m);
                      return (
                        <tr key={m.user_id}>
                          <td className="py-1.5">
                            <span className="font-medium">{nameOf(m)}</span>
                            {m.sub === mySub && <span className="ml-2 rounded-full border border-line-hard px-1.5 text-[11px] font-semibold text-ink">{t('admin.you')}</span>}
                            {m.email && m.email !== nameOf(m) && <span className="block text-[12px] text-ink-68">{m.email}</span>}
                          </td>
                          <td className="py-1.5">
                            {why ? (
                              <span className="flex flex-col items-start gap-0.5">
                                <RoleBadge role={m.role} />
                                <span className="flex items-center gap-1 text-[11px] text-ink-68">
                                  <Icon name="lock" size={11} />{why}
                                </span>
                              </span>
                            ) : (
                              <select
                                className="input h-7 text-[12px]"
                                value={m.role}
                                aria-label={t('admin.roleFor', { name: nameOf(m) })}
                                aria-describedby={isOwner ? undefined : ids.ownerHint}
                                onChange={(e) => setRoleChange({ m, to: e.target.value })}
                              >
                                {ROLE_ORDER.map((r) => (
                                  <option key={r} value={r} disabled={r === 'owner' && !isOwner}>{roleName(r)}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="py-1.5">
                            <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink ${m.disabled ? 'bg-[var(--color-danger-soft)]' : 'bg-[var(--color-ok-soft)]'}`}>
                              <span aria-hidden className={`text-[9px] ${m.disabled ? 'text-[var(--color-danger)]' : 'text-[var(--color-ok)]'}`}>{m.disabled ? '■' : '●'}</span>
                              {m.disabled ? t('admin.disabled') : t('admin.active')}
                            </span>
                          </td>
                          <td className="py-1.5 text-right">
                            {!why && (
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                                aria-label={`${t('admin.remove')} ${nameOf(m)}`}
                                onClick={() => setRemove(m)}
                              >
                                {t('admin.remove')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              )}
              {!isOwner && (
                <p id={ids.ownerHint} className="border-t border-line px-3 py-1.5 text-[11px] text-ink-68">{t('access.whyOwnerOption')}</p>
              )}
            </Card>
            <RoleGuide />
          </div>

          <Card title={`${t('admin.invites')} (${pending.length})`} pad={false}>
            {/* form wrapper so Enter in the email field creates the invite */}
            <form
              noValidate
              className="grid gap-2 border-b border-line p-3"
              onSubmit={(e) => { e.preventDefault(); createInvite(); }}
            >
              <div className="field">
                <label className="field-label" htmlFor={ids.email}>{t('admin.inviteEmail')}</label>
                <input
                  ref={emailRef}
                  id={ids.email}
                  className="input h-8"
                  type="email"
                  name="invite-email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={invEmail}
                  onChange={(e) => { setInvEmail(e.target.value); if (emailErr) setEmailErr(''); }}
                  placeholder="name@company.com…"
                  aria-invalid={emailErr ? true : undefined}
                  aria-describedby={`${ids.emailHint}${emailErr ? ` ${ids.emailErr}` : ''}`}
                />
                <span id={ids.emailHint} className="text-[11px] text-ink-68">{t('access.inviteEmailHint')}</span>
                {emailErr && (
                  <span id={ids.emailErr} className="flex items-center gap-1 text-[12px] text-[var(--color-danger)]">
                    <Icon name="warn" size={12} />{emailErr}
                  </span>
                )}
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.role}>{t('admin.colRole')}</label>
                <select
                  id={ids.role}
                  className="input h-8"
                  value={invRole}
                  aria-describedby={ids.roleHint}
                  onChange={(e) => setInvRole(e.target.value)}
                >
                  {INVITE_ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                </select>
                <span id={ids.roleHint} className="text-[11px] text-ink-68">
                  {roleDesc(t, invRole)} {t('access.ownerNotInvitable')}
                </span>
              </div>
              <div>
                <button type="submit" className="btn" aria-disabled={inviting || undefined}>
                  <Icon name="plus" size={13} /> {inviting ? t('access.inviteCreating') : t('admin.inviteCreate')}
                </button>
              </div>
            </form>
            {invToken && (
              <div className="border-b border-line bg-subtle px-3 py-2">
                <p className="flex items-center gap-1 text-[12px] font-semibold text-ink"><Icon name="warn" size={12} />{t('admin.inviteTokenOnce')}</p>
                <code className="mt-1 block break-all rounded border border-line bg-white p-1.5 font-mono text-[11px]">{invToken}</code>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost mt-1.5"
                  onClick={() => {
                    void navigator.clipboard?.writeText(invToken).then(() => setTokenCopied(true));
                  }}
                >
                  <Icon name={tokenCopied ? 'check' : 'copy'} size={12} />
                  <span aria-live="polite">{tokenCopied ? t('tags.copied') : t('admin.inviteCopy')}</span>
                </button>
              </div>
            )}
            {invites.isLoading ? (
              <div className="space-y-2 p-3">
                {[28, 20].map((h, i) => <Skeleton key={i} h={h} />)}
              </div>
            ) : invites.isError ? (
              <ErrorState onRetry={() => void invites.refetch()} />
            ) : pending.length === 0 ? (
              <EmptyState title={t('admin.noInvites')} />
            ) : (
              <div className="admin-table overflow-x-auto">
                <Table head={[t('admin.colEmail'), t('admin.colRole'), t('admin.colExpires'), <span key="a" className="sr-only">{t('access.colActions')}</span>]}>
                  {pending.map((i) => {
                    const expired = Date.parse(i.expires_at) < now;
                    return (
                      <tr key={i.id}>
                        <td className="max-w-48 truncate font-medium" title={i.email}>{i.email}</td>
                        <td><RoleBadge role={i.role} /></td>
                        <td className="whitespace-nowrap text-[12px] text-ink-68">
                          {expired
                            ? <span className="inline-flex items-center gap-1 font-semibold text-ink"><Icon name="clock" size={12} />{t('admin.inviteExpired')}</span>
                            : <time dateTime={i.expires_at}>{new Date(i.expires_at).toLocaleDateString(i18n.language)}</time>}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost text-[var(--color-danger)]"
                            aria-label={`${t('admin.revoke')} ${i.email}`}
                            onClick={() => setRevoke(i)}
                          >
                            {t('admin.revoke')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            )}
          </Card>
        </div>
      </AdminFrame>

      {roleChange && (
        <Confirm
          danger={false}
          title={t('access.changeRoleTitle')}
          body={t('access.changeRoleBody', {
            name: nameOf(roleChange.m), org,
            from: roleName(roleChange.m.role), to: roleName(roleChange.to),
            desc: roleDesc(t, roleChange.to),
          })}
          confirm={t('access.changeRoleConfirm')}
          onNo={() => setRoleChange(null)}
          onYes={() => {
            const { m, to } = roleChange;
            setRoleChange(null);
            void adminApi.patchMember(orgId, m.user_id, { role: to })
              .then(() => done(t('access.roleChanged', { name: nameOf(m), role: roleName(to) }), 'admin-members'))
              .catch(fail);
          }}
        />
      )}
      {remove && (
        <Confirm
          title={t('access.removeTitle')}
          body={t('access.removeBody', { name: nameOf(remove), org })}
          confirm={t('admin.remove')}
          onNo={() => setRemove(null)}
          onYes={() => {
            const m = remove;
            setRemove(null);
            void adminApi.removeMember(orgId, m.user_id)
              .then(() => done(t('access.removed', { name: nameOf(m) }), 'admin-members'))
              .catch(fail);
          }}
        />
      )}
      {revoke && (
        <Confirm
          title={t('admin.revoke')}
          body={t('admin.revokeBody', { email: revoke.email })}
          confirm={t('admin.revoke')}
          onNo={() => setRevoke(null)}
          onYes={() => {
            const inv = revoke;
            setRevoke(null);
            void adminApi.revokeInvite(orgId, inv.id)
              .then(() => done(t('access.revoked', { email: inv.email }), 'admin-invites'))
              .catch(fail);
          }}
        />
      )}
    </>
  );
}
