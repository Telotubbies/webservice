// Plant model client: the uploaded .glb of the site + the operator-made
// mapping from its nodes to live equipment (kind + tag bindings). Mirrors
// backend/app/plant (kinds are served by the API — one source of truth).

import { request, requestBlob, v2, ApiError } from './api';
import { getScope } from './scope';
import { live } from './live';

export type TagType = 'bool' | 'number';

export interface RoleSpec { type: TagType; label: string; writable: boolean }
export interface ParamSpec {
  type: 'number' | 'bool' | 'enum' | 'vec3';
  label: string; min?: number; max?: number; default?: unknown; options?: string[];
}
export interface KindSpec {
  label: string;
  behavior: 'spin' | 'belt' | 'level' | 'open' | 'tint' | 'flow' | 'slide';
  roles: Record<string, RoleSpec>;
  params: Record<string, ParamSpec>;
}
export type Kinds = Record<string, KindSpec>;

export interface PlantModel {
  id: string; site_id: string; name: string; filename: string; size_bytes: number;
  sha256: string; node_count: number; active: boolean; created_at: string; parts?: number;
}

export interface PlantPart {
  id?: string;
  label: string;
  kind: string;
  /** glTF node indices (stable for a given file) */
  nodes: number[];
  /** role -> tag path of the site (slashes), e.g. batch/agg/belt1/running */
  bindings: Record<string, string>;
  /** motion parameters (axis, travel, rpm, fluid…) — see KindSpec.params */
  params?: Record<string, unknown>;
}

export interface PlantTag { path: string; name: string; type: TagType; writable: boolean; unit?: string }

function scopeOrThrow() {
  const s = getScope();
  if (!s) throw new ApiError(0, null, 'no active scope');
  return s;
}
const site = (p: string) => {
  const s = scopeOrThrow();
  return v2(s.orgId, `/sites/${s.siteId}${p}`);
};

export const plantApi = {
  kinds: () => request<{ kinds: Kinds }>('/api/v1/plant-kinds').then((r) => r.kinds),
  list: () => request<{ items: PlantModel[] }>(site('/plant-models')).then((r) => r.items),
  active: () => request<{ model: PlantModel | null; parts: PlantPart[] }>(site('/plant-models/active')),
  get: (id: string) => request<{ model: PlantModel; parts: PlantPart[] }>(site(`/plant-models/${id}`)),
  /** raw body upload (no multipart); the server validates the glTF header */
  upload: async (file: File, name?: string): Promise<PlantModel> => {
    const q = new URLSearchParams({ filename: file.name });
    if (name) q.set('name', name);
    const r = await request<{ model: PlantModel }>(site(`/plant-models?${q}`), {
      method: 'POST', body: file, headers: { 'Content-Type': 'model/gltf-binary' },
    });
    return r.model;
  },
  rename: (id: string, name: string) =>
    request<{ model: PlantModel }>(site(`/plant-models/${id}`), { method: 'PATCH', body: JSON.stringify({ name }) }),
  activate: (id: string) => request<{ model: PlantModel }>(site(`/plant-models/${id}/activate`), { method: 'POST' }),
  remove: (id: string) => request<void>(site(`/plant-models/${id}`), { method: 'DELETE' }),
  putParts: (id: string, parts: PlantPart[]) =>
    request<{ parts: PlantPart[] }>(site(`/plant-models/${id}/parts`), {
      method: 'PUT',
      body: JSON.stringify({
        parts: parts.map(({ label, kind, nodes, bindings, params }) => ({ label, kind, nodes, bindings, params: params ?? {} })),
      }),
    }).then((r) => r.parts),
  /** authenticated download -> object URL for GLTFLoader (revoke when done) */
  fileUrl: async (id: string): Promise<string> => {
    const { blob } = await requestBlob(site(`/plant-models/${id}/file`));
    return URL.createObjectURL(blob);
  },
  tags: () => request<{ items: PlantTag[] }>(site('/tags')).then((r) => r.items),
  /** simulated tags for equipment without a real one (own sim source on the edge) */
  createSimTags: (tags: unknown[]) =>
    request<{ created: string[]; existing: string[] }>(site('/plant-sim-tags'), { method: 'POST', body: JSON.stringify({ tags }) }),
};

// --- live-store helpers ---------------------------------------------------

/** Site code prefix of the live store's dotted tag names (plant1.…). */
export function sitePrefix(): string {
  return live.tags[0]?.name.split('.')[0] ?? 'plant1';
}

/** tag path (slashes) -> live-store name (dots, site-prefixed) */
export function liveName(path: string): string {
  return `${sitePrefix()}.${path.replace(/\//g, '.')}`;
}

export function liveValue(path: string | undefined): number | boolean | undefined {
  return path ? live.latest.get(liveName(path))?.v : undefined;
}

export const truthy = (v: number | boolean | undefined): boolean => v === true || (typeof v === 'number' && v > 0);

// --- bundled demo plant ---------------------------------------------------
// Used when the site has no active model: the Centrale a Beton shipped in
// /models, mapped with suggested parts. Node indices are specific to that
// file; "Save as my plant" in the editor uploads it and persists the mapping.

export const DEMO_MODEL_URL = '/models/centrale-beton.glb';

export const DEMO_PARTS: PlantPart[] = [
  { label: 'Aggregate belt', kind: 'conveyor', nodes: [2138],
    bindings: { run: 'batch/agg/belt1/running', speed: 'batch/agg/belt1/speed_mps' } },
  { label: 'Aggregate bin 1', kind: 'vessel', nodes: [3174], bindings: { level: 'batch/agg/bin1/level_pct' } },
  { label: 'Aggregate bin 2', kind: 'vessel', nodes: [4491], bindings: { level: 'batch/agg/bin2/level_pct' } },
  { label: 'Aggregate bin 3', kind: 'vessel', nodes: [4825], bindings: { level: 'batch/agg/bin3/level_pct' } },
  { label: 'Aggregate bin 4', kind: 'vessel', nodes: [5113], bindings: { level: 'batch/agg/bin4/level_pct' } },
  { label: 'Cement silo 1', kind: 'vessel', nodes: [8109],
    bindings: { level: 'batch/cem/silo1/level_pct', high: 'batch/cem/silo1/high_level', low: 'batch/cem/silo1/low_level' } },
  { label: 'Cement silo 2', kind: 'vessel', nodes: [8317],
    bindings: { level: 'batch/cem/silo2/level_pct', high: 'batch/cem/silo2/high_level', low: 'batch/cem/silo2/low_level' } },
  { label: 'Cement silo 3', kind: 'vessel', nodes: [8403],
    bindings: { level: 'batch/cem/silo3/level_pct', high: 'batch/cem/silo3/high_level', low: 'batch/cem/silo3/low_level' } },
  { label: 'Cement silo 4', kind: 'vessel', nodes: [8489],
    bindings: { level: 'batch/cem/silo4/level_pct', high: 'batch/cem/silo4/high_level', low: 'batch/cem/silo4/low_level' } },
  { label: 'Cement weigh hopper', kind: 'vessel', nodes: [117], bindings: { weight: 'batch/cem/weigh1/weight_kg' } },
  { label: 'Liquid weigh tank', kind: 'vessel', nodes: [7630], bindings: { weight: 'batch/liq/weigh1/weight_kg' } },
  { label: 'Roots blower', kind: 'pump', nodes: [868],
    bindings: { run: 'batch/air/blower1/running', pressure: 'batch/air/blower1/pressure_bar' } },
  { label: 'Admixture pump', kind: 'pump', nodes: [1124, 1128],
    bindings: { run: 'batch/liq/admix1/running', flow: 'batch/liq/admix1/flow_lpm' } },
  { label: 'Mixer', kind: 'mixer', nodes: [8],
    bindings: { run: 'batch/mix/mixer1/running', current: 'batch/mix/mixer1/current_a', door: 'batch/mix/mixer1/door_open' } },
];

