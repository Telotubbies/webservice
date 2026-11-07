// Data lifecycle (F20): how long each kind of data is kept, and the verified archives
// written before old telemetry is dropped. Backend: backend/app/lifecycle/routes.py.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import { EmptyState, ErrorState, SkeletonRows } from '../../shared/ui/Feedback';
import { ProductHeader } from '../../shared/ui/Product';
import './i18n';

interface Lifecycle {
  history_days: number | null;
  policy: { data_class: string; default_days: number; enabled: boolean }[];
  archives: { month: string; rows: number; sha256: string; verified_at: string }[];
}

export function LifecyclePage() {
  const { t } = useTranslation();
  const { orgId } = useAdminOrg();
  const q = useQuery({ queryKey: ['lifecycle', orgId], enabled: !!orgId, queryFn: () => request<Lifecycle>(`/api/v1/orgs/${encodeURIComponent(orgId!)}/lifecycle`) });
  return (
    <div className="flex min-h-[calc(100svh-var(--h-topbar))] flex-col">
      <ProductHeader icon="database" title={t('lc.title')} lede={t('lc.lede')} />
      <div className="flex-1 space-y-5 p-4">
        {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows rows={5} /> : q.data && (
          <>
            <section className="space-y-2" aria-label={t('lc.policy')}>
              <h2 className="text-[13px] font-medium">{t('lc.policy')}</h2>
              <p className="text-[13px]">{t('lc.telemetry', { count: q.data.history_days ?? 0 })}</p>
              <table className="text-[13px]">
                <tbody>{q.data.policy.map((p) => (
                  <tr key={p.data_class}><th scope="row" className="py-1 pr-6 text-left font-normal">{t(`lc.c_${p.data_class}`)}</th>
                    <td className="tabular-nums">{p.enabled ? t('lc.days', { count: p.default_days }) : t('lc.off')}</td></tr>))}</tbody>
              </table>
              <p className="text-[12px] text-ink-68">{t('lc.auditNote')}</p>
            </section>
            <section className="space-y-2" aria-label={t('lc.archives')}>
              <h2 className="text-[13px] font-medium">{t('lc.archives')}</h2>
              {q.data.archives.length === 0 ? <EmptyState icon="info" title={t('lc.noArchives')} /> : (
                <table className="text-[13px]">
                  <thead><tr className="text-left text-[11px] text-ink-68"><th className="pr-6">{t('lc.month')}</th><th className="pr-6">{t('lc.rows')}</th><th>{t('lc.verified')}</th></tr></thead>
                  <tbody>{q.data.archives.map((a) => (
                    <tr key={a.month}><td className="pr-6">{a.month.slice(0, 7)}</td><td className="pr-6 tabular-nums">{a.rows}</td>
                      <td title={a.sha256}>{new Date(a.verified_at).toLocaleString()}</td></tr>))}</tbody>
                </table>)}
            </section>
          </>)}
      </div>
    </div>
  );
}
