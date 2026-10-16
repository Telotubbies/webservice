// Incident helpers (WP-E): status vocabulary, time-in-status segments,
// omnibar matching, and the linked-alarm join (incident.alarm_id is a v2
// alarm UUID — it joins to the member-read site alarm list, not the v1 ids).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type IncidentRow, type IncidentStatus, type IncidentSeverity } from '../../lib/api';
import { usePrimaryScope } from '../admin/admin';
import { useSiteAlarms, type SiteAlarm } from '../alarms/siteAlarms';
import { equipmentOf } from '../../lib/plant';
import type { PageTab } from '../../shared/ui/Page';

export const INC_STATUSES: readonly IncidentStatus[] = ['active', 'acknowledged', 'resolved'];
export const INC_SEVS: readonly IncidentSeverity[] = ['critical', 'warning', 'info'];

/** Incidents | Settings tab pair shared by the list and settings pages. */
export function useIncidentTabs(): PageTab[] {
  const { t } = useTranslation();
  return [
    { to: '/incidents', label: t('inc.tabList'), end: true },
    { to: '/incidents/settings', label: t('inc.tabSettings') },
  ];
}

/** tag_id → v1 display name (`<site code>.<path>`) for the primary site —
 *  same join as features/events/alarmHistory.ts. */
export function useSiteTagNames(): Map<string, string> | null {
  const { orgId, siteId } = usePrimaryScope();
  const sites = useQuery({
    queryKey: ['admin-sites', orgId],
    queryFn: () => adminApi.sites(orgId!),
    enabled: !!orgId,
  });
  const code = sites.data?.items.find((s) => s.id === siteId)?.code;
  const tags = useQuery({
    queryKey: ['site-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: !!orgId && !!siteId,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    if (!tags.data || !code) return null;
    const m = new Map<string, string>();
    for (const t of tags.data.items) m.set(t.id, `${code}.${t.path}`);
    return m;
  }, [tags.data, code]);
}

export interface LinkedAlarms {
  byId: Map<string, SiteAlarm>;
  /** equipment id of an incident's linked alarm, or '' when none/unknown */
  equipmentOf: (inc: IncidentRow) => string;
  /** display tag name of an incident's linked alarm, or '' */
  tagOf: (inc: IncidentRow) => string;
  loading: boolean;
}

/** Join incidents to the site alarm list (v2 UUIDs) + tag display names. */
export function useLinkedAlarms(): LinkedAlarms {
  const alarms = useSiteAlarms();
  const tagNames = useSiteTagNames();
  return useMemo(() => {
    const byId = new Map((alarms.data ?? []).map((a) => [a.id, a]));
    const tagOf = (inc: IncidentRow) =>
      (inc.alarm_id && byId.get(inc.alarm_id) && tagNames?.get(byId.get(inc.alarm_id)!.tag_id)) || '';
    return {
      byId,
      tagOf,
      equipmentOf: (inc) => equipmentOf(tagOf(inc)) ?? '',
      loading: alarms.isLoading,
    };
  }, [alarms.data, alarms.isLoading, tagNames]);
}

/** One cell of the time-in-status strip. `to === null` means "still here". */
export interface StatusSegment {
  status: IncidentStatus;
  from: string | null;
  to: string | null;
  current: boolean;
  reached: boolean;
}

/** active → acknowledged → resolved; timestamps straight from the record,
 *  a missing ack time never gets invented (segment shows '—'). */
export function statusSegments(inc: IncidentRow): StatusSegment[] {
  const idx = INC_STATUSES.indexOf(inc.status);
  const from: (string | null)[] = [inc.created_at, inc.acked_at ?? null, inc.resolved_at ?? null];
  const to: (string | null)[] = [inc.acked_at ?? null, inc.resolved_at ?? null, null];
  return INC_STATUSES.map((status, i) => ({
    status,
    from: from[i],
    to: to[i],
    current: i === idx,
    reached: i <= idx,
  }));
}

/** Omnibar match: free text over title / team / equipment / linked tag;
 *  `status:` `severity:` `team:` `equipment:` tokens filter exactly. */
export function matchIncident(
  inc: IncidentRow, q: string,
  equipment: string, tag: string,
): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const free = `${inc.title} ${inc.team ?? ''} ${equipment} ${tag} ${inc.severity} ${inc.status}`.toLowerCase();
  return tokens.every((tok) => {
    const m = /^([a-z_]+):(.*)$/.exec(tok);
    const key = m?.[1];
    const val = m?.[2];
    if (!key || !val) return free.includes(tok);
    switch (key) {
      case 'status': case 'state': case 'is':
        return inc.status === val;
      case 'sev': case 'severity':
        return inc.severity === val;
      case 'team': case 'assignee': case 'owner':
        return (inc.team ?? '').toLowerCase().includes(val);
      case 'equipment': case 'eq':
        return equipment.toLowerCase().includes(val);
      default:
        return free.includes(tok);
    }
  });
}
