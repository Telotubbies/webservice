// REST client for the Phase-5 production surface (backend/app/oee.py and
// backend/app/reports.py). Shares lib/api.ts request()/requestBlob() so 401s
// surface the sign-in wall like everywhere else.

import { request, requestBlob } from '../../lib/api';

const call = request;

const org = (o: string) => `/api/v1/orgs/${encodeURIComponent(o)}`;
const site = (o: string, s: string) => `${org(o)}/sites/${encodeURIComponent(s)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

// ---- wire shapes (match backend/app/oee.py + reports.py) ----
export interface Shift {
  id: string; site_id: string; name: string; start_time: string; end_time: string;
  days_of_week: number[]; breaks: { start: string; end: string; name?: string }[]; enabled: boolean;
}
export interface ShiftInput {
  name: string; start_time: string; end_time: string;
  days_of_week: number[]; breaks: { start: string; end: string; name?: string }[]; enabled: boolean;
}
export interface CurrentShift { shift: { id: string; name: string; start_time: string; end_time: string } | null; starts_at?: string; ends_at?: string; timezone: string }
export interface NonworkingDay { day: string; reason: string }
export interface TagRef { id: string; path: string; name: string; type: string }
export interface MachineRow { device_id: string; name: string; line_id: string; line: string; configured: boolean }
export interface StateMap {
  device_id: string; state_tag_id: string; count_tag_id: string | null; reject_tag_id: string | null;
  states: Record<string, unknown[]>; stop_threshold_s: number; updated_at: string;
}
export interface StateMapInput {
  state_tag_id: string; count_tag_id: string | null; reject_tag_id: string | null;
  states: Record<string, unknown[]>; stop_threshold_s: number;
}
export interface ProductRow { id: string; product: string; ideal_cycle_s: number; active: boolean }
export interface ReasonRow { id: string; parent_id: string | null; code: string; name_en: string; name_th: string; sort: number; enabled: boolean }
export interface ReasonInput { code: string; name_en: string; name_th: string; parent_id?: string | null; sort?: number; enabled?: boolean }
export interface DtEvent {
  id: string; device_id: string; device: string | null; state: string | null;
  starts_at: string; ends_at: string | null; seconds: number; needs_reason: boolean;
  reason_id: string | null; reason: string | null; note: string | null; classified_at: string | null;
}
export interface OeeResult {
  availability: number | null; performance: number | null; quality: number | null; oee: number | null;
  run_s: number; planned_s: number; units: number; rejects: number; ideal_cycle_s: number | null;
}
export interface OeeMachine extends OeeResult {
  device_id: string; name: string; line_id: string; line: string;
  state_s: Record<string, number>;
}
export interface OeeResponse {
  machines: OeeMachine[]; totals: OeeResult;
  from?: string; to?: string; timezone?: string;
}
export interface ParetoItem {
  reason_id: string | null; code: string | null; name_en: string | null; name_th: string | null;
  count: number; seconds: number; pct: number | null; cum_pct: number | null;
}
export interface TrendItem {
  week: string; availability: number | null; performance: number | null;
  quality: number | null; oee: number | null; run_s: number; planned_s: number;
  units: number; rejects: number;
}
export interface TimelineItem { state: string; from: string; to: string; seconds: number }
export type ReportTemplate = 'shift' | 'daily' | 'weekly_oee' | 'monthly_alarms';
export interface ScheduleRow {
  id: string; site_id: string | null; template: ReportTemplate; to_addrs: string[];
  send_time: string; send_day: number | null; enabled: boolean;
  last_run_at: string | null; created_at: string;
}
export interface ScheduleInput {
  template: ReportTemplate; site_id?: string | null; to_addrs: string[];
  send_time?: string; send_day?: number | null; enabled?: boolean;
}

interface List<T> { items: T[] }

export const prodApi = {
  // shifts + calendar
  shifts: (o: string, s: string) => call<List<Shift>>(site(o, s) + '/shifts'),
  createShift: (o: string, s: string, b: ShiftInput) => call<{ shift: Shift }>(site(o, s) + '/shifts', json('POST', b)),
  patchShift: (o: string, s: string, id: string, b: ShiftInput) =>
    call<{ shift: Shift }>(`${site(o, s)}/shifts/${id}`, json('PATCH', b)),
  deleteShift: (o: string, s: string, id: string) => call<void>(`${site(o, s)}/shifts/${id}`, { method: 'DELETE' }),
  currentShift: (o: string, s: string) => call<CurrentShift>(site(o, s) + '/shifts/current'),
  nonworkingDays: (o: string, s: string) => call<List<NonworkingDay>>(site(o, s) + '/nonworking-days'),
  addNonworkingDay: (o: string, s: string, b: NonworkingDay) =>
    call<unknown>(site(o, s) + '/nonworking-days', json('POST', b)),
  delNonworkingDay: (o: string, s: string, day: string) =>
    call<void>(`${site(o, s)}/nonworking-days/${day}`, { method: 'DELETE' }),
  // machines
  machines: (o: string, s: string) => call<List<MachineRow> & { tags: TagRef[] }>(site(o, s) + '/machines'),
  stateMap: (o: string, s: string, dev: string) => call<{ map: StateMap }>(`${site(o, s)}/machines/${dev}/state-map`),
  putStateMap: (o: string, s: string, dev: string, b: StateMapInput) =>
    call<{ map: StateMap }>(`${site(o, s)}/machines/${dev}/state-map`, json('PUT', b)),
  products: (o: string, s: string, dev: string) => call<List<ProductRow>>(`${site(o, s)}/machines/${dev}/products`),
  upsertProduct: (o: string, s: string, dev: string, b: { product: string; ideal_cycle_s: number; active?: boolean }) =>
    call<unknown>(`${site(o, s)}/machines/${dev}/products`, json('PUT', b)),
  deleteProduct: (o: string, s: string, dev: string, pid: string) =>
    call<void>(`${site(o, s)}/machines/${dev}/products/${pid}`, { method: 'DELETE' }),
  timeline: (o: string, s: string, dev: string, from: string, to: string) =>
    call<List<TimelineItem>>(`${site(o, s)}/machines/${dev}/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  // downtime reasons + classification
  reasons: (o: string) => call<List<ReasonRow>>(org(o) + '/downtime-reasons'),
  createReason: (o: string, b: ReasonInput) => call<{ reason: ReasonRow }>(org(o) + '/downtime-reasons', json('POST', b)),
  patchReason: (o: string, id: string, b: Partial<ReasonInput>) =>
    call<{ reason: ReasonRow }>(`${org(o)}/downtime-reasons/${id}`, json('PATCH', b)),
  deleteReason: (o: string, id: string) => call<void>(`${org(o)}/downtime-reasons/${id}`, { method: 'DELETE' }),
  dtEvents: (o: string, s: string, params: { needs_reason?: boolean; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.needs_reason != null) q.set('needs_reason', String(params.needs_reason));
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const qs = q.toString();
    return call<List<DtEvent>>(`${site(o, s)}/downtime-events${qs ? `?${qs}` : ''}`);
  },
  classify: (o: string, s: string, id: string, b: { reason_id?: string | null; note?: string }) =>
    call<{ downtime: DtEvent }>(`${site(o, s)}/downtime-events/${id}/classify`, json('POST', b)),
  // OEE
  oee: (o: string, s: string, params: { from?: string; to?: string; device?: string; line?: string; shift?: string; product?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const qs = q.toString();
    return call<OeeResponse>(`${site(o, s)}/oee${qs ? `?${qs}` : ''}`);
  },
  pareto: (o: string, s: string, params: { from?: string; to?: string; device?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const qs = q.toString();
    return call<{ items: ParetoItem[] }>(`${site(o, s)}/oee/pareto${qs ? `?${qs}` : ''}`);
  },
  trend: (o: string, s: string, weeks = 8, params: { device?: string; line?: string } = {}) => {
    const q = new URLSearchParams({ weeks: String(weeks) });
    if (params.device) q.set('device', params.device);
    if (params.line) q.set('line', params.line);
    return call<{ items: TrendItem[]; timezone: string }>(`${site(o, s)}/oee/trend?${q}`);
  },
  // reports
  schedules: (o: string) => call<List<ScheduleRow>>(org(o) + '/report-schedules'),
  createSchedule: (o: string, b: ScheduleInput) => call<{ schedule: ScheduleRow }>(org(o) + '/report-schedules', json('POST', b)),
  patchSchedule: (o: string, id: string, b: Partial<ScheduleInput>) =>
    call<{ schedule: ScheduleRow }>(`${org(o)}/report-schedules/${id}`, json('PATCH', b)),
  deleteSchedule: (o: string, id: string) => call<void>(`${org(o)}/report-schedules/${id}`, { method: 'DELETE' }),
  report: (o: string, template: ReportTemplate, site: string | null, format: 'csv' | 'html') => {
    const q = new URLSearchParams({ format });
    if (site) q.set('site', site);
    return requestBlob(`${org(o)}/reports/${template}?${q}`)
      .then((r) => ({ blob: r.blob, filename: r.filename ?? 'report' }));
  },
};
