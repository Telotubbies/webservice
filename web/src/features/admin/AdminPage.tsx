// Admin — org + sites overview. Read surface for operator+, mutations stay
// admin|owner server-side (v4 T10 contract).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAdminOrg, useAdminSite } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Skeleton } from '../../shared/ui/Feedback';
import { Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { AdminNav } from './AdminNav';

export function AdminPage() {
  const { t } = useTranslation();
  const { orgId, loading } = useAdminOrg();
  const { site, sites, setSiteId, loading: sitesLoading } = useAdminSite(orgId);

  const edges = useQuery({
    queryKey: ['admin-edges', orgId, site?.id],
    queryFn: () => adminApi.edges(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });
  const tags = useQuery({
    queryKey: ['admin-tags', orgId, site?.id],
    queryFn: () => adminApi.siteTags(orgId!, site!.id),
    enabled: !!orgId && !!site?.id,
  });

  if (loading) return <><PageBar title={t('nav.admin')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.admin')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const edgeItems = edges.data?.items ?? [];
  const tagItems = tags.data?.items ?? [];
  const TAG_PREVIEW = 12;

  return (
    <>
      <PageBar
        title={t('nav.adminOrg')}
        lede={`${t('admin.org')}: ${orgId}`}
        actions={
          sites.length > 1 ? (
            <select className="input" aria-label={t('admin.selectSite')} value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : site ? <span className="text-[12px] text-ink-46">{site.name} · {site.timezone}</span> : undefined
        }
      />
      <div className="flex p-4">
        <AdminNav />
        <div className="grid min-w-0 flex-1 gap-3 pl-4 lg:grid-cols-2">
        <Card title={`${t('health.edges')} (${edgeItems.length})`} pad={false}>
          {edges.isLoading || sitesLoading ? (
            <div className="space-y-2 p-3">
              {[28, 20, 28].map((h, i) => <Skeleton key={i} h={h} />)}
            </div>
          ) : edges.isError ? (
            <ErrorState onRetry={() => void edges.refetch()} />
          ) : edgeItems.length === 0 ? (
            <EmptyState title={t('admin.noEdges')} />
          ) : (
            <Table head={[t('health.colName'), t('admin.colStatus'), t('health.colHb'), t('health.colBuffer'), t('health.colClock')]}>
              {edgeItems.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td>
                    {/* up → green, down → red, stale/other → amber (never colour alone — label inside) */}
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      e.status === 'up' ? 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]'
                        : e.status === 'down' ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
                        : 'bg-[#fff4e0] text-[var(--color-caution)]'
                    }`}>
                      {t(`health.${e.status}`, { defaultValue: e.status })}
                    </span>
                  </td>
                  <td className="font-mono text-[11px] text-ink-68">{e.last_hb ?? '—'}</td>
                  <td className="w-36">
                    <span className="flex items-center gap-1.5 font-mono text-[12px]">
                      {e.buffer_depth}
                      {/* inline %-bar — dd host-list metric cell; cap from BUFFER_CAP=3600 */}
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <span className="block h-full bg-blue" style={{ width: `${Math.min(100, (e.buffer_depth / 3600) * 100)}%` }} />
                      </span>
                    </span>
                  </td>
                  <td>{e.clock_ok == null ? '—' : e.clock_ok ? t('health.clockOk') : t('health.clockBad')}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={`${t('admin.siteTags')} (${tagItems.length})`} pad={false}>
          {tags.isLoading || sitesLoading ? (
            <div className="space-y-2 p-3">
              {[28, 20, 28].map((h, i) => <Skeleton key={i} h={h} />)}
            </div>
          ) : tags.isError ? (
            <ErrorState onRetry={() => void tags.refetch()} />
          ) : tagItems.length === 0 ? (
            <EmptyState title={t('tags.emptyTitle')} body={t('tags.emptyBody')} />
          ) : (
            <>
              <Table head={[t('tags.colPath'), t('admin.colType'), t('tags.colUnit')]}>
                {tagItems.slice(0, TAG_PREVIEW).map((x) => (
                  <tr key={x.id}>
                    <td className="font-mono text-[12px]">{x.path}</td>
                    <td className="text-[12px]">{x.type}</td>
                    <td className="text-[12px] text-ink-68">{x.unit ?? '—'}</td>
                  </tr>
                ))}
              </Table>
              {tagItems.length > TAG_PREVIEW && (
                <p className="px-3 py-1.5 text-[11px] text-ink-46">{t('tags.showing', { shown: TAG_PREVIEW, total: tagItems.length })}</p>
              )}
            </>
          )}
        </Card>
        </div>
      </div>
    </>
  );
}
