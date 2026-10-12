// Organization overview — the admin landing: org identity, your memberships
// across orgs, and the sites of the selected org. Read-only by contract
// (org/site CRUD stays out of the v4 admin scope — doc 20 §6).

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, adminApi } from '../../lib/api';
import { canOperate } from '../../app/session';
import { EmptyState, ErrorState, PageSkeleton } from '../../shared/ui/Feedback';
import { fmtClock } from '../../lib/format';
import { useAdminOrg } from './admin';
import './admin.css';

export function AdminPage() {
  const { t } = useTranslation();
  // gate on the role in the managed org, not the v1 shim org (v4 T14)
  const { orgId, orgRole, loading } = useAdminOrg();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const org = useQuery({
    queryKey: ['admin-org', orgId],
    queryFn: () => adminApi.org(orgId!),
    enabled: orgId != null,
  });
  const sites = useQuery({
    queryKey: ['admin-sites', orgId],
    queryFn: () => adminApi.sites(orgId!),
    enabled: orgId != null,
  });

  if (loading) return <PageSkeleton />;
  if (!canOperate(orgRole ?? 'none')) {
    return (
      <div className="page admin-page">
        <header className="page-head"><div><h1>{t('admin.title')}</h1></div></header>
        <EmptyState icon="lock" title={t('admin.restricted')} body={t('admin.restrictedBody')} />
      </div>
    );
  }

  const memberships = me.data?.memberships ?? [];

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>{t('admin.title')}</h1>
          <p className="lede">{t('admin.lede')}</p>
        </div>
      </header>

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.org')}</h2></header>
        <div className="panel-body flush">
          {org.isError ? <ErrorState onRetry={() => void org.refetch()} /> : (
            <table className="table admin-table">
              <tbody>
                <tr><th scope="row">{t('admin.colName')}</th><td>{org.data?.name ?? '—'}</td></tr>
                <tr><th scope="row">{t('admin.colId')}</th><td className="mono dim">{orgId ?? '—'}</td></tr>
                <tr><th scope="row">{t('admin.colRole')}</th><td><span className="badge">{org.data ? t(`roles.${org.data.role}`) : '—'}</span></td></tr>
                <tr><th scope="row">{t('admin.colCreated')}</th><td className="dim">{org.data ? fmtClock(org.data.created_at) : '—'}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.sites')}</h2></header>
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          {sites.isError ? <ErrorState onRetry={() => void sites.refetch()} />
            : (sites.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={t('admin.noSites')} />
            ) : (
              <table className="table admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.colName')}</th>
                    <th scope="col">{t('admin.colCode')}</th>
                    <th scope="col">{t('admin.colTimezone')}</th>
                    <th scope="col">{t('admin.colId')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.data!.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="mono dim">{s.code}</td>
                      <td className="dim">{s.timezone}</td>
                      <td className="mono dim">{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.yourOrgs')}</h2></header>
        <div className="panel-body flush" style={{ overflowX: 'auto' }}>
          <table className="table admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.colOrg')}</th>
                <th scope="col">{t('admin.colRole')}</th>
                <th scope="col">{t('admin.colId')}</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.org_id}>
                  <td>{m.org_name ?? '—'}</td>
                  <td><span className="badge">{t(`roles.${m.role}`)}</span></td>
                  <td className="mono dim">{m.org_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
