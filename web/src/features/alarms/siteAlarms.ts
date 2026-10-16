// Member-read v2 alarm records (CONTRACT.v2 §4) for the primary site.
// Why: the v1 list/WS shape carries acked_by but not acked_at / cleared_at,
// so "when was this acknowledged" and the ISA-18.2 quality metrics (time to
// ack, chatter) need the v2 records. Read-only, any member role (viewer too).
// Falls back to an empty list when the scope is unknown; callers keep the v1
// data they already have and only enrich it.

import { useQuery } from '@tanstack/react-query';
import { ApiError, getToken, onUnauthorized } from '../../lib/api';
import { usePrimaryScope } from '../admin/admin';

export interface SiteAlarm {
  id: string;
  tag_id: string;
  rule_id: string;
  rule: string;
  severity: string;
  state: string;
  raised_at: string;
  acked_at: string | null;
  acked_by: string | null;
  cleared_at: string | null;
  version: number;
  shelved_until?: string | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, data);
  }
  return data as T;
}

const base = (org: string, site: string) =>
  `/api/v1/orgs/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}`;

/** Last ≤500 alarm records of the primary site, newest first. */
export function useSiteAlarms(opts: { refetchMs?: number } = {}) {
  const { orgId, siteId, loading } = usePrimaryScope();
  const q = useQuery({
    queryKey: ['site-alarms', orgId, siteId],
    queryFn: () => getJson<{ items: SiteAlarm[] }>(`${base(orgId!, siteId!)}/alarms?limit=500`)
      .then((r) => r.items ?? []),
    enabled: !!orgId && !!siteId,
    staleTime: 15_000,
    refetchInterval: opts.refetchMs,
  });
  return { ...q, scopeLoading: loading, hasScope: !!orgId && !!siteId };
}
