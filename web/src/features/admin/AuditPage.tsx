// Audit — tamper-evident log (seq + hash chain), admin|owner only
// (audit:read). Built to answer "who did what, when" at a glance:
// actor UUIDs resolve to member names, action codes to plain words, and the
// list filters by date range (server) plus action/free text (client).
// The backend returns rows oldest-first within the range, so the page asks
// for a bounded recent window and shows newest first.

import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AuditRow } from '../../lib/api';
import { useAdminOrg, canAdmin } from './admin';
import { PageBar, Card, Table } from '../../shared/ui/Page';
import { PageSkeleton, Notice, ErrorState, EmptyState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import { AdminFrame, OrgScope, NeedAdmin } from './access';
import { explainError } from './access-util';

const SHOW_MAX = 300;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** {"user_id":"…"} → "user_id: Name" — short, readable, no JSON braces. */
function fmtTarget(target: unknown, names: Map<string, string>): string {
  if (target == null) return '—';
  if (typeof target !== 'object') return String(target);
  return Object.entries(target as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? (names.get(v) ?? v) : JSON.stringify(v)}`)
    .join(' · ');
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const isAdmin = canAdmin(orgRole ?? 'none');
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [exportErr, setExportErr] = useState('');
  const ids = { from: useId(), to: useId(), q: useId(), action: useId(), count: useId() };

  const range = {
    from: from ? new Date(`${from}T00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const audit = useQuery({
    queryKey: ['admin-audit', orgId, range.from, range.to],
    queryFn: () => adminApi.audit(orgId!, { ...range, limit: 5000 }),
    enabled: !!orgId && isAdmin,
  });
  const members = useQuery({
    queryKey: ['admin-members', orgId],
    queryFn: () => adminApi.members(orgId!),
    enabled: !!orgId && isAdmin,
  });

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members.data?.items ?? []) m.set(x.user_id, x.display_name ?? x.email ?? x.sub);
    return m;
  }, [members.data]);
  const all = useMemo(() => [...(audit.data?.items ?? [])].sort((a, b) => b.seq - a.seq), [audit.data]);
  const actions = useMemo(() => [...new Set(all.map((r) => r.action))].sort(), [all]);

  if (loading || (isAdmin && audit.isLoading)) return <><PageBar title={t('nav.adminAudit')} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={t('nav.adminAudit')} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;

  const org = orgName ?? orgId;
  const scope = <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} />;
  if (!isAdmin) {
    return (
      <>
        <PageBar title={t('nav.adminAudit')} lede={t('admin.auditLede')} />
        <AdminFrame>{scope}<Card pad={false}><NeedAdmin orgName={org} orgRole={orgRole} /></Card></AdminFrame>
      </>
    );
  }

  const who = (actor: string) => {
    const [kind, ref] = actor.split(':', 2);
    return kind === 'user' && ref ? (names.get(ref) ?? actor) : actor;
  };
  const what = (a: string) => t(`access.act_${a.replace(/\./g, '_')}`, { defaultValue: a });
  const needle = q.trim().toLowerCase();
  const rows: AuditRow[] = all.filter((r) => (!action || r.action === action) && (!needle
    || `${who(r.actor)} ${r.actor} ${what(r.action)} ${r.action} ${fmtTarget(r.target, names)}`.toLowerCase().includes(needle)));
  const shown = rows.slice(0, SHOW_MAX);
  const filtered = !!(q || action);

  const exportCsv = () => {
    setExportErr('');
    void adminApi.auditCsv(orgId, range).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-${orgName ?? orgId}-${from || 'all'}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch((e) => setExportErr(explainError(t, e)));
  };

  return (
    <>
      <PageBar title={t('nav.adminAudit')} lede={t('admin.auditLede')} />
      <AdminFrame>
        {scope}
        <form
          className="admin-export-form mb-3 flex flex-wrap items-end gap-3 rounded-[5px] border border-line bg-white p-3"
          aria-label={t('access.auditFilters')}
          onSubmit={(e) => { e.preventDefault(); exportCsv(); }}
        >
          <div className="field">
            <label className="field-label" htmlFor={ids.from}>{t('admin.from')}</label>
            <input id={ids.from} type="date" className="input h-8" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.to}>{t('admin.to')}</label>
            <input id={ids.to} type="date" className="input h-8" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.action}>{t('access.auditAction')}</label>
            <select id={ids.action} className="input h-8" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">{t('access.auditAllActions')}</option>
              {actions.map((a) => <option key={a} value={a}>{what(a)}</option>)}
            </select>
          </div>
          <div className="field min-w-48 flex-1">
            <label className="field-label" htmlFor={ids.q}>{t('access.auditSearch')}</label>
            <input
              id={ids.q} type="search" className="input h-8" value={q} name="audit-search"
              autoComplete="off" spellCheck={false} onChange={(e) => setQ(e.target.value)}
              aria-describedby={ids.count}
            />
          </div>
          <div className="flex gap-2">
            {filtered && (
              <button type="button" className="btn btn-ghost h-8" onClick={() => { setQ(''); setAction(''); }}>
                {t('access.auditClear')}
              </button>
            )}
            <button type="submit" className="btn btn-ghost h-8">
              <Icon name="download" size={13} /> {t('access.auditExportCsv')}
            </button>
          </div>
          <p id={ids.count} role="status" className="w-full text-[12px] text-ink-68">
            {t('access.auditShown', { shown: shown.length, total: all.length })}
          </p>
        </form>
        {exportErr && <div className="mb-3"><Notice tone="error">{exportErr}</Notice></div>}
        <Card pad={false}>
          {audit.isError ? (
            <ErrorState onRetry={() => void audit.refetch()} />
          ) : all.length === 0 ? (
            <EmptyState title={t('admin.noAudit')} />
          ) : rows.length === 0 ? (
            <EmptyState icon="filter" title={t('access.auditNoMatch')} />
          ) : (
            <div className="admin-table overflow-x-auto">
              <Table head={[t('access.auditWhen'), t('access.auditWho'), t('access.auditWhat'), t('admin.colTarget'), t('access.auditIntegrity')]}>
                {shown.map((r) => (
                  <tr key={r.seq}>
                    <td className="whitespace-nowrap py-1.5 text-[12px]">
                      <time dateTime={r.at}>{new Date(r.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' })}</time>
                    </td>
                    <td className="max-w-48 truncate py-1.5 text-[12px] font-medium" title={r.actor}>{who(r.actor)}</td>
                    <td className="py-1.5 text-[12px]">
                      <span className="block">{what(r.action)}</span>
                      <code className="font-mono text-[11px] text-ink-68">{r.action}</code>
                    </td>
                    <td className="max-w-72 truncate py-1.5 text-[12px] text-ink-68" title={JSON.stringify(r.target)}>{fmtTarget(r.target, names)}</td>
                    <td className="whitespace-nowrap py-1.5 font-mono text-[11px] text-ink-68" title={r.hash}>
                      #{r.seq} · {r.hash.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </AdminFrame>
    </>
  );
}
