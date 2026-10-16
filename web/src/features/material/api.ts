// Material (gravel/sand) decision: settings, live state, history.
// Mirrors backend/app/vision/material.py.

import { useQuery } from '@tanstack/react-query';
import { request } from '../../lib/api';
import { useAdminOrg } from '../admin/admin';
import type { VisionEvent } from '../vision/api';

export interface MatOutputs {
  code: string | null; margin_pct: string | null; uncertain: string | null; trigger: string | null;
  gravel_value: number; sand_value: number; none_value: number; pulse_ms: number;
}
export interface MatPreprocess { clahe: boolean; clahe_clip: number; gamma: number; brightness: number; roi: number[] | null }
export interface MatSettings {
  enabled: boolean; dry_run: boolean; gravel_class: string; sand_class: string;
  conf: number; area_min: number; coverage_gate: number; k_enter: number; k_leave: number;
  min_margin: number; min_frames: number; max_event_s: number; rule: 'mass_vote' | 'frame_majority';
  preprocess: MatPreprocess; outputs: MatOutputs;
}
export interface MatLive {
  gate?: 'empty' | 'present'; sand_frac?: number; coverage?: number; frames?: number; decisions?: number;
  last?: { decision: 'gravel' | 'sand' | 'no-material'; margin: number | null; uncertain: boolean };
}
export interface MatCamera {
  id: string; edge_id: string; edge_name: string; name: string; kind: 'rtsp' | 'upload'; enabled: boolean;
  status: 'unknown' | 'ok' | 'error'; model_state?: string; engine?: string; latency_ms?: number; fps?: number;
  placement?: string; material: MatSettings | null; material_live?: MatLive;
}
export interface MatSchema { defaults: MatSettings; ranges: Record<string, { min: number | null; max: number | null }> }
export interface MatSummary {
  total: number; by_decision: Record<string, number>; mass: { gravel: number; sand: number };
  margin_hist: number[]; uncertain: number; reviewed: number; wrong: number;
}
export interface MetricPt {
  t: string; fps: number | null; lat_avg: number | null; lat_p50: number | null; lat_p95: number | null;
  infer_n: number | null; det_n: number | null; present_n: number; n: number;
}
export interface MatDecision {
  decision: 'gravel' | 'sand' | 'no-material'; sand_frac: number | null; gravel_w: number; sand_w: number;
  margin: number; uncertain: boolean; frames: number; duration_s: number; rule: string; dry_run?: boolean;
  outputs?: { tag_path: string; result: string; value?: unknown; reason?: string }[];
}

const org = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}`;

export const matApi = {
  schema: () => request<MatSchema>('/api/v1/vision/material-schema'),
  cameras: (o: string) => request<{ items: MatCamera[] }>(`${org(o)}/vision/material/cameras`).then((r) => r.items),
  summary: (o: string, minutes: number) => request<MatSummary>(`${org(o)}/vision/material/summary?minutes=${minutes}`),
  metrics: (o: string, minutes: number, camera?: string) =>
    request<{ step_s: number; items: MetricPt[] }>(`${org(o)}/vision/metrics?minutes=${minutes}${camera ? `&camera=${camera}` : ''}`),
  events: (o: string, limit = 30) =>
    request<{ items: VisionEvent[] }>(`${org(o)}/vision/events?kind=material&limit=${limit}`).then((r) => r.items),
  save: (o: string, edge: string, cam: string, material: MatSettings | null) =>
    request<unknown>(`${org(o)}/edges/${edge}/cameras/${cam}`, {
      method: 'PATCH', body: JSON.stringify({ material }), headers: { 'Content-Type': 'application/json' },
    }),
};

const POLL = { staleTime: 2_000 };

export function useMatCameras() {
  const { orgId } = useAdminOrg();
  return useQuery({ queryKey: ['mat-cams', orgId], queryFn: () => matApi.cameras(orgId!), enabled: !!orgId, refetchInterval: 3_000, ...POLL });
}
export function useMatSummary(minutes: number) {
  const { orgId } = useAdminOrg();
  return useQuery({ queryKey: ['mat-sum', orgId, minutes], queryFn: () => matApi.summary(orgId!, minutes), enabled: !!orgId, refetchInterval: 10_000, ...POLL });
}
export function useMatMetrics(minutes: number, camera?: string) {
  const { orgId } = useAdminOrg();
  return useQuery({ queryKey: ['mat-met', orgId, minutes, camera], queryFn: () => matApi.metrics(orgId!, minutes, camera), enabled: !!orgId, refetchInterval: 10_000, ...POLL });
}
export function useMatEvents(limit = 30) {
  const { orgId } = useAdminOrg();
  return useQuery({ queryKey: ['mat-ev', orgId, limit], queryFn: () => matApi.events(orgId!, limit), enabled: !!orgId, refetchInterval: 4_000, ...POLL });
}

export const decisionOf = (e: VisionEvent): MatDecision | null =>
  e.detail && typeof e.detail === 'object' && 'decision' in e.detail ? (e.detail as unknown as MatDecision) : null;

/** Categorical, never colour-alone: swatch + word everywhere it is used. */
export const GRAVEL_COLOR = '#2a78d6';
export const SAND_COLOR = '#c0479d';
export const colorOfDecision = (d: string | undefined) => (d === 'gravel' ? GRAVEL_COLOR : d === 'sand' ? SAND_COLOR : '#8a94a0');
