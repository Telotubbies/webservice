// REST client for plan/usage, org lifecycle + the /platform back-office.

import { ApiError, request, requestBlob, v2 } from '../../lib/api';

export interface UsageEntry { usage: number; cap: number | null }
export interface OrgUsage {
  plan: string;
  trial_ends_at: string | null;
  suspended: boolean;
  features: {
    sso: boolean; audit_export: boolean; sms: boolean; assistant: boolean;
    gpu_hours_monthly: number; retention_days: number; api_rate_per_min: number;
  };
  usage: Record<string, UsageEntry>;
}
export interface ExportRow {
  id: string; status: 'queued' | 'running' | 'done' | 'failed';
  size_bytes: number | null; created_at: string;
  ready_at: string | null; expires_at: string | null;
}
export interface MyOrg {
  org_id: string; name: string; slug: string; plan: string; role: string;
  suspended: boolean; deleted: boolean;
}
export interface SupportSessionRow {
  id: string; admin: string; reason: string; read_only: boolean;
  created_at: string; expires_at: string; active: boolean;
}
export interface Announcement {
  id: string; title: string; body: string; severity: 'info' | 'warning' | 'critical';
  starts_at: string; ends_at: string | null;
}
export interface WebhookRow {
  id: string; url: string; events: string[]; enabled: boolean;
  created_at: string; updated_at: string;
}
export interface WebhookDeliveryRow {
  id: number; endpoint_id: string; event: string; status: string;
  attempts: number; last_code: number | null; last_error: string | null; at: string;
}
export type WebhookEvent = 'alarm_raised' | 'alarm_cleared' | 'downtime_classified' | 'incident_opened';
export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'alarm_raised', 'alarm_cleared', 'downtime_classified', 'incident_opened'];

export const planApi = {
  myOrgs: () => request<{ items: MyOrg[] }>('/api/v1/orgs'),
  usage: (org: string) => request<OrgUsage>(v2(org, '/usage')),
  leave: (org: string) => request<unknown>(v2(org, '/leave'), { method: 'POST' }),
  deleteOrg: (org: string) =>
    request<{ purge_at: string }>(v2(org, ''), { method: 'DELETE' }),
  restoreOrg: (org: string) => request<unknown>(v2(org, '/restore'), { method: 'POST' }),
  requestExport: (org: string) =>
    request<{ export: ExportRow }>(v2(org, '/export'), { method: 'POST' }),
  exports: (org: string) => request<{ items: ExportRow[] }>(v2(org, '/exports')),
  exportDownload: (org: string, id: string): Promise<Blob> =>
    requestBlob(v2(org, `/exports/${id}/download`)).then((r) => r.blob),
  flags: (org: string) => request<{ flags: Record<string, boolean> }>(v2(org, '/feature-flags')),
  announcements: (org: string) => request<{ items: Announcement[] }>(v2(org, '/announcements')),
  supportSessions: (org: string) =>
    request<{ items: SupportSessionRow[] }>(v2(org, '/support-sessions')),
  webhooks: (org: string) => request<{ items: WebhookRow[] }>(v2(org, '/webhooks')),
  createWebhook: (org: string, body: { url: string; events: string[]; enabled?: boolean }) =>
    request<{ webhook: WebhookRow; secret: string }>(
      v2(org, '/webhooks'), { method: 'POST', body: JSON.stringify(body) }),
  deleteWebhook: (org: string, id: string) =>
    request<void>(v2(org, `/webhooks/${id}`), { method: 'DELETE' }),
  webhookDeliveries: (org: string) =>
    request<{ items: WebhookDeliveryRow[] }>(v2(org, '/webhook-deliveries')),
};

// ---------------------------------------------------------------------------
// /api/v1/platform — WDS staff only. Every call 403s for a non-admin; pages
// render the restricted state on ApiError(403).
// ---------------------------------------------------------------------------
export interface PlatformOrg {
  id: string; name: string; slug: string; plan: string;
  plan_limits: Record<string, unknown>;
  trial_ends_at: string | null;
  suspended: boolean; suspended_reason: string | null;
  deleted: boolean; deleted_at: string | null; created_at: string;
  usage?: Record<string, UsageEntry>;
  edge_health?: { active: number; online: number; last_hb_at: string | null };
  last_activity_at?: string | null;
}
export interface PlatformSession {
  id: string; org_id: string; org_name?: string; reason: string;
  read_only: boolean; created_at: string; expires_at: string;
  revoked_at: string | null; active: boolean;
}
export interface PlatformAnnouncement extends Announcement {
  org_id: string | null; org_name: string | null; revoked: boolean;
}
export interface PlatformHealth {
  counters: Record<string, number>;
  jobs: { pending: number; running: number; dead: number; done_last_hour: number };
  notification_deliveries_1h?: { sent: number; failed: number; retrying: number; suppressed: number };
  orgs: { total: number; suspended: number; deleted: number };
  support_sessions_active: number;
  mqtt_connected: boolean;
}

const P = '/api/v1/platform';
export const platformApi = {
  orgs: () => request<{ items: PlatformOrg[] }>(`${P}/orgs`),
  org: (org: string) =>
    request<{ org: PlatformOrg; usage: OrgUsage; members: unknown[] }>(`${P}/orgs/${org}`),
  patchOrg: (org: string, body: { plan?: string; limits?: Record<string, unknown>; trial_ends_at?: string }) =>
    request<unknown>(`${P}/orgs/${org}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suspend: (org: string, reason: string) =>
    request<unknown>(`${P}/orgs/${org}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unsuspend: (org: string) =>
    request<unknown>(`${P}/orgs/${org}/unsuspend`, { method: 'POST' }),
  issueSession: (org: string, body: { reason: string; minutes: number }) =>
    request<{ session: PlatformSession }>(
      `${P}/orgs/${org}/support-sessions`, { method: 'POST', body: JSON.stringify(body) }),
  sessions: (active = false) =>
    request<{ items: PlatformSession[] }>(`${P}/support-sessions${active ? '?active=true' : ''}`),
  revokeSession: (id: string) =>
    request<void>(`${P}/support-sessions/${id}`, { method: 'DELETE' }),
  flags: (org: string) =>
    request<{ flags: Record<string, boolean> }>(`${P}/orgs/${org}/feature-flags`),
  setFlags: (org: string, flags: Record<string, boolean>) =>
    request<unknown>(`${P}/orgs/${org}/feature-flags`, { method: 'PUT', body: JSON.stringify({ flags }) }),
  announcements: () => request<{ items: PlatformAnnouncement[] }>(`${P}/announcements`),
  createAnnouncement: (body: {
    title: string; body: string; severity: string; org_id?: string | null; ends_at?: string | null;
  }) => request<unknown>(`${P}/announcements`, { method: 'POST', body: JSON.stringify(body) }),
  revokeAnnouncement: (id: string) =>
    request<void>(`${P}/announcements/${id}`, { method: 'DELETE' }),
  health: () => request<PlatformHealth>(`${P}/health`),
};

/** true when the caller holds a platform_admins row (probe once per mount). */
export function isPlatformDenied(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 401);
}
