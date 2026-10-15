// Equipment inventory — derived ONLY from real member-read data:
//   v2 site tags (path + edge_id + unit) → equipment entities
//   v2 alarm rules (by tag_id)           → monitoring coverage
//   live store alarms / insights / latest values (by v1 tag name)
//   edge fleet (F22 hook)                → which gateway feeds the equipment
// Equipment is the tag path minus its signal leaf: `sort/line1/conv1/temp_c`
// belongs to `sort/line1/conv1`. Kind comes from the equipment id prefix.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminRule, type AdminTag } from '../../lib/api';
import { live } from '../../lib/live';
import { useStore } from '../../lib/hooks';
import { useAdminSite, useAdminOrg } from '../admin/admin';
import { useEdgeFleet, type FleetEdge } from '../health/fleet';
import type { Alarm, Insight, TagValue } from '../../types';

export type EquipmentKind =
  | 'conveyor' | 'crusher' | 'screen' | 'silo' | 'feeder' | 'motor' | 'camera' | 'kiln' | 'mill' | 'other';

const KIND_RULES: [RegExp, EquipmentKind][] = [
  [/^(conv|belt|cv)/i, 'conveyor'],
  [/^(crush|jaw|cone|cr\d)/i, 'crusher'],
  [/^(screen|scr|sieve)/i, 'screen'],
  [/^(silo|bin|hopper|tank)/i, 'silo'],
  [/^(feed|fdr)/i, 'feeder'],
  [/^(motor|mtr|drive|vfd|pump|fan)/i, 'motor'],
  [/^(cam|vision)/i, 'camera'],
  [/^(kiln)/i, 'kiln'],
  [/^(mill|grind)/i, 'mill'],
];

export function kindOf(equipId: string): EquipmentKind {
  for (const [re, k] of KIND_RULES) if (re.test(equipId)) return k;
  return 'other';
}

/** v2 site tag as the backend returns it (AdminTag omits these fields). */
export type SiteTag = AdminTag & { edge_id?: string | null; writable?: boolean };

export interface EquipmentSignal {
  tag: SiteTag;
  /** v1 dotted name used by the live store / WS: `<siteCode>.<path dots>` */
  name: string;
  latest?: TagValue;
  rules: AdminRule[];
}

export interface Equipment {
  /** stable key = equipment path, e.g. `sort/line1/conv1` */
  key: string;
  id: string;           // last path segment, e.g. conv1
  area: string;         // path above the equipment, e.g. sort/line1
  kind: EquipmentKind;
  signals: EquipmentSignal[];
  edges: FleetEdge[];
  rules: AdminRule[];
  activeAlarms: Alarm[];
  openInsights: Insight[];
  writable: number;
}

export const v1Name = (siteCode: string, path: string) =>
  `${siteCode}.${path.split('/').filter(Boolean).join('.')}`;

export function equipmentKeyOf(path: string): string {
  const seg = path.split('/').filter(Boolean);
  return seg.length > 1 ? seg.slice(0, -1).join('/') : seg[0] ?? path;
}

export function useSiteInventory() {
  const { orgId, loading: orgLoading } = useAdminOrg();
  const { site, loading: siteLoading } = useAdminSite(orgId);
  const siteId = site?.id ?? null;
  const on = !!orgId && !!siteId;
  const tags = useQuery({
    queryKey: ['inv-tags', orgId, siteId],
    queryFn: () => adminApi.siteTags(orgId!, siteId!),
    enabled: on, staleTime: 60_000,
  });
  const rules = useQuery({
    queryKey: ['inv-rules', orgId, siteId],
    queryFn: () => adminApi.rules(orgId!, siteId!),
    enabled: on, staleTime: 60_000,
  });
  const fleet = useEdgeFleet();
  const alarmRev = useStore(() => live.alarmRev);
  const insightRev = useStore(() => live.insightRev);
  const version = useStore(() => live.version);

  const equipment = useMemo(() => {
    if (!site || !tags.data) return [] as Equipment[];
    const edgeById = new Map(fleet.edges.map((e) => [e.id, e]));
    const rulesByTag = new Map<string, AdminRule[]>();
    for (const r of rules.data?.items ?? []) {
      const xs = rulesByTag.get(r.tag_id) ?? [];
      xs.push(r);
      rulesByTag.set(r.tag_id, xs);
    }
    const map = new Map<string, Equipment>();
    for (const tag of tags.data.items as SiteTag[]) {
      const key = equipmentKeyOf(tag.path);
      let eq = map.get(key);
      if (!eq) {
        const seg = key.split('/');
        const id = seg[seg.length - 1] ?? key;
        eq = {
          key, id, area: seg.slice(0, -1).join('/'), kind: kindOf(id),
          signals: [], edges: [], rules: [], activeAlarms: [], openInsights: [], writable: 0,
        };
        map.set(key, eq);
      }
      const name = v1Name(site.code, tag.path);
      const tr = rulesByTag.get(tag.id) ?? [];
      eq.signals.push({ tag, name, latest: live.latest.get(name), rules: tr });
      eq.rules.push(...tr);
      if (tag.writable) eq.writable++;
      const edgeId = tag.edge_id;
      const edge = edgeId ? edgeById.get(edgeId) : undefined;
      if (edge && !eq.edges.includes(edge)) eq.edges.push(edge);
    }
    const byName = new Map<string, Equipment>();
    for (const eq of map.values()) for (const s of eq.signals) byName.set(s.name, eq);
    for (const a of live.alarms) {
      if (a.state === 'cleared') continue;
      byName.get(a.tag)?.activeAlarms.push(a);
    }
    for (const i of live.insights) {
      if (i.state !== 'open') continue;
      byName.get(i.tag)?.openInsights.push(i);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    // live revs are the change signal for the mutable live store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, tags.data, rules.data, fleet.edges, alarmRev, insightRev, version]);

  return {
    orgId, siteId, site,
    equipment,
    fleet,
    loading: orgLoading || siteLoading || (on && (tags.isLoading || rules.isLoading)),
    error: tags.isError,
    rulesError: rules.isError,
    refetch: () => { void tags.refetch(); void rules.refetch(); fleet.refetch(); },
  };
}
