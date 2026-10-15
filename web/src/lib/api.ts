// Typed REST client for the v1 API surface.
// v4 T5 (ADR-12): the bearer token is an OIDC access token (or an APP_ENV=dev
// demo token) held IN MEMORY ONLY — nothing touches localStorage/sessionStorage.
// A page reload re-authenticates through the IdP SSO cookie (silent renew)
// or falls back to the sign-in wall.

import type {
  Alarm, AlarmRule, Command, CommandStatus, Health, Insight, SystemHealth, TagInfo, TagValue,
} from '../types';

let memToken = '';

export function getToken(): string {
  return memToken;
}

export function setSessionToken(token: string): void {
  memToken = token;
}

export type SessionRole = 'owner' | 'admin' | 'operator' | 'viewer' | 'none';

export interface MeResponse {
  user: { sub: string; display_name: string };
  role: SessionRole | string;
  kind: 'dev' | 'oidc';
  orgs: { org_id: string; role: string }[];
  memberships: { org_id: string; org_name: string | null; role: string; permissions: string[] }[];
}

/** Called once after a request fails with 401 — wired by features/auth/oidc
 * to drop the session and surface the sign-in wall. */
export let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init.body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : undefined;
    throw new ApiError(res.status, data, detail ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export interface CommandRequest {
  tag: string;
  value: number | boolean;
  ttl_s?: number;
  idempotency_key?: string;
}

export interface CommandResponse {
  command_id: string;
}

/** 409 body shape when a command for the same tag is in-flight. */
export interface ConflictBody {
  active_command_id?: string;
}

export const api = {
  health: () => request<Health>('/api/health'),
  systemHealth: () => request<SystemHealth>('/api/system/health'),
  me: () => request<MeResponse>('/api/me'),
  tags: () => request<TagInfo[]>('/api/tags'),
  latestAll: () => request<(TagValue & { name: string })[]>('/api/tags/latest'),
  alarmRules: () => request<AlarmRule[]>('/api/alarm-rules'),
  history: (name: string, params: { from?: string; to?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<{ v: number | boolean; q: string; ts: string }[]>(
      `/api/tags/${encodeURIComponent(name)}/history${qs ? `?${qs}` : ''}`,
    );
  },
  alarms: () => request<Alarm[]>('/api/alarms'),
  availability: (name: string, params: { from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const qs = q.toString();
    return request<{
      name: string; from: string | null; to: string | null;
      samples: number; good_frac: number | null;
      uptime: number | null; down_s: number | null;
    }>(`/api/tags/${encodeURIComponent(name)}/availability${qs ? `?${qs}` : ''}`);
  },
  insights: (
    params: { state?: string; kind?: string; tag?: string; from?: string; to?: string } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.state) q.set('state', params.state);
    if (params.kind) q.set('kind', params.kind);
    if (params.tag) q.set('tag', params.tag);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const qs = q.toString();
    return request<Insight[]>(`/api/insights${qs ? `?${qs}` : ''}`);
  },
  ackAlarm: (id: Alarm['id']) =>
    request<unknown>(`/api/alarms/${encodeURIComponent(String(id))}/ack`, { method: 'POST' }),
  postCommand: (body: CommandRequest) =>
    request<CommandResponse>('/api/commands', { method: 'POST', body: JSON.stringify(body) }),
  getCommand: (id: string) =>
    request<Command & { status: CommandStatus }>(`/api/commands/${encodeURIComponent(id)}`),
  listCommands: (limit = 20) =>
    request<Command[]>(`/api/commands?limit=${encodeURIComponent(String(limit))}`),
};

// ---------------------------------------------------------------------------
// Admin surface (v4 T10, CONTRACT.v2 §3) — org-scoped member:manage /
// config:write / audit:read routes. Mutations are admin|owner only; the UI
// role-gates before fetching so an operator never trips a 403.
// ---------------------------------------------------------------------------
export interface V2List<T> { items: T[]; next_cursor: string | null }
export interface AdminOrg { id: string; name: string; role: string; created_at: string }
export interface AdminSite { id: string; name: string; code: string; timezone: string }
export interface AdminTag { id: string; path: string; name: string; type: string; unit?: string }
export interface AdminRule {
  id: string; tag_id: string; name: string; kind: string;
  threshold: number | null; stale_s: number | null; deadband: number;
  severity: string; enabled: boolean;
}
export interface Member {
  user_id: string; role: string; sub: string;
  display_name: string | null; email: string | null; disabled: boolean;
}
export interface Invite {
  id: string; email: string; role: string;
  expires_at: string; accepted_at: string | null;
}
export interface AuditRow {
  seq: number; at: string; actor: string; action: string;
  target: unknown; detail: unknown; hash: string;
}
export interface AdminEdge {
  id: string; name: string; status: string;
  last_hb: string | null; clock_ok: boolean | null;
  buffer_depth: number; adapter: string | null;
  credential_version: number; needs_rotation: boolean;
}
export interface SiteHealth {
  edges: AdminEdge[];
  buffer_depth?: number; clock_ok?: boolean; adapter?: string | null;
}
export interface RuleInput {
  name: string; tag_id: string; kind: string;
  threshold?: number | null; stale_s?: number | null;
  deadband?: number; severity: string; enabled?: boolean;
}

const v2 = (org: string, path: string) =>
  `/api/v1/orgs/${encodeURIComponent(org)}${path}`;

export const adminApi = {
  org: (org: string) => request<AdminOrg>(v2(org, '')),
  sites: (org: string) => request<V2List<AdminSite>>(v2(org, '/sites')),
  siteTags: (org: string, site: string) =>
    request<V2List<AdminTag>>(v2(org, `/sites/${site}/tags`)),
  rules: (org: string, site: string) =>
    request<V2List<AdminRule>>(v2(org, `/sites/${site}/alarm-rules`)),
  createRule: (org: string, site: string, body: RuleInput) =>
    request<{ rule: AdminRule }>(v2(org, `/sites/${site}/alarm-rules`), {
      method: 'POST', body: JSON.stringify(body),
    }),
  patchRule: (org: string, site: string, id: string, body: Partial<RuleInput>) =>
    request<{ rule: AdminRule }>(v2(org, `/sites/${site}/alarm-rules/${id}`), {
      method: 'PATCH', body: JSON.stringify(body),
    }),
  deleteRule: (org: string, site: string, id: string) =>
    request<void>(v2(org, `/sites/${site}/alarm-rules/${id}`), { method: 'DELETE' }),
  members: (org: string) => request<V2List<Member>>(v2(org, '/members')),
  patchMember: (org: string, uid: string, body: { role?: string; disabled?: boolean }) =>
    request<{ member: Member }>(v2(org, `/members/${uid}`), {
      method: 'PATCH', body: JSON.stringify(body),
    }),
  removeMember: (org: string, uid: string) =>
    request<unknown>(v2(org, `/members/${uid}`), { method: 'DELETE' }),
  invites: (org: string) => request<V2List<Invite>>(v2(org, '/invites')),
  createInvite: (org: string, body: { email: string; role: string }) =>
    request<{ invite: Invite; token: string }>(v2(org, '/invites'), {
      method: 'POST', body: JSON.stringify(body),
    }),
  revokeInvite: (org: string, id: string) =>
    request<unknown>(v2(org, `/invites/${id}`), { method: 'DELETE' }),
  audit: (org: string, params: { from?: string; to?: string; action?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    q.set('format', 'json');
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.action) q.set('action', params.action);
    if (params.limit != null) q.set('limit', String(params.limit));
    return request<V2List<AuditRow>>(v2(org, `/audit?${q.toString()}`));
  },
  /** Audit CSV download — streams through fetch with the session token and
   * hands the caller a Blob for an object-URL anchor. */
  siteHealth: (org: string, site: string) =>
    request<SiteHealth>(v2(org, `/sites/${site}/health`)),
  edges: (org: string, site: string) =>
    request<V2List<AdminEdge>>(v2(org, `/sites/${site}/edges`)),
  auditCsv: async (org: string, params: { from?: string; to?: string } = {}): Promise<Blob> => {
    const q = new URLSearchParams();
    q.set('format', 'csv');
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const res = await fetch(v2(org, `/audit?${q.toString()}`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new ApiError(res.status, null, `HTTP ${res.status}`);
    return res.blob();
  },
  // Device (edge) lifecycle — doc 17 §5. config:write (admin|owner).
  // The MQTT secret is returned ONCE by provision/rotate; the server keeps
  // only its fingerprint, so the UI must show it immediately and never store it.
  devices: (org: string, site: string) =>
    request<V2List<Device>>(v2(org, `/sites/${site}/edges`)),
  provisionDevice: (org: string, site: string, name: string) =>
    request<{ edge: Device; secret: string }>(v2(org, `/sites/${site}/edges`), {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  rotateDevice: (org: string, site: string, id: string) =>
    request<{ edge_id: string; credential_version: number; mqtt_username: string; secret: string }>(
      v2(org, `/sites/${site}/edges/${id}/rotate`), { method: 'POST' }),
  disableDevice: (org: string, site: string, id: string) =>
    request<unknown>(v2(org, `/sites/${site}/edges/${id}/disable`), { method: 'POST' }),
};

/** Edge row as returned by the edges list/provision endpoints (_edge_json). */
export interface Device {
  id: string; org_id: string; site_id: string; name: string; status: string;
  mqtt_username: string; credential_version: number;
  last_hb_at: string | null; clock_ok: boolean | null; adapter: string | null;
  needs_rotation: boolean;
}
