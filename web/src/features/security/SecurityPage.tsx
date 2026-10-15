// Security signals — edge credentials due for rotation (all roles) and recent
// membership / device / session audit events (admin only: audit:read).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { canAdmin, useRole } from '../../app/session';
import { useAdminOrg } from '../admin/admin';
import { useEdgeFleet } from '../health/fleet';
import { EmptyState, Notice, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import '../misc/i18n';

const SECURITY = /^(member|invite|device|edge|auth|session|rule)\./;

export function SecurityPage() {
  const { t } = useTranslation();
  const admin = canAdmin(useRole());
  const { orgId } = useAdminOrg();
  const fleet = useEdgeFleet();
  const audit = useQuery({ queryKey: ['security-audit', orgId], queryFn: () => adminApi.audit(orgId!, { limit: 200 }), enabled: !!orgId && admin });
  const due = fleet.edges.filter((e) => e.needsRotation);
  const events = (audit.data?.items ?? []).filter((a) => SECURITY.test(a.action)).slice(0, 50);
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
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">{t('px.security.audit')}</h2>
          {!admin ? <Notice>{t('px.needAdmin')}</Notice> : audit.isLoading ? <SkeletonRows /> : events.length === 0 ? <EmptyState title={t('px.security.noAudit')} icon="search" /> : (
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
                  {events.map((a) => (
                    <tr key={a.seq} className="h-9 border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-3 font-mono text-[12px]">{new Date(a.at).toLocaleString()}</td>
                      <td className="px-3 font-mono text-[12px] text-ink-68">{a.actor}</td>
                      <td className="px-3">{a.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
