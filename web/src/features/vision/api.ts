// REST client for the model registry, camera model pin and class config
// (backend/app/vision/{models,classes}.py).

import { request, requestBlob } from '../../lib/api';
import type { ClassConfig, ClassDiff } from './logic';

export type Task = 'detect' | 'segment';
export type VersionStatus = 'processing' | 'draft' | 'active' | 'archived' | 'failed';

export interface VisionModel { id: string; name: string; task: Task; version_count?: number; active_version?: number | null }
export interface ModelVersion {
  id: string; model_id: string; version: number; status: VersionStatus; task: Task | null;
  source_format: 'onnx' | 'pt'; sha256: string | null; size_bytes: number | null; imgsz: number | null;
  classes: string[] | null; class_count: number | null; ultralytics_version: string | null;
  notes: string | null; failure_reason: string | null; license_attested_at: string | null; created_at: string;
}
export interface Pin {
  camera_id: string; model_version_id: string | null; model_id?: string; version?: number;
  classes?: string[]; placement?: 'auto' | 'edge' | 'cloud'; class_config?: ClassConfig;
}
export interface Preset { id: string; model_id: string; name: string; class_config: ClassConfig }

// model_test op result (backend sanitizes every field — roadmap 9.10)
export interface Detection {
  class_id: number; class: string; score: number;
  bbox: [number, number, number, number];        // normalized x,y,w,h
  polygon?: [number, number][];                  // normalized, <=64 points
}
export interface ModelTestResult { ms: number; engine: string | null; detections: Detection[] }

// GET .../edges/{edge}/capabilities — null until the edge's first vision/caps report
export interface EdgeCapabilities {
  capabilities: null | {
    reported_at: string; cpu_cores: number; ram_mb: number | null;
    device: string | null; providers: string[]; loaded: string[];
  };
}

const call = request;

const org = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}`;
const vm = (o: string) => `${org(o)}/vision/models`;
const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

export const visionApi = {
  models: (o: string) => call<{ items: VisionModel[] }>(vm(o)),
  createModel: (o: string, b: { name: string; task: Task }) => call<{ model: VisionModel }>(vm(o), json('POST', b)),
  deleteModel: (o: string, id: string) => call<void>(`${vm(o)}/${id}`, { method: 'DELETE' }),
  versions: (o: string, m: string) => call<{ items: ModelVersion[] }>(`${vm(o)}/${m}/versions`),
  upload: (o: string, m: string, file: File) =>
    call<{ version: ModelVersion }>(`${vm(o)}/${m}/versions?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }),
  setClasses: (o: string, m: string, v: string, names: string[]) =>
    call<{ version: ModelVersion }>(`${vm(o)}/${m}/versions/${v}/classes`, json('POST', { names })),
  activate: (o: string, m: string, v: string) =>
    call<{ version: ModelVersion }>(`${vm(o)}/${m}/versions/${v}/activate`, json('POST', { attest: true })),
  archive: (o: string, m: string, v: string) =>
    call<{ version: ModelVersion }>(`${vm(o)}/${m}/versions/${v}/archive`, { method: 'POST' }),
  deleteVersion: (o: string, m: string, v: string) => call<void>(`${vm(o)}/${m}/versions/${v}`, { method: 'DELETE' }),
  pin: (o: string, cam: string) => call<Pin>(`${org(o)}/cameras/${cam}/model`),
  setPin: (o: string, cam: string, b: { model_version_id: string; placement?: string }) =>
    call<Pin & { diff: ClassDiff | null }>(`${org(o)}/cameras/${cam}/model`, json('PUT', b)),
  unpin: (o: string, cam: string) => call<void>(`${org(o)}/cameras/${cam}/model`, { method: 'DELETE' }),
  patchClasses: (o: string, cam: string, class_config: ClassConfig) =>
    call<{ class_config: ClassConfig }>(`${org(o)}/cameras/${cam}/classes`, json('PATCH', { class_config })),
  presets: (o: string, m: string) => call<{ items: Preset[] }>(`${vm(o)}/${m}/presets`),
  createPreset: (o: string, m: string, name: string, class_config: ClassConfig) =>
    call<{ preset: Preset }>(`${vm(o)}/${m}/presets`, json('POST', { name, class_config })),
  applyPreset: (o: string, cam: string, preset_id: string) =>
    call<{ class_config: ClassConfig }>(`${org(o)}/cameras/${cam}/classes/apply-preset`, json('POST', { preset_id })),
  // one image through a draft|active version on a live edge (plan M1-05 T4).
  // Raw image bytes POSTed with the file's own MIME; the edge never sees a URL.
  test: (o: string, m: string, v: string, edge: string, file: Blob, signal?: AbortSignal) =>
    call<ModelTestResult>(`${vm(o)}/${m}/versions/${v}/test?edge=${encodeURIComponent(edge)}`,
      { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' }, signal }),
  capabilities: (o: string, edge: string) =>
    call<EdgeCapabilities>(`${org(o)}/edges/${edge}/capabilities`),
  // vision rules (roadmap 9.7) — written only in the backend, delivered via cfg
  rules: (o: string, camera?: string) =>
    call<{ items: VisionRule[] }>(`${vr(o)}${camera ? `?camera=${encodeURIComponent(camera)}` : ''}`),
  cameraRules: (o: string, cam: string) =>
    call<{ items: VisionRule[] }>(`${org(o)}/cameras/${cam}/rules`),
  rule: (o: string, id: string) => call<{ rule: VisionRule }>(`${vr(o)}/${id}`),
  createRule: (o: string, b: RuleBody) => call<{ rule: VisionRule }>(vr(o), json('POST', b)),
  patchRule: (o: string, id: string, b: Partial<RuleBody>) =>
    call<{ rule: VisionRule }>(`${vr(o)}/${id}`, json('PATCH', b)),
  deleteRule: (o: string, id: string) => call<void>(`${vr(o)}/${id}`, { method: 'DELETE' }),
  // detection events + review (roadmap 9.8)
  events: (o: string, f: EventFilter) => {
    const q = new URLSearchParams();
    if (f.camera) q.set('camera', f.camera);
    if (f.class_id != null) q.set('class_id', String(f.class_id));
    if (f.rule) q.set('rule', f.rule);
    if (f.kind) q.set('kind', f.kind);
    if (f.outcome) q.set('outcome', f.outcome);
    if (f.since) q.set('since', f.since);
    if (f.until) q.set('until', f.until);
    if (f.cursor) q.set('cursor', f.cursor);
    if (f.limit != null) q.set('limit', String(f.limit));
    const s = q.toString();
    return call<{ items: VisionEvent[]; next_cursor: string | null }>(`${ve(o)}${s ? `?${s}` : ''}`);
  },
  event: (o: string, id: string) => call<{ event: VisionEvent }>(`${ve(o)}/${id}`),
  thumbUrl: (o: string, id: string) => `${ve(o)}/${id}/thumb`,
  review: (o: string, id: string, b: { verdict: 'correct' | 'wrong'; corrected_class_id?: number | null }) =>
    call<{ ok: boolean }>(`${ve(o)}/${id}/review`, json('POST', b)),
  bulkReview: (o: string, event_ids: string[], verdict: 'correct' | 'wrong') =>
    call<{ updated: number }>(`${ve(o)}/bulk-review`, json('POST', { event_ids, verdict })),
  exportWrong: (o: string, camera?: string): Promise<Blob> =>
    requestBlob(`${ve(o)}/export.zip${camera ? `?camera=${encodeURIComponent(camera)}` : ''}`)
      .then((r) => r.blob),
};

const vr = (o: string) => `${org(o)}/vision/rules`;
const ve = (o: string) => `${org(o)}/vision/events`;

// ---- types for the rules + events surfaces -------------------------------
export interface RuleZonePoint extends Array<number> { 0: number; 1: number }
export interface RuleConditions {
  class_ids: number[]; min_score?: number; zone?: number[][]; min_area?: number;
  hold_frames?: number; hold_ms?: number; count_in_zone?: number;
}
export type RuleAction =
  | { kind: 'plc_write'; tag_path: string; value: number | boolean; pulse_ms?: number }
  | { kind: 'counter'; tag_path: string; by?: number }
  | { kind: 'alarm'; severity?: 'info' | 'warning' | 'critical'; message?: string | null }
  | { kind: 'notify'; message?: string | null }
  | { kind: 'snapshot' };

export interface RuleBody {
  camera_id?: string; name: string; enabled?: boolean; dry_run?: boolean;
  allow_cloud_write?: boolean; offline_write_window_s?: number | null;
  conditions: RuleConditions; actions: RuleAction[];
}
export interface VisionRule extends RuleBody {
  id: string; camera_id: string; model_version_id: string | null;
  enabled: boolean; dry_run: boolean; allow_cloud_write: boolean;
  created_at: string; updated_at: string;
}

export type EventKind = 'rule_fire' | 'blocked' | 'dry_run' | 'alert_object' | 'material';
export interface VisionEvent {
  id: string; camera_id: string; rule_id: string | null; kind: EventKind;
  class_id: number | null; score: number | null; bbox: number[] | null;
  model_version_id: string | null; has_thumb: boolean; severity: string | null;
  blocked_reason: string | null; detail: Record<string, unknown> | null;
  fired_at: string;
  review: { verdict: 'correct' | 'wrong'; corrected_class_id: number | null } | null;
}
export interface EventFilter {
  camera?: string; class_id?: number; rule?: string; kind?: string;
  outcome?: 'reviewed' | 'unreviewed' | 'correct' | 'wrong';
  since?: string; until?: string; cursor?: string; limit?: number;
}

/** Rule -> the human sentence the builder shows live ("When person ≥70% in
 * zone for 5 frames → write …"). */
export function describeRule(r: RuleBody, className: (id: number) => string): string[] {
  const parts: string[] = [];
  parts.push(r.conditions.class_ids.map(className).join(' / ') || '?');
  if (r.conditions.min_score != null) parts.push(`≥ ${Math.round(r.conditions.min_score * 100)}%`);
  if (r.conditions.zone?.length) parts.push('zone');
  if (r.conditions.hold_frames && r.conditions.hold_frames > 1) parts.push(`${r.conditions.hold_frames} frames`);
  if (r.conditions.hold_ms) parts.push(`${r.conditions.hold_ms} ms`);
  if (r.conditions.count_in_zone) parts.push(`×${r.conditions.count_in_zone}`);
  return parts;
}
