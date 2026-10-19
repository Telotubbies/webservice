// Security › Access: who may send commands in which area. Admins and owners
// always can; viewers never can; an operator with no ticks can everywhere
// (orgs that never use grants keep working), with ticks only in those areas.

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, adminApi, hierarchyApi } from '../../lib/api';
import { Notice, SkeletonRows } from '../../shared/ui/Feedback';
import './i18n';

export function AreaAccess({ orgId, siteId }: { orgId: string; siteId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['hierarchy', orgId, siteId], queryFn: () => hierarchyApi.tree(orgId, siteId) });
  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => adminApi.members(orgId) });
  const grants = useQuery({ queryKey: ['area-grants', orgId], queryFn: () => hierarchyApi.grants(orgId) });
  const save = useMutation({
    mutationFn: (v: { user: string; areas: string[] }) => hierarchyApi.setGrants(orgId, v.user, v.areas),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['area-grants', orgId] }),
  });
  if (tree.isLoading || members.isLoading || grants.isLoading) return <SkeletonRows rows={2} />;
  const areas = tree.data?.areas ?? [];
  const operators = (members.data?.items ?? []).filter((m) => m.role === 'operator' && !m.disabled);
  const mine = grants.data?.grants ?? {};
  const err = save.error instanceof ApiError && save.error.status !== 401 ? save.error.message : null;
  return (
    <section>
      <h2 className="mb-1 text-[13px] font-semibold">{t('asset.areaAccess')}</h2>
      <p className="mb-2 text-[12px] text-ink-68">{t('asset.areaAccessHint')}</p>
      {err && <Notice tone="error">{err}</Notice>}
      {areas.length === 0 || operators.length === 0 ? <p className="text-[12px] text-ink-68">{t(areas.length === 0 ? 'asset.areaAccessNone' : 'asset.areaAccessNoOps')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse rounded-[5px] border border-line bg-white text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{t('asset.areaAccessUser')}</th>
                {areas.map((a) => <th key={a.id} scope="col" className="h-8 px-3 text-center text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-68">{a.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {operators.map((m) => {
                const has = new Set(mine[m.user_id] ?? []);
                const name = m.display_name ?? m.email ?? m.sub;
                return (
                  <tr key={m.user_id} className="h-9 border-b border-line last:border-0">
                    <th scope="row" className="px-3 text-left font-normal">{name}</th>
                    {areas.map((a) => (
                      <td key={a.id} className="px-3 text-center">
                        <input type="checkbox" checked={has.has(a.id)} disabled={save.isPending} aria-label={`${name} — ${a.name}`}
                          onChange={(e) => {
                            const next = new Set(has);
                            if (e.target.checked) next.add(a.id); else next.delete(a.id);
                            save.mutate({ user: m.user_id, areas: [...next] });
                          }} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
