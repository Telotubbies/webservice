// Shared admin helpers (v4 T10): which org the admin pages manage, and the
// role gates the backend enforces. The UI never fetches an admin-only
// endpoint for an operator — the backend would 403 and trip the zero-4xx
// gate; the pages show a restricted state instead.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, adminApi } from '../../lib/api';
import { canAdmin, canOperate, useRole } from '../../app/session';

/** Resolve the org the admin pages operate on: the first membership where
 * the user holds admin|owner (sorted by name), else the first membership —
 * a pure operator still gets the read-only admin surface.
 *
 * `orgRole` is the role in THAT org — the only role the admin pages may gate
 * on (v4 T14 fix): `useRole()`/`me.role` is the v1-shim-org role, which says
 * nothing about org B — an admin of org B whose shim membership is
 * viewer/none was wrongly locked out of org B's own admin UI. `loading` lets
 * the pages skeleton instead of flashing "restricted" while /api/me lands. */
export function useAdminOrg(): {
  orgId: string | null; meRole: string; orgRole: string | null; loading: boolean;
} {
  const meRole = useRole();
  const q = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const memberships = q.data?.memberships ?? [];
  const adminWeight = (r: string) => (r === 'owner' || r === 'admin' ? 0 : 1);
  const sorted = [...memberships].sort(
    (a, b) => adminWeight(a.role) - adminWeight(b.role)
      || (a.org_name ?? '').localeCompare(b.org_name ?? ''),
  );
  const chosen = sorted[0] ?? null;
  return {
    orgId: chosen?.org_id ?? null, meRole,
    orgRole: chosen?.role ?? null, loading: q.isLoading,
  };
}

/** operator+ in ANY org — the nav/palette gate for the admin section.
 * `useRole()` is the shim-org role only; a user who operates a different
 * org (and isn't a shim member at all) still owns an admin surface. */
export function useOperateAnyOrg(): boolean {
  const role = useRole();
  const q = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  if (canOperate(role)) return true;
  return (q.data?.memberships ?? []).some((m) => canOperate(m.role));
}

/** First site of the admin org (selector rendered when the org has >1). */
export function useAdminSite(orgId: string | null) {
  const [siteId, setSiteId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-sites', orgId],
    queryFn: () => adminApi.sites(orgId!),
    enabled: orgId != null,
  });
  const sites = q.data?.items ?? [];
  const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;
  return { site, sites, setSiteId, loading: q.isLoading };
}

export { canAdmin };
