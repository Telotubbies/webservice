// REST client for the Phase-3 notification surface (backend/app/notify.py):
// channels + deliveries, per-rule routing, on-call rotations/overrides,
// escalation policies, alarm lifecycle actions and the ISA-18.2 quality
// endpoint. Every call carries the org id in the path — v2 scope rules.

import { request } from '../../lib/api';

const call = request;

const org = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------- channels
export type ChannelType = 'email' | 'line' | 'webhook' | 'teams' | 'slack';

export interface NotifyChannel {
  id: string; name: string; type: ChannelType; team_id: string | null;
  enabled: boolean; has_secrets: boolean;
  config: Record<string, unknown>;       // public fields only — never secrets
  created_at: string;
}
export interface ChannelInput {
  name: string; type: ChannelType; team_id?: string | null; enabled?: boolean;
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;     // write-only — never echoed back
}
export interface Delivery {
  id: number; channel_id: string | null; channel: string | null; type: string | null;
  alarm_id: string | null; kind: string; target: string; status: string;
  attempts: number; at: string;
}

// ------------------------------------------------------------- rule routing
export interface RuleNotify {
  channel_ids: string[]; team_ids: string[]; oncall_team: string | null;
  min_severity: 'info' | 'warning' | 'critical'; on_clear: boolean;
}

// ------------------------------------------------------------------- oncall
export interface OnCallNow {
  team_id: string; team: string; user_id: string | null; name: string | null;
  source: 'rotation' | 'override' | null; rotation: string[];
}
export interface Override {
  id: string; user_id: string; name: string | null; starts_at: string; ends_at: string;
}

// ----------------------------------------------------------- escalation
export interface EscLevel {
  after_minutes: number; channel_ids: string[]; team_ids: string[];
  oncall_team: string | null;
}
export interface EscPolicy {
  id: string; name: string; rule_id: string | null; levels: EscLevel[];
  enabled: boolean; created_at: string;
}

// --------------------------------------------------------------- lifecycle
export interface AlarmEvent {
  kind: 'comment' | 'assign' | 'shelve' | 'unshelve' | 'ack';
  author: string; body: string; at: string;
}

// ------------------------------------------------------------ alarm quality
export interface QualityRuleRow {
  rule_id: string; rule: string; severity: string; count: number; share: number;
  chatter: number; standing: number; unacked: number; mtta_s: number | null;
  flags: string[];
}
export interface AlarmQuality {
  hours: number; operators: number; total: number;
  alarms_per_hour: number; alarms_per_operator_hour: number;
  peak_10m: number; hourly: number[]; standing: number; unacked: number;
  top10_share: number; rules: QualityRuleRow[];
}

export const notifyApi = {
  channels: (o: string) => call<{ items: NotifyChannel[] }>(`${org(o)}/notification-channels`),
  createChannel: (o: string, b: ChannelInput) =>
    call<{ channel: NotifyChannel }>(`${org(o)}/notification-channels`, json('POST', b)),
  patchChannel: (o: string, id: string, b: Partial<ChannelInput>) =>
    call<{ channel: NotifyChannel }>(`${org(o)}/notification-channels/${id}`, json('PATCH', b)),
  deleteChannel: (o: string, id: string) =>
    call<void>(`${org(o)}/notification-channels/${id}`, { method: 'DELETE' }),
  testChannel: (o: string, id: string, text?: string) =>
    call<{ status: string }>(`${org(o)}/notification-channels/${id}/test`, json('POST', { text: text ?? '' })),
  deliveries: (o: string, channelId?: string) =>
    call<{ items: Delivery[] }>(`${org(o)}/notification-deliveries${channelId ? `?channel_id=${channelId}` : ''}`),

  ruleNotify: (o: string, rule: string) =>
    call<{ notify: RuleNotify }>(`${org(o)}/alarm-rules/${rule}/notify`),
  setRuleNotify: (o: string, rule: string, b: RuleNotify) =>
    call<{ notify: RuleNotify }>(`${org(o)}/alarm-rules/${rule}/notify`, json('PUT', b)),

  oncall: (o: string) => call<{ items: OnCallNow[] }>(`${org(o)}/oncall`),
  setRotation: (o: string, team: string, b: { user_ids: string[]; anchor?: string; handoff_s?: number }) =>
    call<unknown>(`${org(o)}/teams/${team}/oncall`, json('PUT', b)),
  overrides: (o: string, team: string) =>
    call<{ items: Override[] }>(`${org(o)}/teams/${team}/oncall/overrides`),
  addOverride: (o: string, team: string, b: { user_id: string; starts_at: string; ends_at: string }) =>
    call<{ id: string }>(`${org(o)}/teams/${team}/oncall/overrides`, json('POST', b)),
  delOverride: (o: string, team: string, id: string) =>
    call<void>(`${org(o)}/teams/${team}/oncall/overrides/${id}`, { method: 'DELETE' }),

  policies: (o: string) => call<{ items: EscPolicy[] }>(`${org(o)}/escalation-policies`),
  createPolicy: (o: string, b: { name: string; rule_id?: string | null; levels: EscLevel[]; enabled?: boolean }) =>
    call<{ policy: EscPolicy }>(`${org(o)}/escalation-policies`, json('POST', b)),
  patchPolicy: (o: string, id: string, b: { name?: string; levels?: EscLevel[]; enabled?: boolean }) =>
    call<{ policy: EscPolicy }>(`${org(o)}/escalation-policies/${id}`, json('PATCH', b)),
  deletePolicy: (o: string, id: string) =>
    call<void>(`${org(o)}/escalation-policies/${id}`, { method: 'DELETE' }),

  shelve: (o: string, alarm: string, minutes: number, reason = '') =>
    call<{ shelved_until: string }>(`${org(o)}/alarms/${alarm}/shelve`, json('POST', { minutes, reason })),
  unshelve: (o: string, alarm: string) =>
    call<unknown>(`${org(o)}/alarms/${alarm}/unshelve`, json('POST', {})),
  comment: (o: string, alarm: string, body: string) =>
    call<unknown>(`${org(o)}/alarms/${alarm}/comments`, json('POST', { body })),
  assign: (o: string, alarm: string, user_id: string | null) =>
    call<unknown>(`${org(o)}/alarms/${alarm}/assign`, json('POST', { user_id })),
  alarmEvents: (o: string, alarm: string) =>
    call<{ items: AlarmEvent[] }>(`${org(o)}/alarms/${alarm}/events`),
  ackLink: (o: string, alarm: string, ttl_s?: number) =>
    call<{ url: string; expires_in: number }>(`${org(o)}/alarms/${alarm}/ack-link`, json('POST', { ttl_s })),

  quality: (o: string, hours = 24, siteId?: string) =>
    call<AlarmQuality>(`${org(o)}/alarm-quality?hours=${hours}${siteId ? `&site_id=${siteId}` : ''}`),
};
