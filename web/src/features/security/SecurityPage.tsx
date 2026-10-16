// Org security (Phase 4 "Security — repurpose"): the owner-facing security
// surface — sign-in/auth events from the org audit log, API key usage
// (last_used_at / expiry / revocation), member access state, and edge
// credentials due for rotation. Admin+ only where the backend requires
// audit:read / member:manage; everyone else sees the explainer, not a 403.
//
// Schema note: `users` carries no per-user MFA flag today — MFA is enforced
// at the IdP, so the member table shows sign-in method instead of a fake
// toggle (px.security.mfaIdp).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { canAdmin, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { useEdgeFleet } from '../health/fleet';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import { HelpLink } from '../onboarding/HelpLink';
import '../onboarding/i18n';
import '../misc/i18n';

const AUTH_EVENTS = /^(auth|session|invite\.accepted|member\.)/;
const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

export function SecurityPage() {
  const { t } = useTranslation();
  const admin = canAdmin(useRole());
  const { orgId } = useAdminOrg();
  const fleet = useEdgeFleet();
  const audit = useQuery({ queryKey: ['security-audit', orgId], queryFn: () => adminApi.audit(orgId!, { limit: 200 }), enabled: !!orgId && admin });
  const keys = useQuery({ queryKey: ['security-keys', orgId], queryFn: () => adminApi.apiKeys(orgId!), enabled: !!orgId && admin });
  const members = useQuery({ queryKey: ['security-members', orgId], queryFn: () => adminApi.members(orgId!), enabled: !!orgId && admin });
  const due = fleet.edges.filter((e) => e.needsRotation);
  const signins = (audit.data?.items ?? []).filter((a) => AUTH_EVENTS.test(a.action)).slice(0, 50);
  const apiKeys = keys.data?.items ?? [];
  const memberRows = members.data?.items ?? [];

  return (
    <div className="flex min-h-[calc(100svh-36px)] flex-col">
      <ProductHeader icon="security-monitoring" title={t('px.security.title')} />
      <div className="space-y-4 p-4">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">{t('px.security.rotation')}</h2>
          {fleet.loading ? <SkeletonRows rows={2} /> : due.length === 0 ? <Notice tone="ok">{t('px.security.noRotation')}</Notice> : (
            <ul className="rounded-[5px] border border-line bg-white text-[13px]">
              {due.map((e) => <li key={e.id} className="border-b border-line px-3 py-2 last:border-0"><span aria-hidden className="text-[var(--color-caution-ink)]">◆ </span>{e.name}</li>)}
            </ul>
          )}
        </section>
        {!admin ? (
          <Notice>{t('px.needAdmin')}</Notice>
        ) : (
          <>
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('px.security.signins')}</h2>
              {audit.isLoading ? <SkeletonRows /> : signins.length === 0 ? (
                <EmptyState title={t('px.security.noSignins')} icon="search" action={<HelpLink doc="invite" />} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colWhen', 'colActor', 'colAction'].map((c) => (
                          <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.security.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
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
              <h2 className="mb-2 text-[13px] font-semibold">{t('px.security.apiKeys')}</h2>
              {keys.isLoading ? <SkeletonRows /> : apiKeys.length === 0 ? (
                <EmptyState title={t('px.security.noKeys')} icon="check" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colName', 'colPrefix', 'colLastUsed', 'colExpires', 'colState'].map((c) => (
                          <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.security.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((k) => (
                        <tr key={k.id} className="h-9 border-b border-line last:border-0">
                          <td className="px-3">{k.name}</td>
                          <td className="px-3 font-mono text-[12px] text-ink-68">{k.prefix}…</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.last_used_at)}</td>
                          <td className="whitespace-nowrap px-3 font-mono text-[12px]">{fmt(k.expires_at)}</td>
                          <td className="px-3 text-[12px]">{k.revoked_at ? t('px.security.revoked') : t('px.security.active')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-[13px] font-semibold">{t('px.security.members')}</h2>
              {members.isLoading ? <SkeletonRows /> : memberRows.length === 0 ? (
                <EmptyState title={t('px.security.noMembers')} icon="check" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left">
                        {['colMember', 'colRole', 'colKind', 'colMfa'].map((c) => (
                          <th key={c} scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t(`px.security.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {memberRows.map((m) => (
                        <tr key={m.user_id} className="h-9 border-b border-line last:border-0">
                          <td className="px-3">{m.display_name ?? m.email ?? m.sub}
                            {m.disabled && <span className="ml-2 text-[11px] text-[var(--color-danger)]">{t('px.security.disabled')}</span>}
                          </td>
                          <td className="px-3 text-[12px]">{t(`roles.${m.role}`, { defaultValue: m.role })}</td>
                          <td className="px-3 text-[12px]">{m.sub.startsWith('dev:') || m.sub.startsWith('svc:') ? t('px.security.kindKey') : t('px.security.kindSso')}</td>
                          <td className="px-3 text-[12px] text-ink-68">{m.sub.startsWith('dev:') || m.sub.startsWith('svc:') ? '—' : t('px.security.mfaIdp')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
