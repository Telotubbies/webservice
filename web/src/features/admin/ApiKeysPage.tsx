// API keys — service accounts for machine callers (scripts, BI, integrations).
// Admin/owner only. The secret is returned once by the create call and lives
// only in React state until dismissed; the list shows just the prefix.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { adminApi, type ApiKey } from '../../lib/api';
import { fmtAge } from '../../lib/format';
import { useAdminOrg, canAdmin } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { Confirm } from '../../shared/ui/Confirm';
import { DdIcon } from '../../shared/ui/DdIcon';
import { CopyButton } from '../devices/SecretReveal';
import { AdminFrame, OrgScope } from './access';
import { explainError } from './access-util';

const ROLES = ['viewer', 'operator', 'admin'];
const EXPIRY = [['', 'keys.never'], ['30', 'keys.d30'], ['90', 'keys.d90'], ['365', 'keys.d365']] as const;

export function ApiKeysPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer');
  const [days, setDays] = useState('90');
  const [control, setControl] = useState(false);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<{ key: ApiKey; secret: string } | null>(null);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);

  const keys = useQuery({
    queryKey: ['api-keys', orgId],
    queryFn: () => adminApi.apiKeys(orgId!),
    enabled: !!orgId && canAdmin(orgRole ?? 'none'),
  });
  const create = useMutation({
    mutationFn: () => adminApi.createApiKey(orgId!, { name: name.trim(), role, expires_days: days ? Number(days) : null, allow_control: control && role !== 'viewer' }),
    onSuccess: (r) => { setFresh({ key: r.key, secret: r.secret }); setName(''); setErr(''); void qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => setErr(explainError(t, e)),
  });
  const revokeKey = useMutation({
    mutationFn: (k: ApiKey) => adminApi.revokeApiKey(orgId!, k.id),
    onSuccess: () => { setErr(''); void qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => setErr(explainError(t, e)),
  });

  if (loading) return <><PageBar title={t('keys.title')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('keys.title')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;
  if (!canAdmin(orgRole ?? 'none')) {
    return (
      <>
        <PageBar title={t('keys.title')} lede={t('keys.lede')} />
        <AdminFrame>
          <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} site={undefined} />
          <Notice tone="info" icon="lock">{t('access.whyReadOnly', { role: t(`roles.${orgRole ?? 'none'}`, { defaultValue: orgRole ?? '' }) })}</Notice>
        </AdminFrame>
      </>
    );
  }

  const items = keys.data?.items ?? [];
  const now = Date.now();
  const stateOf = (k: ApiKey) => (k.revoked_at ? 'revoked' : k.expires_at && Date.parse(k.expires_at) <= now ? 'expired' : 'active');

  return (
    <>
      <PageBar title={t('keys.title')} lede={t('keys.lede')} />
      <AdminFrame>
        <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} site={undefined} />

        {fresh && (
          <div className="mb-4 space-y-2 rounded-[5px] border border-[var(--color-warn)] bg-[var(--color-caution-soft)] p-3" role="status">
            <p className="flex items-center gap-2 text-[13px] font-semibold"><TriangleAlert size={15} aria-hidden /> {t('keys.onceTitle', { name: fresh.key.name })}</p>
            <p className="text-[12px] text-ink-68">{t('keys.once')}</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded bg-white px-2 py-1.5 font-mono text-[12px]" data-testid="api-key-secret">{fresh.secret}</code>
              <CopyButton text={fresh.secret} label={t('keys.copy')} />
            </div>
            <pre className="overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-ink-68">{`curl -H "Authorization: Bearer ${fresh.secret}" \\\n  ${location.origin}/api/v1/orgs/${orgId}/sites`}</pre>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFresh(null)}>{t('keys.done')}</button>
          </div>
        )}

        <Card title={t('keys.new')}>
          <form className="grid gap-3 sm:grid-cols-[1fr_160px_160px_auto] sm:items-end" noValidate
            onSubmit={(e) => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}>
            <div className="field">
              <label className="field-label" htmlFor="key-name">{t('keys.name')}</label>
              <input id="key-name" className="input h-8" value={name} maxLength={80} autoComplete="off"
                onChange={(e) => setName(e.target.value)} placeholder={t('keys.namePh')} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="key-role">{t('keys.role')}</label>
              <select id="key-role" className="input h-8" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`, { defaultValue: r })}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="key-exp">{t('keys.expires')}</label>
              <select id="key-exp" className="input h-8" value={days} onChange={(e) => setDays(e.target.value)}>
                {EXPIRY.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-[12px] sm:col-span-4">
              <input type="checkbox" checked={control && role !== 'viewer'} disabled={role === 'viewer'}
                onChange={(e) => setControl(e.target.checked)} />
              {t('keys.allowControl')}
            </label>
            <button type="submit" className="btn" aria-disabled={!name.trim() || create.isPending || undefined}>
              <DdIcon name="plus" size={12} /> {create.isPending ? t('keys.creating') : t('keys.create')}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-ink-68">{t('keys.roleHint')}</p>
        </Card>

        {err && <div className="my-3"><Notice tone="error">{err}</Notice></div>}
        <div className="mt-4">
          <Card pad={false}>
            {keys.isError ? <ErrorState onRetry={() => void keys.refetch()} /> : keys.isLoading ? <PageSkeleton /> : items.length === 0 ? (
              <EmptyState title={t('keys.empty')} body={t('keys.emptyBody')} />
            ) : (
              <div className="admin-table overflow-x-auto">
                <Table head={[t('keys.name'), t('keys.prefix'), t('keys.role'), t('keys.lastUsed'), t('keys.expires'), t('keys.status'), <span key="a" className="sr-only">{t('access.colActions')}</span>]}>
                  {items.map((k) => {
                    const s = stateOf(k);
                    return (
                      <tr key={k.id}>
                        <td className="font-medium">{k.name}</td>
                        <td className="font-mono text-[12px] text-ink-68">{k.prefix}…</td>
                        <td className="text-[12px]">{t(`roles.${k.role}`, { defaultValue: k.role })}</td>
                        <td className="text-[12px] text-ink-68">{k.last_used_at ? fmtAge(k.last_used_at) : t('keys.neverUsed')}</td>
                        <td className="text-[12px] text-ink-68">{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : t('keys.never')}</td>
                        <td><span className={`rounded-full border px-2 py-0.5 text-[11px] ${s === 'active' ? 'border-line text-ink' : 'border-line text-ink-46 line-through'}`}>{t(`keys.s_${s}`)}</span></td>
                        <td className="text-right">
                          {s === 'active' && (
                            <button type="button" className="btn btn-sm btn-ghost text-[var(--color-danger)]" aria-label={`${t('keys.revoke')} ${k.name}`} onClick={() => setRevoke(k)}>
                              {t('keys.revoke')}
                            </button>
                          )}
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
      {revoke && (
        <Confirm title={t('keys.revokeTitle', { name: revoke.name })} body={t('keys.revokeBody')} confirm={t('keys.revoke')} danger
          onNo={() => setRevoke(null)} onYes={() => { const k = revoke; setRevoke(null); revokeKey.mutate(k); }} />
      )}
    </>
  );
}
