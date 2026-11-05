// REST client for data sources / tags / test / browse (backend/app/datasources/routes.py).

import { ApiError, request } from '../../lib/api';
import type { Protocol } from './logic';

export interface DataSource {
  id: string; edge_id: string; name: string; protocol: Protocol;
  connection: Record<string, unknown>; poll_ms: number; enabled: boolean;
  has_secret: boolean; status: string | null; status_detail: string | null; status_at: string | null;
  tag_count?: number;
}
export interface SourceTag {
  id: string; source_id: string | null; line: string | null; device: string | null;
  path: string; name: string; type: 'bool' | 'number'; unit: string | null; writable: boolean;
  min: number | null; max: number | null; scale: number | null; offset: number | null;
  address: unknown;
}
export interface SourceInput {
  name: string; protocol: Protocol; connection: Record<string, unknown>;
  poll_ms?: number; enabled?: boolean; secrets?: Record<string, unknown> | null;
}
export interface TagInput {
  line: string; device: string; signal: string; address: string | Record<string, unknown>; type: 'bool' | 'number';
  unit?: string | null; writable?: boolean; min?: number | null; max?: number | null; scale?: number | null;
}
export interface TestResult { ok: boolean; detail?: string; sample?: unknown }
export interface BrowseItem { node_id: string; name: string; node_class: string; data_type: string | null; writable: boolean }

const call = request;

const edge = (org: string, e: string) => `/api/v1/orgs/${encodeURIComponent(org)}/edges/${encodeURIComponent(e)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const dsApi = {
  sources: (org: string, e: string) => call<{ items: DataSource[] }>(`${edge(org, e)}/sources`),
  createSource: (org: string, e: string, b: SourceInput) =>
    call<{ source: DataSource; config_version: number }>(`${edge(org, e)}/sources`, json('POST', b)),
  patchSource: (org: string, e: string, id: string, b: Partial<SourceInput>) =>
    call<{ source: DataSource }>(`${edge(org, e)}/sources/${id}`, json('PATCH', b)),
  deleteSource: (org: string, e: string, id: string) =>
    call<void>(`${edge(org, e)}/sources/${id}`, { method: 'DELETE' }),
  tags: (org: string, e: string, s: string) => call<{ items: SourceTag[] }>(`${edge(org, e)}/sources/${s}/tags`),
  createTag: (org: string, e: string, s: string, b: TagInput) =>
    call<{ tag: SourceTag }>(`${edge(org, e)}/sources/${s}/tags`, json('POST', b)),
  patchTag: (org: string, e: string, s: string, id: string, b: Record<string, unknown>) =>
    call<{ tag: SourceTag }>(`${edge(org, e)}/sources/${s}/tags/${id}`, json('PATCH', b)),
  deleteTag: (org: string, e: string, s: string, id: string) =>
    call<void>(`${edge(org, e)}/sources/${s}/tags/${id}`, { method: 'DELETE' }),
  bulkTags: (org: string, e: string, s: string, csv: string) =>
    call<{ created: number }>(`${edge(org, e)}/sources/${s}/tags:bulk`,
      { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }),
  test: (org: string, e: string, b: { protocol: Protocol; connection: Record<string, unknown>; secrets?: Record<string, unknown> | null; tags?: unknown[] }) =>
    call<TestResult>(`${edge(org, e)}/sources:test`, json('POST', b)),
  latest: (org: string, site: string) =>
    call<{ items: { tag_id: string; v: number | boolean | null; q: string; ts: string }[] }>(`/api/v1/orgs/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}/tags/latest`),
  browse: (org: string, e: string, s: string, nodeId: string | null) =>
    call<{ items: BrowseItem[] }>(`${edge(org, e)}/sources/${s}/browse`, json('POST', { node_id: nodeId })),
};

/** 422 {detail:'invalid_field', field, message} -> field-level message. */
export function fieldError(e: unknown): { field: string; message: string } | null {
  if (e instanceof ApiError && e.status === 422) {
    const b = e.body as { detail?: string; field?: string; message?: string } | null;
    if (b?.detail === 'invalid_field' && b.field && b.message) return { field: b.field, message: b.message };
  }
  return null;
}
