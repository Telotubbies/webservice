// REST client for the model registry, camera model pin and class config
// (backend/app/vision/{models,classes}.py).

import { ApiError, getToken } from '../../lib/api';
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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const o = data && typeof data === 'object' ? data as { detail?: unknown; message?: unknown } : {};
    throw new ApiError(res.status, data, String(o.message ?? o.detail ?? `HTTP ${res.status}`));
  }
  return data as T;
}

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
};
