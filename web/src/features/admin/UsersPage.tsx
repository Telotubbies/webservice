// Users + invites (v4 T10): member:manage — admin|owner only. Operators get
// a restricted state WITHOUT fetching: a speculative /members call would
// 403 and trip the zero-4xx gate.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, api, ApiError } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { EmptyState, ErrorState, Notice, PageSkeleton } from '../../shared/ui/Feedback';
import { useAdminOrg } from './admin';

const ASSIGNABLE = ['viewer', 'operator', 'admin', 'owner'] as const;
const INVITABLE = ['viewer', 'operator', 'admin'] as const;

export function UsersPage() {
  const { t } = useTranslation();
  const { orgId, orgRole, loading } = useAdminOrg();
  // gate on the role in the org this page manages — an admin of org B is
  // not blocked by holding viewer/none in the v1 shim org (v4 T14)
  const admin = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<string>('viewer');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['admin-members', orgId],
    queryFn: () => adminApi.members(orgId!),
    enabled: admin && orgId != null,
  });
  const invites = useQuery({
    queryKey: ['admin-invites', orgId],
    queryFn: () => adminApi.invites(orgId!),
    enabled: admin && orgId != null,
  });

  if (loading) return <PageSkeleton />;
  if (!admin) {
    return (
      <div className="page admin-page">
        <header className="page-head"><div><h1>{t('admin.usersTitle')}</h1></div></header>
        <EmptyState icon="lock" title={t('admin.restricted')} body={t('admin.restrictedBody')} />
      </div>
    );
  }

  const fail = (e: unknown) => setErr(e instanceof ApiError ? `${e.status} ${e.message}` : t('errors.load'));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-members', orgId] });

  const setRole = async (uid: string, newRole: string) => {
    setBusy(uid); setErr(null);
    try { await adminApi.patchMember(orgId!, uid, { role: newRole }); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const setDisabled = async (uid: string, disabled: boolean) => {
    setBusy(uid); setErr(null);
    try { await adminApi.patchMember(orgId!, uid, { disabled }); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const remove = async (uid: string) => {
    if (confirmDel !== uid) { setConfirmDel(uid); return; }
    setConfirmDel(null); setBusy(uid); setErr(null);
    try { await adminApi.removeMember(orgId!, uid); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const createInvite = async () => {
    setInvBusy(true); setInvErr(null); setIssuedToken(null);
    try {
      const r = await adminApi.createInvite(orgId!, { email: invEmail.trim(), role: invRole });
      setIssuedToken(r.token);
      setInvEmail('');
      void qc.invalidateQueries({ queryKey: ['admin-invites', orgId] });
    } catch (e) {
      setInvErr(e instanceof ApiError ? `${e.status} ${e.message}` : t('errors.load'));
    } finally { setInvBusy(false); }
  };
  const revoke = async (id: string) => {
    await adminApi.revokeInvite(orgId!, id).catch(() => {});
    void qc.invalidateQueries({ queryKey: ['admin-invites', orgId] });
  };

  const mySub = me.data?.user.sub;

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>{t('admin.usersTitle')}</h1>
          <p className="lede">{t('admin.usersLede')}</p>
        </div>
      </header>

      {err && <Notice tone="error">{err}</Notice>}

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.members')}</h2></header>
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          {members.isError ? <ErrorState onRetry={() => void members.refetch()} />
            : (members.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={t('admin.noMembers')} />
            ) : (
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.colUser')}</th>
                    <th scope="col">{t('admin.colEmail')}</th>
                    <th scope="col">{t('admin.colRole')}</th>
                    <th scope="col">{t('admin.colStatus')}</th>
                    <th scope="col">{t('alarms.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data!.items.map((m) => {
                    const self = m.sub === mySub;
                    return (
                      <tr key={m.user_id} className={m.disabled ? 'admin-disabled' : ''}>
                        <td>
                          {m.display_name ?? m.sub}
                          <span className="dim mono"> {m.sub}</span>
                        </td>
                        <td className="dim">{m.email ?? '—'}</td>
                        <td>
                          <select className="select admin-role-select" value={m.role}
                                  disabled={self || busy === m.user_id}
                                  onChange={(e) => void setRole(m.user_id, e.target.value)}>
                            {ASSIGNABLE.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                          </select>
                        </td>
                        <td>
                          <span className={`badge${m.disabled ? ' admin-badge-off' : ''}`}>
                            {m.disabled ? t('admin.disabled') : t('admin.active')}
                          </span>
                        </td>
                        <td className="admin-actions">
                          <button type="button" className="btn btn-ghost btn-sm"
                                  disabled={self || busy === m.user_id}
                                  onClick={() => void setDisabled(m.user_id, !m.disabled)}>
                            {m.disabled ? t('admin.enableUser') : t('admin.disableUser')}
                          </button>
                          <button type="button"
                                  className={`btn btn-sm ${confirmDel === m.user_id ? 'btn-danger' : 'btn-ghost'}`}
                                  disabled={self || busy === m.user_id}
                                  onClick={() => void remove(m.user_id)}>
                            {confirmDel === m.user_id ? t('admin.confirmDelete') : t('admin.remove')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.invites')}</h2></header>
        <div className="panel-body">
          <form className="admin-invite-form" onSubmit={(e) => { e.preventDefault(); void createInvite(); }}>
            <input className="input" type="email" required placeholder={t('admin.inviteEmail')}
                   value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
            <select className="select" value={invRole} onChange={(e) => setInvRole(e.target.value)}>
              {INVITABLE.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </select>
            <button type="submit" className="btn btn-primary" disabled={invBusy || !invEmail.trim()}>
              {t('admin.inviteCreate')}
            </button>
          </form>
          {invErr && <Notice tone="error">{invErr}</Notice>}
          {issuedToken && (
            <div className="admin-token-once" role="status">
              <span className="field-label">{t('admin.inviteTokenOnce')}</span>
              <code className="mono">{issuedToken}</code>
            </div>
          )}
        </div>
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          {(invites.data?.items.length ?? 0) === 0 ? null : (
            <table className="table admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.colEmail')}</th>
                  <th scope="col">{t('admin.colRole')}</th>
                  <th scope="col">{t('admin.colStatus')}</th>
                  <th scope="col">{t('alarms.colAction')}</th>
                </tr>
              </thead>
              <tbody>
                {invites.data!.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td><span className="badge">{t(`roles.${i.role}`)}</span></td>
                    <td className="dim">
                      {i.accepted_at ? t('admin.inviteAccepted')
                        : Date.parse(i.expires_at) < Date.now() ? t('admin.inviteExpired')
                        : t('admin.invitePending')}
                    </td>
                    <td>
                      {!i.accepted_at && Date.parse(i.expires_at) >= Date.now() && (
                        <button type="button" className="btn btn-ghost btn-sm"
                                onClick={() => void revoke(i.id)}>
                          {t('admin.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
