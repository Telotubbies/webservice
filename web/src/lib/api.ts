// Typed REST client for CONTRACT.md endpoints. Token is a dev/demo Bearer token
// stored in localStorage (per demo spec — no login flow).

import type {
  Alarm, AlarmRule, Command, CommandStatus, Health, Insight, SystemHealth, TagInfo, TagValue,
} from '../types';

const TOKEN_KEY = 'wds.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type TokenRole = 'operator' | 'viewer' | 'custom' | 'none';

export function tokenRole(token = getToken()): TokenRole {
  if (!token) return 'none';
  if (token === 'demo-operator') return 'operator';
  if (token === 'demo-viewer') return 'viewer';
  return 'custom';
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
