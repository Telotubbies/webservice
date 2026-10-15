// Edge fleet data (F22) — joins the two member-read v2 endpoints:
//   GET …/sites/{site}/edges   → identity, adapter, credential, needs_rotation
//   GET …/sites/{site}/health  → buffer_depth (+ heartbeat/clock, broker/db)
// Both are `site:read`, so viewers may fetch them without a 4xx. Shared by
// the Health page fleet table, Processes, Catalog, Security and Assistant.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { usePrimaryScope } from '../admin/admin';

export type EdgeState = 'online' | 'stale' | 'offline' | 'never' | 'disabled';

export interface FleetEdge {
  id: string;
  name: string;
  status: string;
  mqttUser: string | null;
  credVersion: number | null;
  lastHb: string | null;
  clockOk: boolean | null;
  adapter: string | null;
  needsRotation: boolean;
  /** store-and-forward backlog reported by the edge; null = not reported */
  bufferDepth: number | null;
}

/** Heartbeat windows are UI policy: the bridge beats every ~1 s, so 30 s of
 *  silence is stale and 5 min is offline (same policy as Infrastructure). */
export const STALE_AFTER_MS = 30_000;
export const OFFLINE_AFTER_MS = 300_000;

export function edgeState(e: Pick<FleetEdge, 'status' | 'lastHb'>, now: number): EdgeState {
  if (e.status === 'disabled') return 'disabled';
  if (!e.lastHb) return 'never';
  const age = now - Date.parse(e.lastHb);
  if (age <= STALE_AFTER_MS) return 'online';
  if (age <= OFFLINE_AFTER_MS) return 'stale';
  return 'offline';
}

/** abnormal = needs a technician; only these may use amber/red (ISA-101) */
export const isAbnormalEdge = (s: EdgeState) => s === 'stale' || s === 'offline';

/** Shape per state — colour is never the only carrier. */
export const EDGE_GLYPH: Record<EdgeState, string> = {
  online: '●', stale: '◆', offline: '▲', never: '○', disabled: '■',
};

/** Token-only classes; amber/red only on abnormal states. */
export const EDGE_PILL: Record<EdgeState, string> = {
  online: 'bg-[var(--color-ok-soft)] text-[var(--color-ok-ink)]',
  stale: 'bg-[var(--color-caution-soft)] text-[var(--color-caution-ink)]',
  offline: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  never: 'border border-line bg-white text-ink-68',
  disabled: 'bg-subtle text-ink-46',
};

export interface EdgeFleet {
  edges: FleetEdge[];
  orgId: string | null;
  siteId: string | null;
  /** broker/db as seen by the site health rollup */
  mqtt: string | null;
  db: string | null;
  loading: boolean;
  error: boolean;
  /** health endpoint failed but inventory loaded — buffer column unknown */
  healthError: boolean;
  updatedAt: number;
  refetch: () => void;
}

export function useEdgeFleet(): EdgeFleet {
  const { orgId, siteId, loading: scopeLoading } = usePrimaryScope();
  const on = !!orgId && !!siteId;
  const edges = useQuery({
    queryKey: ['fleet-edges', orgId, siteId],
    queryFn: () => adminApi.devices(orgId!, siteId!),
    enabled: on,
    refetchInterval: 15_000,
  });
  const health = useQuery({
    queryKey: ['fleet-health', orgId, siteId],
    queryFn: () => adminApi.siteHealth(orgId!, siteId!),
    enabled: on,
    refetchInterval: 15_000,
  });

  const merged = useMemo(() => {
    const hb = new Map((health.data?.edges ?? []).map((h) => [h.id, h]));
    return (edges.data?.items ?? []).map((d): FleetEdge => {
      const h = hb.get(d.id);
      return {
        id: d.id, name: d.name, status: d.status,
        mqttUser: d.mqtt_username ?? null,
        credVersion: d.credential_version ?? null,
        lastHb: d.last_hb_at ?? h?.last_hb ?? null,
        clockOk: d.clock_ok ?? h?.clock_ok ?? null,
        adapter: d.adapter ?? null,
        needsRotation: !!d.needs_rotation,
        bufferDepth: typeof h?.buffer_depth === 'number' ? h.buffer_depth : null,
      };
    });
  }, [edges.data, health.data]);

  const raw = health.data as (typeof health.data & { mqtt?: string; db?: string }) | undefined;
  return {
    edges: merged,
    orgId, siteId,
    mqtt: raw?.mqtt ?? null,
    db: raw?.db ?? null,
    loading: scopeLoading || (on && edges.isLoading),
    error: edges.isError,
    healthError: health.isError,
    updatedAt: Math.max(edges.dataUpdatedAt, health.dataUpdatedAt),
    refetch: () => { void edges.refetch(); void health.refetch(); },
  };
}

/** Short, stable id for dense tables: last 4 hex of the uuid. */
export const shortId = (id: string) => id.replace(/-/g, '').slice(-6);
