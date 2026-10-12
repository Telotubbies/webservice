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
}

/** Called once after a request fails with 401 — wired by features/auth/oidc
 * to drop the session and surface the sign-in wall. */
export let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
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
