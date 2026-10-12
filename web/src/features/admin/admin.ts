// Shared admin helpers (v4 T10): which org the admin pages manage, and the
// role gates the backend enforces. The UI never fetches an admin-only
// endpoint for an operator — the backend would 403 and trip the zero-4xx
// gate; the pages show a restricted state instead.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, adminApi } from '../../lib/api';
import { canAdmin, useRole } from '../../app/session';

/** Resolve the org the admin pages operate on: the first membership where
 * the user holds admin|owner (sorted by name), else the first membership —
 * a pure operator still gets the read-only admin surface. */
export function useAdminOrg(): { orgId: string | null; meRole: string; orgRole: string | null } {
  const meRole = useRole();
  const q = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const memberships = q.data?.memberships ?? [];
  const adminWeight = (r: string) => (r === 'owner' || r === 'admin' ? 0 : 1);
  const sorted = [...memberships].sort(
    (a, b) => adminWeight(a.role) - adminWeight(b.role)
      || (a.org_name ?? '').localeCompare(b.org_name ?? ''),
  );
  const chosen = sorted[0] ?? null;
  return { orgId: chosen?.org_id ?? null, meRole, orgRole: chosen?.role ?? null };
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
