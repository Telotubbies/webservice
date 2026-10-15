// Audit — tamper-evident log (seq + hash chain). Read via adminApi.audit.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAdminOrg } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { AdminNav } from './AdminNav';
import { Icon } from '../../shared/ui/Icon';
import { downloadCsv } from '../../lib/csv';

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const { orgId, loading } = useAdminOrg();

  const audit = useQuery({
    queryKey: ['admin-audit', orgId],
    queryFn: () => adminApi.audit(orgId!, { limit: 100 }),
    enabled: !!orgId,
  });

  if (loading || audit.isLoading) return <><PageBar title={t('nav.adminAudit')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminAudit')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const rows = audit.data?.items ?? [];

  return (
    <>
      <PageBar
        title={t('nav.adminAudit')}
        lede={t('admin.auditLede')}
        actions={
          <button
            className="btn btn-sm btn-ghost"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(`audit-${orgId}`, [
              { key: 'seq', label: 'seq' }, { key: 'at', label: 'at' },
              { key: 'actor', label: 'actor' }, { key: 'action', label: 'action' },
              { key: 'hash', label: 'hash' },
            ], rows as unknown as Record<string, unknown>[])}
          >
            <Icon name="download" size={13} /> {t('admin.export')}
          </button>
        }
      />
      <div className="flex p-4">
        <AdminNav />
        <div className="min-w-0 flex-1 pl-4">
        <Card pad={false}>
          {audit.isError ? (
            <ErrorState onRetry={() => void audit.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('admin.noAudit')} />
          ) : (
            <Table head={[t('admin.colSeq'), t('admin.colAt'), t('admin.colActor'), t('admin.colAction'), t('admin.colTarget'), t('admin.colHash')]}>
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td className="font-mono text-[11px] text-ink-46">{r.seq}</td>
                  <td className="font-mono text-[11px] text-ink-68">{new Date(r.at).toLocaleString(i18n.language)}</td>
                  <td className="text-[12px] font-medium">{r.actor}</td>
                  <td className="text-[12px]">{r.action}</td>
                  <td className="max-w-56 truncate font-mono text-[11px] text-ink-68" title={JSON.stringify(r.target)}>{JSON.stringify(r.target)}</td>
                  <td className="font-mono text-[10px] text-ink-35" title={r.hash}>{r.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        </div>
      </div>
    </>
  );
}
