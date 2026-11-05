// Typed REST client for the v1 API surface.
// v4 T5 (ADR-12): the bearer token is an OIDC access token (or an APP_ENV=dev
// demo token) held IN MEMORY ONLY — nothing touches localStorage/sessionStorage.
// A page reload re-authenticates through the IdP SSO cookie (silent renew)
// or falls back to the sign-in wall.

import type {
  Alarm, AlarmRule, Command, CommandStatus, Health, Insight, SystemHealth, TagInfo, TagValue,
} from '../types';

import { scopeHeaders } from './scope';

// ── Session token ────────────────────────────────────────────────────────────

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

/** 401 `mfa_required` / `step_up_required` (spec 2026-10-19 §4): the session
 * is fine but needs a (fresh) second factor — re-auth instead of logging out. */
export let onStepUp: ((reason: 'mfa_required' | 'step_up_required') => void) | null = null;
export function setStepUpHandler(fn: typeof onStepUp): void {
  onStepUp = fn;
}

// ── Request plumbing ─────────────────────────────────────────────────────────

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init.body != null) headers['Content-Type'] = 'application/json';
  // org-aware v1 endpoints read the active org/site from these headers;
  // /api/v1/orgs/... paths carry the org in the path and ignore them.
  if (!path.startsWith('/api/v1/')) Object.assign(headers, scopeHeaders());
  // caller-supplied headers (e.g. an upload's real Content-Type) win.
  Object.assign(headers, init.headers);

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : undefined;
    if (res.status === 401) {
      if ((detail === 'mfa_required' || detail === 'step_up_required') && onStepUp) onStepUp(detail);
      else onUnauthorized?.();
    }
    throw new ApiError(res.status, data, detail ?? `HTTP ${res.status}`);
  }
  return data as T;
}

/** Binary variant of request(): same auth/scope/401 contract, resolves the
 * raw Blob plus the Content-Disposition filename (null when absent). */
export async function requestBlob(
  path: string, init: RequestInit = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!path.startsWith('/api/v1/')) Object.assign(headers, scopeHeaders());
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    let detail: string | undefined;
    try {
      detail = String((await res.json() as { detail?: unknown }).detail);
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, null, detail ?? `HTTP ${res.status}`);
  }
  const m = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: m?.[1] ?? null };
}

// ── v1 API surface ───────────────────────────────────────────────────────────

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

// ── Admin surface (v4 T10, CONTRACT.v2 §3) ───────────────────────────────────
// Org-scoped member:manage / config:write / audit:read routes. Mutations are
// admin|owner only; the UI role-gates before fetching so an operator never
// trips a 403.
export interface V2List<T> { items: T[]; next_cursor: string | null }
export interface AdminOrg { id: string; name: string; role: string; created_at: string }
export interface AdminSite { id: string; name: string; code: string; timezone: string }
export interface AdminTag { id: string; path: string; name: string; type: string; unit?: string }
export interface AdminRule {
  id: string; tag_id: string; name: string; kind: string;
  threshold: number | null; stale_s: number | null; window_s?: number | null; deadband: number;
  severity: string; enabled: boolean;
}
export interface ApiKey {
  id: string; name: string; prefix: string; role: string; created_at: string;
  expires_at: string | null; last_used_at: string | null; revoked_at: string | null;
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
  threshold?: number | null; stale_s?: number | null; window_s?: number | null;
  deadband?: number; severity: string; enabled?: boolean;
}

export const v2 = (org: string, path: string) =>
  `/api/v1/orgs/${encodeURIComponent(org)}${path}`;

export interface DashboardRow {
  id: string; title: string; description: string; shared: boolean; mine: boolean;
  body: Record<string, unknown>; updated_at: string;
}
export type DashboardInput = Pick<DashboardRow, 'title' | 'description' | 'shared' | 'body'> & { id?: string };

export interface SloCorrection { id: string; starts_at: string; ends_at: string; reason: string }
export interface SloDef {
  id: string; name: string; description: string; tag: string | null; tag_id: string;
  target: number; warning: number; updated_at: string; corrections: SloCorrection[];
}
export interface SloInput { name: string; tag: string; target: number; warning?: number; description?: string }
export interface SloStatus { id: string; samples: number; excluded: number; sli: number | null; covered_s: number }
export interface CreatedOrg {
  org: { id: string; name: string; slug: string; timezone: string; language: string };
  site: { id: string; name: string; code: string };
  role: string;
}

export const orgApi = {
  create: (body: { name: string; slug: string; timezone: string; language: 'en' | 'th' }) =>
    request<CreatedOrg>('/api/v1/orgs', { method: 'POST', body: JSON.stringify(body) }),
};

// ── Onboarding checklist (roadmap 1.3) — six derived steps per org ───────────
export interface OnboardingStep { id: string; done: boolean; href: string }
export const onboardingApi = {
  get: (org: string) =>
    request<{ steps: OnboardingStep[]; done: number; total: number }>(
      v2(org, '/onboarding')),
};

// ── Legal consent (roadmap 8.1) — required versions + this user's rows ───────
export interface ConsentStatus {
  required: Record<string, string>;
  given: Record<string, { version: string; at: string }>;
  missing: string[];
  current: boolean;
}
export const consentApi = {
  get: () => request<ConsentStatus>('/api/v1/consents'),
  post: (doc: string, version: string) =>
    request<{ consent: { doc: string; version: string; at: string } }>(
      '/api/v1/consents', { method: 'POST', body: JSON.stringify({ doc, version }) }),
};

// ── Unified event feed + edge logs + tag query/stats + public status ─────────
// (Phase 4 "make real" pages).
export interface FeedEvent {
  id: string; ts: string; type: 'alarm' | 'command' | 'config' | 'incident';
  action: string; severity: string | null;
  site_id: string | null; tag_id: string | null; tag: string | null;
  actor: string | null; subject: string | null;
}
export interface EventsQuery {
  type?: string; site?: string; tag?: string; from?: string; to?: string;
  cursor?: string; limit?: number;
}
const qs = (o: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
export const eventsApi = {
  list: (org: string, p: EventsQuery = {}) =>
    request<V2List<FeedEvent>>(v2(org, `/events${qs(p as Record<string, string | number | undefined>)}`)),
};

export interface EdgeLogRow {
  id: number; ts: string; level: 'debug' | 'info' | 'warn' | 'error';
  source: string; msg: string; edge_id: string; site_id: string;
}
export const edgeLogsApi = {
  list: (org: string, p: EventsQuery & { edge?: string; level?: string; q?: string } = {}) =>
    request<V2List<EdgeLogRow>>(v2(org, `/edge-logs${qs(p as Record<string, string | number | undefined>)}`)),
};

export interface TagHistoryRow { ts: string; v: number | boolean; q: string }
export interface TagBucket { ts: string; min: number | null; max: number | null; avg: number | null; n: number }
export interface TagRef { id: string; path: string; name: string; unit: string | null }
export const tagQueryApi = {
  history: (org: string, site: string, p: {
    tag: string; from?: string; to?: string; agg?: 'raw' | 'min' | 'max' | 'avg';
    bucket_s?: number; limit?: number;
  }) =>
    request<{ tag: TagRef; from: string; to: string; agg: string; bucket_s?: number;
              truncated?: boolean; rows: (TagHistoryRow | TagBucket)[] }>(
      v2(org, `/sites/${site}/tag-history${qs(p as Record<string, string | number | undefined>)}`)),
  csvUrl: (org: string, site: string, p: Record<string, string | number | undefined>) =>
    v2(org, `/sites/${site}/tag-history${qs({ ...p, format: 'csv' })}`),
  stats: (org: string, site: string, p: { from?: string; to?: string } = {}) =>
    request<{ from: string; to: string; gap_s: number; items: TagStat[] }>(
      v2(org, `/sites/${site}/tag-stats${qs(p as Record<string, string | number | undefined>)}`)),
};
export interface TagStat {
  tag_id: string; path: string; name: string; unit: string | null; type: string;
  min: number | null; max: number | null; avg: number | null; count: number;
  last: number | boolean; last_ts: string; gaps: number; max_gap_s: number;
}

export interface StatusComponent { name: string; ok: boolean; since: string | null }
export const statusApi = {
  get: () => request<{ status: string; env: string; components: StatusComponent[]; updated_at: string }>(
    '/api/v1/status'),
};

export const sloApi = {
  list: (org: string) => request<V2List<SloDef>>(v2(org, '/slos')),
  status: (org: string, days: number) => request<{ days: number; items: SloStatus[] }>(v2(org, `/slos/status?days=${days}`)),
  create: (org: string, body: SloInput) =>
    request<{ slo: SloDef }>(v2(org, '/slos'), { method: 'POST', body: JSON.stringify(body) }),
  patch: (org: string, id: string, body: Partial<SloInput>) =>
    request<{ slo: SloDef }>(v2(org, `/slos/${id}`), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (org: string, id: string) => request<void>(v2(org, `/slos/${id}`), { method: 'DELETE' }),
  addCorrection: (org: string, id: string, body: { starts_at: string; ends_at: string; reason: string }) =>
    request<{ correction: SloCorrection }>(v2(org, `/slos/${id}/corrections`), { method: 'POST', body: JSON.stringify(body) }),
  deleteCorrection: (org: string, id: string, cid: string) =>
    request<void>(v2(org, `/slos/${id}/corrections/${cid}`), { method: 'DELETE' }),
};

export const dashboardApi = {
  list: (org: string) => request<{ dashboards: DashboardRow[] }>(v2(org, '/dashboards')),
  create: (org: string, b: DashboardInput) =>
    request<unknown>(v2(org, '/dashboards'), { method: 'POST', body: JSON.stringify(b) }),
  update: (org: string, id: string, b: DashboardInput) =>
    request<unknown>(v2(org, `/dashboards/${id}`), { method: 'PUT', body: JSON.stringify(b) }),
  remove: (org: string, id: string) => request<void>(v2(org, `/dashboards/${id}`), { method: 'DELETE' }),
};

export interface DowntimeRow {
  id: string; rule_id: string | null; rule: string | null; description: string;
  starts_at: string; ends_at: string; recurring: boolean; mine: boolean;
}
export type DowntimeInput = Pick<DowntimeRow, 'rule_id' | 'description' | 'starts_at' | 'ends_at' | 'recurring'>;

export const downtimeApi = {
  list: (org: string) =>
    request<{ downtimes: DowntimeRow[]; rules: { id: string; name: string }[] }>(v2(org, '/downtimes')),
  create: (org: string, b: DowntimeInput) =>
    request<unknown>(v2(org, '/downtimes'), { method: 'POST', body: JSON.stringify(b) }),
  end: (org: string, id: string) => request<unknown>(v2(org, `/downtimes/${id}/end`), { method: 'POST' }),
  remove: (org: string, id: string) => request<void>(v2(org, `/downtimes/${id}`), { method: 'DELETE' }),
};

export interface NotebookRow { id: string; title: string; body: string; shared: boolean; mine: boolean; updated_at: string }
export const notebookApi = {
  list: (org: string) => request<{ notebooks: NotebookRow[] }>(v2(org, '/notebooks')),
  create: (org: string, b: Pick<NotebookRow, 'title' | 'body' | 'shared'> & { id?: string }) =>
    request<{ notebook: NotebookRow }>(v2(org, '/notebooks'), { method: 'POST', body: JSON.stringify(b) }),
  update: (org: string, id: string, b: Pick<NotebookRow, 'title' | 'body' | 'shared'> & { base_updated_at?: string }) =>
    request<unknown>(v2(org, `/notebooks/${id}`), { method: 'PUT', body: JSON.stringify(b) }),
  remove: (org: string, id: string) => request<void>(v2(org, `/notebooks/${id}`), { method: 'DELETE' }),
};

export interface TeamRow { id: string; name: string; description: string; members: { user_id: string; name: string }[] }
export const teamApi = {
  list: (org: string) => request<{ teams: TeamRow[] }>(v2(org, '/teams')),
  create: (org: string, b: { name: string; description: string }) =>
    request<{ id: string }>(v2(org, '/teams'), { method: 'POST', body: JSON.stringify(b) }),
  setMembers: (org: string, id: string, user_ids: string[]) =>
    request<unknown>(v2(org, `/teams/${id}/members`), { method: 'PUT', body: JSON.stringify({ user_ids }) }),
  remove: (org: string, id: string) => request<void>(v2(org, `/teams/${id}`), { method: 'DELETE' }),
};

export type IncidentStatus = 'active' | 'acknowledged' | 'resolved';
export type IncidentSeverity = 'info' | 'warning' | 'critical';
export interface IncidentRow {
  id: string; title: string; severity: IncidentSeverity; status: IncidentStatus; created_at: string;
  acked_at: string | null; resolved_at: string | null; alarm_id: string | null; team_id: string | null; team: string | null; mine: boolean;
}
export interface IncidentEvent { kind: 'created' | 'status' | 'note'; body: string; at: string; who: string }
export const incidentApi = {
  list: (org: string) => request<{ incidents: IncidentRow[]; teams: { id: string; name: string }[] }>(v2(org, '/incidents')),
  get: (org: string, id: string) => request<{ incident: IncidentRow; events: IncidentEvent[] }>(v2(org, `/incidents/${id}`)),
  create: (org: string, b: { title: string; severity: IncidentSeverity; owner_team_id: string | null }) =>
    request<unknown>(v2(org, '/incidents'), { method: 'POST', body: JSON.stringify(b) }),
  setStatus: (org: string, id: string, status: 'acknowledged' | 'resolved') =>
    request<unknown>(v2(org, `/incidents/${id}/status`), { method: 'POST', body: JSON.stringify({ status }) }),
  note: (org: string, id: string, body: string) =>
    request<unknown>(v2(org, `/incidents/${id}/notes`), { method: 'POST', body: JSON.stringify({ body }) }),
};

export interface InferenceResult { tag: string | null; label: string; score: number; severity: 'info' | 'warning' | 'critical'; detail: string }
export interface InferenceState { configured: boolean; model?: string; ts?: number; latency_ms?: number; error?: string | null; results?: InferenceResult[] }
export const inferenceApi = { get: (org: string) => request<InferenceState>(v2(org, '/inference')) };

// ── Admin API calls ──────────────────────────────────────────────────────────

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
  apiKeys: (org: string) => request<V2List<ApiKey>>(v2(org, '/api-keys')),
  createApiKey: (org: string, body: { name: string; role: string; expires_days: number | null; allow_control?: boolean }) =>
    request<{ key: ApiKey; secret: string }>(v2(org, '/api-keys'), { method: 'POST', body: JSON.stringify(body) }),
  revokeApiKey: (org: string, id: string) => request<void>(v2(org, `/api-keys/${id}`), { method: 'DELETE' }),
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
  siteHealth: (org: string, site: string) =>
    request<SiteHealth>(v2(org, `/sites/${site}/health`)),
  edges: (org: string, site: string) =>
    request<V2List<AdminEdge>>(v2(org, `/sites/${site}/edges`)),
  // v2 command reads — command:read (operator+). Callers MUST role-gate
  // before fetching (viewer → 403 trips the zero-4xx gate).
  siteCommands: (org: string, site: string, limit = 50) =>
    request<V2List<SiteCommand>>(v2(org, `/sites/${site}/commands?limit=${limit}`)),
  siteCommand: (org: string, site: string, id: string) =>
    request<{ command: SiteCommand & { events: SiteCommandEvent[] } }>(
      v2(org, `/sites/${site}/commands/${encodeURIComponent(id)}`)),
  /** Audit CSV download — streams through fetch with the session token and
   * hands the caller a Blob for an object-URL anchor. */
  auditCsv: async (org: string, params: { from?: string; to?: string } = {}): Promise<Blob> => {
    const q = new URLSearchParams();
    q.set('format', 'csv');
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const r = await requestBlob(v2(org, `/audit?${q.toString()}`));
    return r.blob;
  },
  // Device (edge) lifecycle — doc 17 §5. config:write (admin|owner).
  // The MQTT secret is returned ONCE by provision/rotate; the server keeps
  // only its fingerprint, so the UI must show it immediately and never store it.
  devices: (org: string, site: string) =>
    request<V2List<Device>>(v2(org, `/sites/${site}/edges`)),
  provisionDevice: (org: string, site: string, name: string) =>
    request<{ edge: Device; secret: string; enroll_code: string; enroll_expires_at: string }>(v2(org, `/sites/${site}/edges`), {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  newEnrollCode: (org: string, site: string, id: string) =>
    request<{ enroll_code: string; enroll_expires_at: string }>(
      v2(org, `/sites/${site}/edges/${id}/enroll-code`), { method: 'POST' }),
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
  config_version?: number; config_applied?: number | null; config_error?: string | null;
}

/** v2 command row (`_v2` shape, commands.py) — status in v2 vocabulary
 *  (accepted → dispatched → acknowledged | rejected | failed | timeout). */
export interface SiteCommand {
  id: string; tag_id: string; value: number | boolean | null; status: string;
  reason: string | null; ttl_s: number | null; idempotency_key: string | null;
  issued_at: string; updated_at: string;
  actor: { user_id: string | null; display_name: string | null } | null;
  version: number;
}
export interface SiteCommandEvent {
  from: string | null; to: string; actor: string; reason: string | null; at: string;
}

// ── ISA-95 hierarchy (spec 2026-10-19 §5) ────────────────────────────────────

export type LineKind = 'line' | 'cell' | 'unit';
export interface HEquipment { id: string; name: string; kind: string | null; tags: number; alarms: number; parts: number; tag_paths?: string[] }
export interface HLine { id: string; name: string; kind: LineKind; tags: number; alarms: number; equipment: HEquipment[] }
export interface HArea { id: string; site_id: string; name: string; code: string; sort: number; tags: number; alarms: number; lines: HLine[] }

const hSite = (org: string, site: string, path: string) => v2(org, `/sites/${site}${path}`);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const hierarchyApi = {
  tree: (org: string, site: string, tags = false) =>
    request<{ areas: HArea[] }>(hSite(org, site, `/hierarchy${tags ? '?tags=true' : ''}`)),
  createArea: (org: string, site: string, b: { name: string; code: string }) =>
    request<{ id: string }>(hSite(org, site, '/areas'), json('POST', b)),
  deleteArea: (org: string, site: string, id: string) =>
    request<void>(hSite(org, site, `/areas/${id}`), { method: 'DELETE' }),
  createLine: (org: string, site: string, b: { name: string; area_id: string; kind?: LineKind }) =>
    request<{ id: string }>(hSite(org, site, '/lines'), json('POST', b)),
  moveLine: (org: string, site: string, id: string, b: { area_id?: string; kind?: LineKind }) =>
    request<unknown>(hSite(org, site, `/lines/${id}`), json('PATCH', b)),
  createDevice: (org: string, site: string, b: { name: string; line_id: string; kind?: string }) =>
    request<{ id: string }>(hSite(org, site, '/devices'), json('POST', b)),
  moveDevice: (org: string, site: string, id: string, b: { line_id?: string; kind?: string }) =>
    request<unknown>(hSite(org, site, `/devices/${id}`), json('PATCH', b)),
  moveTags: (org: string, site: string, b: { tag_ids: string[]; device_id: string }) =>
    request<{ moved: number }>(hSite(org, site, '/tags/move'), json('POST', b)),
  grants: (org: string) => request<{ grants: Record<string, string[]> }>(v2(org, '/area-grants')),
  setGrants: (org: string, user: string, area_ids: string[]) =>
    request<unknown>(v2(org, `/members/${user}/area-grants`), json('PUT', { area_ids })),
};

// ── Derived (calculated) tags (spec 2026-10-19 §7) ───────────────────────────

export interface FormulaError { code: string; pos: number; name?: string; path?: string; token?: string; want?: string }
export interface FormulaPreview {
  ok: true; type: 'bool' | 'number'; value: number | boolean | null; quality: string | null;
  inputs: { var: string; tag_id: string; path: string; value: unknown; q: string | null }[];
  windows: number; max_window_s: number;
}
export interface DerivedTag {
  id: string; path: string; name: string; unit: string | null; type: 'bool' | 'number';
  expr: string; version: number; inputs: Record<string, string>; input_paths: Record<string, string>;
  device_id: string | null; updated_at: string;
}
export interface DerivedBody { expr: string; inputs: Record<string, string> }

const dSite = (org: string, site: string, path: string) => v2(org, `/sites/${site}${path}`);

export const derivedApi = {
  list: (org: string, site: string) => request<{ items: DerivedTag[] }>(dSite(org, site, '/derived-tags')),
  /** Always 200: `ok: true` with a preview, or `ok: false` with the error to show. */
  validate: (org: string, site: string, b: DerivedBody) =>
    request<FormulaPreview | { ok: false; error: FormulaError }>(dSite(org, site, '/formulas/validate'), { method: 'POST', body: JSON.stringify(b) }),
  create: (org: string, site: string, b: DerivedBody & { path: string; name?: string; unit?: string }) =>
    request<DerivedTag>(dSite(org, site, '/derived-tags'), { method: 'POST', body: JSON.stringify(b) }),
  update: (org: string, site: string, id: string, b: Partial<DerivedBody> & { name?: string; unit?: string }) =>
    request<DerivedTag>(dSite(org, site, `/derived-tags/${id}`), { method: 'PATCH', body: JSON.stringify(b) }),
  remove: (org: string, site: string, id: string) =>
    request<void>(dSite(org, site, `/derived-tags/${id}`), { method: 'DELETE' }),
};
