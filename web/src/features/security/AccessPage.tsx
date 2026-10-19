// Security › Access: the owner-facing record behind the posture rules —
// sign-in/auth events from the org audit log, API key usage (last_used_at /
// expiry / revocation), member access state, and edge credentials due for
// rotation. Admin+ only where the backend requires audit:read / member:manage;
// everyone else sees the explainer, not a 403.
//
// Schema note: `users` carries no per-user MFA flag today — MFA is enforced
// at the IdP, so the member table shows sign-in method instead of a fake
// toggle (sec.mfaIdp).

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { PageBar } from '../../shared/ui/Page';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { useEdgeFleet } from '../health/fleet';
import { HelpLink } from '../onboarding/HelpLink';
import { usePosture } from './posture';
import { useSecurityTabs } from './ui';
import '../onboarding/i18n';
import './i18n';

// Audit actions that count as sign-in / access events for the first table.
const AUTH_EVENTS = /^(auth|session|invite\.accepted|member\.)/;
const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
const th = 'h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68';
const table = 'w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]';

export function AccessPage() {
  const { t } = useTranslation();
  const tabs = useSecurityTabs();
  const fleet = useEdgeFleet();
  const p = usePosture();
  const due = fleet.edges.filter((e) => e.needsRotation);
  const signins = p.audit.filter((a) => AUTH_EVENTS.test(a.action)).slice(0, 50);

  return (
    <>
      <PageBar icon="security-monitoring" title={t('sec.title')} tabs={tabs} />
      <div className="space-y-4 p-4">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">{t('sec.rotation')}</h2>
          {fleet.loading ? <SkeletonRows rows={2} /> : due.length === 0 ? <Notice tone="ok">{t('sec.noRotation')}</Notice> : (
            <ul className="rounded-[5px] border border-line bg-white text-[13px]">
              {due.map((e) => <li key={e.id} className="border-b border-line px-3 py-2 last:border-0"><span aria-hidden className="text-[var(--color-caution-ink)]">◆ </span>{e.name}</li>)}
            </ul>
          )}
        </section>
        {!p.admin ? <Notice>{t('sec.needAdmin')}</Notice> : p.loading ? <SkeletonRows /> : (
          <>
            <MfaPolicy />
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('sec.signins')}</h2>
              {signins.length === 0 ? <EmptyState title={t('sec.noSignins')} icon="search" action={<HelpLink doc="invite" />} /> : (
                <div className="overflow-x-auto">
                  <table className={table}>
                    <thead><tr className="border-b border-line text-left">{['colWhen', 'colActor', 'colAction'].map((c) => <th key={c} scope="col" className={th}>{t(`sec.${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {signins.map((a) => (
                        <tr key={a.seq} className="h-9 border-b border-line last:border-0">
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(a.at)}</td>
                          <td className="px-3 font-mono text-[12px] text-ink-68">{a.actor}</td>
                          <td className="px-3">{a.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('sec.apiKeys')}</h2>
              {p.keys.length === 0 ? <EmptyState title={t('sec.noKeys')} icon="check" /> : (
                <div className="overflow-x-auto">
                  <table className={table}>
                    <thead><tr className="border-b border-line text-left">{['colName', 'colPrefix', 'colLastUsed', 'colExpires', 'colState'].map((c) => <th key={c} scope="col" className={th}>{t(`sec.${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {p.keys.map((k) => (
                        <tr key={k.id} className="h-9 border-b border-line last:border-0">
                          <td className="px-3">{k.name}</td>
                          <td className="px-3 font-mono text-[12px] text-ink-68">{k.prefix}…</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.last_used_at)}</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.expires_at)}</td>
                          <td className="px-3 text-[12px]">{k.revoked_at ? t('sec.revoked') : t('sec.active')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('sec.members')}</h2>
              {p.members.length === 0 ? <EmptyState title={t('sec.noMembers')} icon="check" /> : (
                <div className="overflow-x-auto">
                  <table className={table}>
                    <thead><tr className="border-b border-line text-left">{['colMember', 'colRole', 'colKind', 'colMfa'].map((c) => <th key={c} scope="col" className={th}>{t(`sec.${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {p.members.map((m) => {
                        const key = m.sub.startsWith('dev:') || m.sub.startsWith('svc:');
                        return (
                          <tr key={m.user_id} className="h-9 border-b border-line last:border-0">
                            <td className="px-3">{m.display_name ?? m.email ?? m.sub}{m.disabled && <span className="ml-2 text-[11px] text-[var(--color-danger)]">{t('sec.disabled')}</span>}</td>
                            <td className="px-3 text-[12px]">{t(`roles.${m.role}`, { defaultValue: m.role })}</td>
                            <td className="px-3 text-[12px]">{key ? t('sec.kindKey') : t('sec.kindSso')}</td>
                            <td className="px-3 text-[12px] text-ink-68">{key ? '—' : t('sec.mfaIdp')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

/** Org-wide two-factor policy (spec 2026-10-19 §4). The backend refuses to
 *  turn it on unless the caller's own session already used MFA (401 →
 *  step-up redirect via lib/api), so nobody locks themselves out. */
function MfaPolicy() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const qc = useQueryClient();
  const key = ['org-security', orgId];
  const q = useQuery({
    queryKey: key, enabled: !!orgId,
    queryFn: () => request<{ mfa_required: boolean; you_have_mfa: boolean }>(`/api/v1/orgs/${orgId}/security`),
  });
  const m = useMutation({
    mutationFn: (on: boolean) => request(`/api/v1/orgs/${orgId}/security`, { method: 'PATCH', body: JSON.stringify({ mfa_required: on }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  if (!q.data) return null;
  const err = m.error instanceof ApiError && m.error.status !== 401 ? m.error.message : null;
  return (
    <section className="rounded-[5px] border border-line bg-white p-3 text-[13px]">
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={q.data.mfa_required} disabled={m.isPending}
          onChange={(e) => m.mutate(e.target.checked)} />
        {t('sec.mfaRequire')}
      </label>
      <p className="mt-1 text-ink-68">{t(q.data.you_have_mfa ? 'sec.mfaYouOn' : 'sec.mfaYouOff')}</p>
      {err && <Notice tone="error">{err}</Notice>}
    </section>
  );
}
