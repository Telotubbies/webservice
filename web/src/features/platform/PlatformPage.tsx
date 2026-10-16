// Platform home — WDS staff tenant list + ops health (roadmap §11 7.1/7.3).
// /platform — every call needs a platform_admins row; a 403 renders the
// restricted notice instead of throwing.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import './i18n';
import { isPlatformDenied, platformApi } from './api';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, ErrorState, Notice } from '../../shared/ui/Feedback';

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

function Health() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['platform-health'], queryFn: platformApi.health, refetchInterval: 30_000 });
  const h = q.data;
  if (!h) return null;
  const cell = (label: string, v: unknown) => (
    <div className="rounded border border-line px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-46">{label}</div>
      <div className="text-[15px] font-semibold">{String(v)}</div>
    </div>);
  return (
    <Card title={t('plat.health')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cell(t('plat.orgsTotal'), h.orgs.total)}
        {cell(t('plat.orgsSuspended'), h.orgs.suspended)}
        {cell(t('plat.orgsDeleted'), h.orgs.deleted)}
        {cell('MQTT', h.mqtt_connected ? 'up' : 'down')}
        {cell(t('plat.jobsPending'), h.jobs.pending)}
        {cell(t('plat.jobsDead'), h.jobs.dead)}
        {h.notification_deliveries_1h && cell(t('plat.notifSent'), h.notification_deliveries_1h.sent)}
        {h.notification_deliveries_1h && cell(t('plat.notifFailed'), h.notification_deliveries_1h.failed)}
        {cell(t('plat.supportSessions'), h.support_sessions_active)}
      </div>
    </Card>
  );
}

export function PlatformPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['platform-orgs'], queryFn: platformApi.orgs, refetchInterval: 60_000 });
  const denied = q.isError && isPlatformDenied(q.error);
  return (
    <>
      <PageBar title={t('plat.platformTitle')} lede={t('plat.platformLede')}
               actions={(
                 <span className="flex gap-3 text-[12px] font-semibold">
                   <Link className="text-blue hover:underline" to="/platform/support">{t('plat.supportSessions')}</Link>
                   <Link className="text-blue hover:underline" to="/platform/announcements">{t('plat.announcements')}</Link>
                 </span>)} />
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        {denied ? <Notice tone="warn">{t('plat.denied')}</Notice>
          : q.isPending ? <PageSkeleton rows={6} />
          : q.isError ? <Card pad={false}><ErrorState onRetry={() => void q.refetch()} /></Card>
          : (
          <>
            <Health />
            <Card title={t('plat.tenants')} pad={false}>
              <Table head={[t('plat.name'), t('plat.planCol'), t('plat.edgesCol'),
                            t('plat.lastActivity'), t('plat.actions')]}>
                {(q.data?.items ?? []).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link className="font-semibold text-blue hover:underline"
                            to={`/platform/orgs/${o.id}`}>{o.name}</Link>
                      <div className="text-[11px] text-ink-46">{o.slug}</div>
                    </td>
                    <td>{o.plan}{o.suspended && <span className="ml-1 text-[11px] text-[var(--color-danger)]">{t('plat.suspended')}</span>}
                        {o.deleted && <span className="ml-1 text-[11px] text-ink-46">deleted</span>}</td>
                    <td>{o.edge_health ? `${o.edge_health.online}/${o.edge_health.active}` : '—'}</td>
                    <td className="text-[12px]">{fmt(o.last_activity_at)}</td>
                    <td><Link className="text-[12px] font-semibold text-blue hover:underline"
                              to={`/platform/orgs/${o.id}`}>{t('plat.detail')}</Link></td>
                  </tr>))}
              </Table>
            </Card>
          </>)}
      </div>
    </>
  );
}
