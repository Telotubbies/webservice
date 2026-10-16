// Storage — what each user uploaded (videos, model files, plant models) and
// whether it has a durable copy in Garage. A member sees only their own
// uploads; an admin sees the organization with a per-user breakdown.
// Isolation is enforced by the API (RLS + org-prefixed keys), not by this page.

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '../../lib/api';
import { useAdminOrg, canAdmin } from '../admin/admin';
import { AdminFrame, OrgScope } from '../admin/access';
import { PageBar, Card } from '../../shared/ui/Page';
import { EmptyState, ErrorState, Notice, PageSkeleton } from '../../shared/ui/Feedback';
import './i18n';

interface Item {
  kind: 'video' | 'model' | 'plant'; id: string; name: string; size_bytes: number; sha256: string | null;
  owner_id: string | null; owner: string | null; created_at: string; in_garage: boolean | null;
}
interface Inventory {
  scope: 'org' | 'mine';
  garage: { enabled: boolean; reachable: boolean | null; bucket: string | null };
  totals: { objects: number; bytes: number; in_garage: number; missing: number };
  by_kind: { kind: string; objects: number; bytes: number }[];
  by_user: { user_id: string | null; name: string; objects: number; bytes: number }[];
  items: Item[]; orphans: { key: string; size: number }[];
}

const FILL = ['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#1d5a9e', '#9b4fc4'];
const mb = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded border border-line bg-white px-3 py-2">
      <p className="truncate text-[11px] text-ink-46">{label}</p>
      <p className="text-[28px] font-semibold leading-tight tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] text-ink-46">{sub}</p>}
    </div>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; n: number; sub: string }[] }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key} className="text-[12px]">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="font-mono">{r.sub}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: FILL[i % FILL.length] }} /></div>
        </li>
      ))}
    </ol>
  );
}

export function StoragePage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { orgId, orgName, orgRole, loading } = useAdminOrg();
  const isAdmin = canAdmin(orgRole ?? 'none');
  const q = useQuery({
    queryKey: ['storage', orgId], enabled: !!orgId, refetchInterval: 15_000,
    queryFn: () => request<Inventory>(`/api/v1/orgs/${orgId}/storage`),
  });
  const sync = useMutation({
    mutationFn: () => request<{ copied: number; skipped: number }>(`/api/v1/orgs/${orgId}/storage/sync`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['storage', orgId] }),
  });
  const title = t('sto.title');
  if (loading || q.isLoading) return <><PageBar title={title} /><PageSkeleton /></>;
  if (!orgId) return <><PageBar title={title} /><div className="p-4"><Notice tone="warn">{t('auth.denied')}</Notice></div></>;
  const d = q.data;
  const kindLabel = (k: string) => t(`sto.kind_${k}`);
  const g = d?.garage;
  const garageState = !g?.enabled ? t('sto.garageOff') : g.reachable ? t('sto.garageOk', { bucket: g.bucket }) : t('sto.garageDown');

  return (
    <>
      <PageBar title={title} lede={t('sto.lede')} actions={isAdmin && g?.enabled ? (
        <button type="button" className="btn btn-sm" disabled={sync.isPending} onClick={() => sync.mutate()}>{t('sto.sync')}</button>
      ) : undefined} />
      <AdminFrame>
        <OrgScope orgId={orgId} orgName={orgName} orgRole={orgRole} />
        {q.isError || !d ? <ErrorState onRetry={() => void q.refetch()} /> : (
          <div className="space-y-3">
            <Notice tone={d.scope === 'org' ? 'info' : 'warn'}>{d.scope === 'org' ? t('sto.scopeOrg') : t('sto.scopeMine')}</Notice>
            {sync.isError && <Notice tone="error">{sync.error instanceof ApiError ? sync.error.message : '?'}</Notice>}
            {sync.data && <Notice tone="info">{t('sto.synced', { n: sync.data.copied })}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Kpi label={t('sto.objects')} value={String(d.totals.objects)} />
              <Kpi label={t('sto.size')} value={mb(d.totals.bytes)} />
              <Kpi label={t('sto.inGarage')} value={`${d.totals.in_garage}`} sub={garageState} />
              <Kpi label={t('sto.missing')} value={String(d.totals.missing)} sub={d.totals.missing ? t('sto.missingHint') : undefined} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card title={t('sto.byKind')}>
                {d.by_kind.length ? <Bars rows={d.by_kind.map((k) => ({ key: k.kind, label: kindLabel(k.kind), n: k.bytes, sub: `${mb(k.bytes)} · ${k.objects}` }))} /> : <EmptyState title={t('sto.none')} />}
              </Card>
              <Card title={d.scope === 'org' ? t('sto.byUser') : t('sto.byYou')}>
                {d.by_user.length ? <Bars rows={d.by_user.map((u) => ({ key: u.user_id ?? '-', label: u.name, n: u.bytes, sub: `${mb(u.bytes)} · ${u.objects}` }))} /> : <EmptyState title={t('sto.none')} />}
              </Card>
            </div>

            <Card title={t('sto.items')} pad={false}>
              {d.items.length === 0 ? <EmptyState title={t('sto.none')} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="text-left text-[11px] uppercase text-ink-46">
                      <tr><th className="px-3 py-2 font-medium">{t('sto.name')}</th><th className="font-medium">{t('sto.type')}</th><th className="font-medium">{t('sto.owner')}</th>
                        <th className="font-medium">{t('sto.size')}</th><th className="font-medium">{t('sto.when')}</th><th className="pr-3 font-medium">Garage</th></tr>
                    </thead>
                    <tbody>
                      {d.items.map((i) => (
                        <tr key={`${i.kind}-${i.id}`} className="border-t border-line">
                          <td className="max-w-[260px] truncate px-3 py-1.5" title={i.sha256 ?? undefined}>{i.name}</td>
                          <td>{kindLabel(i.kind)}</td>
                          <td className="text-ink-68">{i.owner ?? '—'}</td>
                          <td className="font-mono">{mb(i.size_bytes)}</td>
                          <td className="text-ink-68">{new Date(i.created_at).toLocaleString(i18n.language)}</td>
                          <td className="pr-3">
                            {i.in_garage === null ? <span className="text-ink-46">—</span>
                              : <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${i.in_garage ? 'bg-info-soft text-blue' : 'bg-subtle text-ink-68'}`}>{i.in_garage ? t('sto.stored') : t('sto.notStored')}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {isAdmin && d.orphans.length > 0 && (
              <Card title={t('sto.orphans')}>
                <p className="mb-2 text-[12px] text-ink-68">{t('sto.orphansHint')}</p>
                <ul className="space-y-1 font-mono text-[11px]">{d.orphans.map((o) => <li key={o.key}>{o.key} · {mb(o.size)}</li>)}</ul>
              </Card>
            )}
            <Card title={t('sto.isoTitle')}><p className="text-[12px] leading-5 text-ink-68">{t('sto.isoBody')}</p></Card>
          </div>
        )}
      </AdminFrame>
    </>
  );
}
