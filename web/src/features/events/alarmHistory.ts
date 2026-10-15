// Alarm history with real transition timestamps.
//
// Why this exists: the v1 alarm shape (REST + WS) carries raised `ts` and
// `acked_by` but NOT `acked_at` / `cleared_at`. The member-read v2 site list
// (`/api/v1/orgs/{org}/sites/{site}/alarms`, viewer-safe) has them but only
// tag ids. This joins the two by alarm id:
//   - v2 rows supply acked_at / cleared_at and reach back 500 records;
//   - v1 rows (live store, WS-fresh) supply tag names and newer states;
//   - v2-only rows get their tag name from the member-read site tag list.
// When the v2 scope can't be resolved, the live store is returned as-is and
// `timesKnown` is false, so callers can say ack/clear times are unknown
// instead of drawing a wrong timeline.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { usePrimaryScope } from '../admin/admin';
import { useSiteAlarms, type SiteAlarm } from '../alarms/siteAlarms';
import type { Alarm } from '../../types';

/** v1 display name = `<site code>.<path with dots>` (CONTRACT v1 shim). */
function useSiteTagNames(): Map<string, string> | null {
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
    for (const t of tags.data.items) m.set(t.id, `${code}.${t.path.split('/').join('.')}`);
    return m;
  }, [tags.data, code]);
}

function fromSite(r: SiteAlarm, tagName: string): Alarm {
  return {
    id: r.id, tag: tagName, rule: r.rule, severity: r.severity, state: r.state,
    ts: r.raised_at, acked_at: r.acked_at, acked_by: r.acked_by,
    cleared_at: r.cleared_at, version: r.version,
  };
}

export interface AlarmHistory {
  /** every known alarm, newest raise first */
  alarms: Alarm[];
  /** true once v2 records (with ack/clear times) have loaded */
  timesKnown: boolean;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

export function useAlarmHistory(): AlarmHistory {
  const alarmRev = useStore(() => live.alarmRev);
  const site = useSiteAlarms();
  const names = useSiteTagNames();
  const { refetch } = site;

  // A WS alarm/alarm_update means the v2 records just changed — refetch so
  // the new ack/clear timestamp shows up (debounced: floods arrive in bursts).
  useEffect(() => {
    if (!site.hasScope) return;
    const id = setTimeout(() => void refetch(), 1500);
    return () => clearTimeout(id);
  }, [alarmRev, site.hasScope, refetch]);

  const alarms = useMemo(() => {
    const byId = new Map<string, Alarm>();
    const v1 = new Map(live.alarms.map((a) => [String(a.id), a]));
    for (const r of site.data ?? []) {
      const l = v1.get(r.id);
      const merged = fromSite(r, l?.tag ?? names?.get(r.tag_id) ?? r.tag_id);
      // WS can be ahead of the last v2 fetch: take its state, keep v2 times
      if (l && (l.version ?? 0) > r.version) {
        merged.state = l.state;
        merged.acked_by = l.acked_by ?? merged.acked_by;
        merged.version = l.version;
      }
      byId.set(r.id, merged);
    }
    for (const a of live.alarms) if (!byId.has(String(a.id))) byId.set(String(a.id), a);
    return [...byId.values()].sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.data, names, alarmRev]);

  return {
    alarms,
    timesKnown: !!site.data,
    loading: site.isLoading || site.scopeLoading,
    error: site.isError,
    refetch: () => void refetch(),
  };
}

/** One alarm with v2 ack/clear timestamps merged in (F01 stepper). */
export function useEnrichedAlarm(alarm: Alarm | undefined): Alarm | undefined {
  const site = useSiteAlarms();
  const alarmRev = useStore(() => live.alarmRev);
  const { refetch } = site;
  useEffect(() => {
    if (!site.hasScope) return;
    const id = setTimeout(() => void refetch(), 1500);
    return () => clearTimeout(id);
  }, [alarmRev, site.hasScope, refetch]);
  return useMemo(() => {
    if (!alarm) return alarm;
    const r = site.data?.find((x) => x.id === String(alarm.id));
    if (!r) return alarm;
    return {
      ...alarm,
      acked_at: alarm.acked_at ?? r.acked_at,
      acked_by: alarm.acked_by ?? r.acked_by,
      cleared_at: alarm.cleared_at ?? r.cleared_at,
    };
  }, [alarm, site.data]);
}
