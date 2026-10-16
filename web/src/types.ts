// Types mirroring CONTRACT.md — single source of truth is the backend contract.

export type Quality = 'good' | 'bad' | 'stale' | 'uncertain';

export interface TagInfo {
  name: string;        // full dotted UNS name, e.g. plant1.sort.line1.motor1.running
  writable: boolean;
  unit?: string;
}

export interface TagValue {
  v: number | boolean;
  q: Quality;
  ts: string;          // ISO8601 UTC Z
}

export interface Alarm {
  id: number | string;
  tag: string;
  rule: string;
  severity: string;    // 'critical' | 'warning' | ... (free-form per contract)
  state: 'active' | 'acked' | 'cleared' | string;
  ts: string;
  acked_at?: string | null;
  acked_by?: string | null;
  cleared_at?: string | null;
  version?: number;
}

export type Severity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  tag: string;
  kind: 'anomaly' | 'drift' | 'flatline' | 'flapping';
  severity: Severity;
  score: number;
  state: 'open' | 'closed';
  ts_start: string;
  ts_end?: string | null;
  detail?: Record<string, unknown>;
}

export interface AlarmRule {
  tag: string | null;
  name: string;
  kind: 'hi' | 'hihi' | 'lo' | 'lolo' | 'stale' | 'roc' | 'anomaly' | 'forecast';
  threshold: number | null;
  stale_s: number | null;
  window_s?: number | null;
  deadband: number;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
}

export type CommandStatus =
  | 'issued' | 'sent' | 'acked' | 'done' | 'denied' | 'failed' | 'timeout';

export interface CommandEvent {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  at: string;
}

export interface Command {
  id: string;
  tag: string;
  value?: number | boolean;
  status: CommandStatus | string;
  detail?: string;
  created_at?: string;
  updated_at?: string;
  user?: string;
  events?: CommandEvent[];
}

export interface Health {
  status: string;
  db: string;
  mqtt: string;
  edge: string;        // 'up' | 'stale'
}

export interface SystemHealth {
  mqtt: { connected: boolean };
  edge: { last_heartbeat_ts?: string; clock_ok?: boolean };
  backend: { uptime_s?: number };
}

// ---- WS event shapes (CONTRACT.md §WebSocket) ----
export type WSEvent =
  | { type: 'tag'; name: string; v: number | boolean; q: Quality; ts: string }
  | { type: 'alarm' } & { alarm?: Alarm } & Partial<Alarm>
  | ({ type: 'alarm_update' } & { alarm?: Alarm } & Partial<Alarm>)
  | ({ type: 'insight' } & { insight?: Insight } & Partial<Insight>)
  | { type: 'command'; command_id: string; status: CommandStatus; tag?: string; detail?: string }
  | { type: 'health'; mqtt: string; edge: string }
  | { type: 'auth_expired' };

export type WSState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'auth_expired';
