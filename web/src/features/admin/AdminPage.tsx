// Admin — org + sites overview. Read surface for operator+, mutations stay
// admin|owner server-side (v4 T10 contract).

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useAdminOrg, useAdminSite } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Skeleton } from '../../shared/ui/Feedback';
import { Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { AdminFrame, OrgScope } from './access';
import { EDGE_GLYPH, EDGE_PILL, edgeState } from '../health/fleet';
import '../health/fleetI18n';

export function AdminPage() {
  const { t } = useTranslation();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
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
  const now = Date.now();
  const hbOf = (e: (typeof edgeItems)[number]) => e.last_hb ?? (e as { last_hb_at?: string | null }).last_hb_at ?? null;
  const st = (e: (typeof edgeItems)[number]) => edgeState({ status: e.status, lastHb: hbOf(e) }, now);
  const tagItems = tags.data?.items ?? [];
  const TAG_PREVIEW = 12;

  return (
    <>
      <PageBar title={t('nav.adminOrg')} lede={t('admin.lede')} />
      <AdminFrame>
        <OrgScope
          orgId={orgId} orgName={orgName} orgRole={orgRole} site={site}
          siteControl={sites.length > 1 ? (
            <select className="input h-7 text-[12px]" aria-label={t('admin.selectSite')} value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : undefined}
        />
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
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
            <div className="admin-table overflow-x-auto">
            <Table head={[t('health.colName'), t('admin.colStatus'), t('health.colHb'), t('health.colBuffer'), t('health.colClock')]}>
              {edgeItems.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-medium">{e.name}</td>
                  <td>
                    {/* same state vocabulary as the Health fleet table: a gateway that
                        never connected is "Never connected", not a green "active" */}
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${EDGE_PILL[st(e)]}`}>
                      <span aria-hidden className="text-[9px]">{EDGE_GLYPH[st(e)]}</span>
                      {t(`fleet.state.${st(e)}`)}
                    </span>
                  </td>
                  <td className="font-mono text-[11px] text-ink-68">{hbOf(e) ?? '—'}</td>
                  <td className="w-36">
                    <span className="flex items-center gap-1.5 font-mono text-[12px]">
                      {e.buffer_depth}
                      {/* inline %-bar metric cell; cap from BUFFER_CAP=3600 */}
                      <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <span className="block h-full bg-blue" style={{ width: `${Math.min(100, (e.buffer_depth / 3600) * 100)}%` }} />
                      </span>
                    </span>
                  </td>
                  <td>{e.clock_ok == null ? '—' : e.clock_ok ? t('health.clockOk') : t('health.clockBad')}</td>
                </tr>
              ))}
            </Table>
            </div>
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
              <div className="admin-table overflow-x-auto">
              <Table head={[t('tags.colPath'), t('admin.colType'), t('tags.colUnit')]}>
                {tagItems.slice(0, TAG_PREVIEW).map((x) => (
                  <tr key={x.id}>
                    <td className="font-mono text-[12px]">{x.path}</td>
                    <td className="text-[12px]">{x.type}</td>
                    <td className="text-[12px] text-ink-68">{x.unit ?? '—'}</td>
                  </tr>
                ))}
              </Table>
              </div>
              {tagItems.length > TAG_PREVIEW && (
                <p className="px-3 py-1.5 text-[11px] text-ink-68">{t('tags.showing', { shown: TAG_PREVIEW, total: tagItems.length })}</p>
              )}
            </>
          )}
        </Card>
        </div>
      </AdminFrame>
    </>
  );
}
