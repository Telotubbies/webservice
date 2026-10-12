// Audit export (v4 T10): audit:read — admin|owner. Range picker + format
// select + download; a bounded JSON preview of the newest rows sits inline
// so the operator confirms scope before exporting.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, ApiError } from '../../lib/api';
import { canAdmin } from '../../app/session';
import { EmptyState, ErrorState, Notice, PageSkeleton } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { fmtClock } from '../../lib/format';
import { useAdminOrg } from './admin';

function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function AuditPage() {
  const { t } = useTranslation();
  // gate on the role in the managed org, not the v1 shim org (v4 T14)
  const { orgId, orgRole, loading } = useAdminOrg();
  const admin = canAdmin(orgRole ?? 'none');
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fmt, setFmt] = useState<'json' | 'csv'>('csv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const params = { from: localInputToIso(from), to: localInputToIso(to) };
  const preview = useQuery({
    queryKey: ['admin-audit', orgId, params.from, params.to],
    queryFn: () => adminApi.audit(orgId!, { ...params, limit: 50 }),
    enabled: admin && orgId != null,
  });

  if (loading) return <PageSkeleton />;
  if (!admin) {
    return (
      <div className="page admin-page">
        <header className="page-head"><div><h1>{t('admin.auditTitle')}</h1></div></header>
        <EmptyState icon="lock" title={t('admin.restricted')} body={t('admin.restrictedBody')} />
      </div>
    );
  }

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const blob = await adminApi.auditCsv(orgId!, params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.status} ${e.message}` : t('errors.load'));
    } finally {
      setBusy(false);
    }
  };

  const rows = (preview.data?.items ?? []).slice().reverse(); // newest first

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>{t('admin.auditTitle')}</h1>
          <p className="lede">{t('admin.auditLede')}</p>
        </div>
      </header>

      <section className="panel">
        <header className="panel-head"><h2>{t('admin.export')}</h2></header>
        <div className="panel-body">
          <div className="admin-export-form">
            <label className="field">
              <span className="field-label">{t('admin.from')}</span>
              <input className="input" type="datetime-local" value={from}
                     onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('admin.to')}</span>
              <input className="input" type="datetime-local" value={to}
                     onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('admin.format')}</span>
              <select className="select" value={fmt}
                      onChange={(e) => setFmt(e.target.value as 'json' | 'csv')}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <div className="admin-export-actions">
              {fmt === 'csv' ? (
                <button type="button" className="btn btn-primary" disabled={busy}
                        onClick={() => void download()}>
                  <Icon name="download" size={16} /> {t('admin.download')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy}
                        onClick={() => void qc.invalidateQueries({ queryKey: ['admin-audit'] })}>
                  <Icon name="refresh" size={16} /> {t('admin.load')}
                </button>
              )}
            </div>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
          {fmt === 'json' && (
            <pre className="admin-json-preview mono" aria-label={t('admin.jsonPreview')}>
              {JSON.stringify(preview.data?.items ?? [], null, 2)}
            </pre>
          )}
        </div>
      </section>

      {fmt === 'csv' && (
        <section className="panel">
          <header className="panel-head">
            <h2>{t('admin.preview')}</h2>
            <span className="meta">{t('admin.previewNote')}</span>
          </header>
          <div className="panel-body flush" style={{ overflowX: 'auto' }}>
            {preview.isError ? <ErrorState onRetry={() => void preview.refetch()} />
              : rows.length === 0 ? (
                <EmptyState title={t('admin.noAudit')} />
              ) : (
                <table className="table admin-table">
                  <thead>
                    <tr>
                      <th scope="col" className="num">{t('admin.colSeq')}</th>
                      <th scope="col">{t('admin.colAt')}</th>
                      <th scope="col">{t('admin.colActor')}</th>
                      <th scope="col">{t('admin.colAction')}</th>
                      <th scope="col">{t('admin.colDetail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.seq}>
                        <td className="num mono">{r.seq}</td>
                        <td className="dim">{fmtClock(r.at)}</td>
                        <td className="dim">{r.actor}</td>
                        <td><span className="badge">{r.action}</span></td>
                        <td className="dim mono admin-detail">
                          {r.detail ? JSON.stringify(r.detail) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </section>
      )}
    </div>
  );
}
