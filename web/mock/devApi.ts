// Dev-only mock of the /api surface (CONTRACT shapes) so the console runs
// without the backend stack. Enabled by MOCK_API=1 (see vite.config.ts).
// Data comes from a live in-process plant (sim.ts): the batching plant and
// the sorting line run their real cycles, alarms raise and clear, commands
// write setpoints, and /ws streams it all like the backend does. plant.ts
// turns the same simulator into equipment, gateways, protocol sources, OEE,
// downtime and vision decisions, so every page agrees with every other.
// shortcut: in-memory, resets on restart. Use the real backend for anything
// beyond UI work.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import * as sim from './sim.ts';
import * as plant from './plant.ts';
import { attachWs, type Conn } from './ws.ts';
import { PLANT_KINDS } from './data/plantKinds.ts';
import { MATERIAL_SCHEMA } from './data/materialSchema.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();
const T0 = now();
const H = 3600e3, DAY = 86400e3;
const tagName = (tail: string) => `${sim.SITE}.${tail}`;
const idOf = (tail: string) => sim.tagByTail(tail)!.id;

// ── Live fan-out: simulator events → every authed /ws client ────────────────
const clients = new Set<Conn>();
const broadcast = (msg: Record<string, unknown>) => { for (const c of clients) c.send(msg); };

const insights = [
  { id: 'ins-1', tag: tagName('sort.line1.conv1.temp_c'), kind: 'drift', severity: 'warning', score: 0.82, state: 'open', ts_start: iso(T0 - 40 * 60e3), ts_end: null, detail: { slope_per_h: 2.4 } },
  { id: 'ins-2', tag: tagName('batch.mix.mixer1.current_a'), kind: 'anomaly', severity: 'info', score: 0.61, state: 'open', ts_start: iso(T0 - 15 * 60e3), ts_end: null, detail: { z: 3.1 } },
  { id: 'ins-3', tag: tagName('batch.air.filter1.dp_mbar'), kind: 'drift', severity: 'info', score: 0.57, state: 'open', ts_start: iso(T0 - 5 * H), ts_end: null, detail: { slope_per_h: 0.3, note: 'filter bags loading up' } },
  { id: 'ins-4', tag: tagName('batch.liq.pump1.flow_lpm'), kind: 'flatline', severity: 'warning', score: 0.74, state: 'closed', ts_start: iso(T0 - 20 * H), ts_end: iso(T0 - 19.5 * H), detail: {} },
];

// ── Commands: sim.write + the edge's lifecycle (issued → sent → acked → done)
interface Cmd {
  id: string; tag: string; value: number | boolean; status: string; detail?: string;
  created_at: string; updated_at: string; user: string; events: { from: string; to: string; actor: string; reason?: string | null; at: string }[];
}
const commands: Cmd[] = [];
let cmdSeq = 0;
function seedCommand(tail: string, value: number | boolean, agoMs: number, user: string, status = 'done', detail?: string) {
  const at = T0 - agoMs;
  const id = `cmd-${++cmdSeq}`;
  const steps = status === 'denied' ? ['issued', 'denied'] : status === 'timeout' ? ['issued', 'sent', 'timeout'] : ['issued', 'sent', 'acked', 'done'];
  commands.push({
    id, tag: tagName(tail), value, status, detail, created_at: iso(at), updated_at: iso(at + 900), user,
    events: steps.slice(1).map((to, i) => ({ from: steps[i], to, actor: to === 'denied' ? 'backend' : 'edge-batching-01', reason: to === 'denied' ? detail ?? null : null, at: iso(at + 300 * (i + 1)) })),
  });
}
seedCommand('sort.line1.motor1.speed_sp', 36, 22 * 60e3, 'Somchai K. (operator)');
seedCommand('batch.plant.recipe.cem_target_kg', 320, 2 * H, 'Nok P. (engineer)');
seedCommand('batch.plant.recipe.water_target_kg', 150, 2 * H + 4 * 60e3, 'Nok P. (engineer)');
seedCommand('sort.line1.motor1.running', false, 5 * H, 'Somchai K. (operator)');
seedCommand('sort.line1.motor1.running', true, 5 * H - 12 * 60e3, 'Somchai K. (operator)');
seedCommand('sort.line1.motor1.speed_sp', 70, 9 * H, 'Demo operator', 'denied', 'out_of_range: 0–60 Hz');
seedCommand('batch.plant.auto.enabled', true, 14 * H, 'Nok P. (engineer)', 'timeout', 'edge did not ack within 10 s');
commands.reverse();

const CMD_V2: Record<string, string> = { issued: 'accepted', sent: 'dispatched', acked: 'acknowledged', done: 'acknowledged', denied: 'rejected', failed: 'failed', timeout: 'timeout' };
const cmdV2 = (c: Cmd) => ({
  id: c.id, tag_id: sim.tagByName(c.tag)?.id ?? '', value: c.value, status: CMD_V2[c.status] ?? c.status, reason: c.detail ?? null, ttl_s: 10,
  idempotency_key: null, issued_at: c.created_at, updated_at: c.updated_at, actor: { user_id: null, display_name: c.user }, version: c.events.length + 1,
});

function issue(tag: string, value: unknown, user: string): { code: number; body: unknown } {
  const r = sim.write(tag, value);
  if (!r.ok) {
    const code = r.reason === 'unknown_tag' ? 404 : r.reason === 'not_writable' ? 403 : 422;
    return { code, body: { detail: r.reason } };
  }
  const t = now();
  const c: Cmd = { id: `cmd-${++cmdSeq}`, tag, value: value as number | boolean, status: 'issued', created_at: iso(t), updated_at: iso(t), user, events: [] };
  commands.unshift(c);
  // the edge's round-trip: dispatched over MQTT, acked by the PLC, read back
  const advance = (to: string, ms: number) => setTimeout(() => {
    c.events.push({ from: c.status, to, actor: to === 'sent' ? 'backend' : 'edge', at: iso(now()) });
    c.status = to; c.updated_at = iso(now());
    broadcast({ type: 'command', command_id: c.id, status: to, tag });
  }, ms);
  advance('sent', 120); advance('acked', 420); advance('done', 800);
  return { code: 200, body: { command_id: c.id } };
}

// ── WP-E: incidents + notification fixtures (in-memory, CONTRACT shapes) ────
const UID = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const MOCK_TEAMS = [
  { id: 'team-ops', name: 'Ops', description: 'shift operators', members: [{ user_id: 'u1', name: 'Somchai K.' }, { user_id: 'u2', name: 'Demo operator' }] },
  { id: 'team-maint', name: 'Maintenance', description: 'mechanical & electrical', members: [{ user_id: 'u4', name: 'Arthit W.' }] },
];
const mockIncidents: Record<string, unknown>[] = [
  { id: UID('d1'), title: 'Sorter belt overheating above HiHi', severity: 'critical', status: 'active', created_at: iso(T0 - 6 * 60e3), acked_at: null, resolved_at: null, alarm_id: null, team_id: 'team-ops', team: 'Ops', mine: true },
  { id: UID('d2'), title: 'Gravel bin filling faster than discharge', severity: 'warning', status: 'acknowledged', created_at: iso(T0 - 40 * 60e3), acked_at: iso(T0 - 30 * 60e3), resolved_at: null, alarm_id: null, team_id: 'team-maint', team: 'Maintenance', mine: false },
  { id: UID('d3'), title: 'Cement tanker late — silo ran low', severity: 'warning', status: 'resolved', created_at: iso(T0 - 26 * H), acked_at: iso(T0 - 25 * H), resolved_at: iso(T0 - 24 * H), alarm_id: null, team_id: null, team: null, mine: false },
  { id: UID('d4'), title: 'Manual declare — belt slip observed', severity: 'warning', status: 'active', created_at: iso(T0 - 3 * H), acked_at: null, resolved_at: null, alarm_id: null, team_id: 'team-ops', team: 'Ops', mine: false },
];
/** Point the seeded incidents at real alarms once the simulator has history. */
function linkIncidents() {
  const pick = (rule: string, i = 0) => sim.ALARMS.filter((a) => a.rule_id === rule)[i];
  const links: [number, string][] = [[0, 'r-1'], [1, 'r-2'], [2, 'r-6']];
  for (const [n, rule] of links) {
    const a = pick(rule) ?? pick(rule, 0);
    if (a) Object.assign(mockIncidents[n], { alarm_id: String(a.id), created_at: a.ts });
  }
}
const mockIncEvents: Record<string, Record<string, unknown>[]> = {
  [UID('d1')]: [{ kind: 'created', body: '', at: iso(T0 - 6 * 60e3), who: 'Somchai K.' }],
  [UID('d2')]: [
    { kind: 'created', body: '', at: iso(T0 - 40 * 60e3), who: 'Somchai K.' },
    { kind: 'status', body: 'acknowledged', at: iso(T0 - 30 * 60e3), who: 'Arthit W.' },
    { kind: 'note', body: 'Maintenance is checking the discharge gate actuator.', at: iso(T0 - 12 * 60e3), who: 'Arthit W.' },
  ],
  [UID('d3')]: [
    { kind: 'created', body: '', at: iso(T0 - 26 * H), who: 'shift-operator' },
    { kind: 'status', body: 'acknowledged', at: iso(T0 - 25 * H), who: 'Nok P.' },
    { kind: 'note', body: 'Supplier confirmed the tanker left 40 min late. Silo 1 switched to silo 3 for two batches.', at: iso(T0 - 24.5 * H), who: 'Nok P.' },
    { kind: 'status', body: 'resolved', at: iso(T0 - 24 * H), who: 'Nok P.' },
  ],
  [UID('d4')]: [
    { kind: 'created', body: '', at: iso(T0 - 3 * H), who: 'Demo operator' },
    { kind: 'note', body: 'Operator on swing shift reported slipping sounds at the sorter conveyor.', at: iso(T0 - 2 * H), who: 'Demo operator' },
  ],
};

// ── v2 config fixtures ──────────────────────────────────────────────────────
const v2channels: Record<string, unknown>[] = [
  { id: 'c-1', name: 'Ops email', type: 'email', team_id: 'team-ops', enabled: true, has_secrets: false, config: { to: 'ops@demo.plant' }, created_at: iso(T0 - 90 * DAY) },
  { id: 'c-2', name: 'LINE night shift', type: 'line', team_id: 'team-maint', enabled: true, has_secrets: true, config: {}, created_at: iso(T0 - 40 * DAY) },
  { id: 'c-3', name: 'SCADA webhook', type: 'webhook', team_id: null, enabled: false, has_secrets: true, config: { url: 'https://hooks.demo.plant/alarm' }, created_at: iso(T0 - 12 * DAY) },
];
const v2policies: Record<string, unknown>[] = [
  { id: 'p-1', name: 'Shift escalation', rule_id: null, enabled: true, created_at: iso(T0 - 60 * DAY), levels: [
    { after_minutes: 15, channel_ids: ['c-1'], team_ids: [], oncall_team: 'team-ops' },
    { after_minutes: 45, channel_ids: ['c-1', 'c-2'], team_ids: [], oncall_team: 'team-maint' },
  ] },
  { id: 'p-2', name: 'Critical fast path', rule_id: 'r-1', enabled: true, created_at: iso(T0 - 20 * DAY), levels: [
    { after_minutes: 2, channel_ids: ['c-2'], team_ids: [], oncall_team: 'team-maint' },
  ] },
];
const v2downtimes: Record<string, unknown>[] = [
  { id: 'd-1', rule_id: 'r-4', rule: 'Vision feed stale', description: 'Camera lens cleaning', starts_at: iso(T0 - H), ends_at: iso(T0 + 3 * H), recurring: false, mine: true },
  { id: 'd-2', rule_id: null, rule: null, description: 'Weekly preventive maintenance — sorter gearbox', starts_at: iso(T0 + 2 * DAY), ends_at: iso(T0 + 2 * DAY + 4 * H), recurring: true, mine: false },
];
const ruleNotify: Record<string, Record<string, unknown>> = {
  'r-1': { channel_ids: ['c-2'], team_ids: ['team-maint'], oncall_team: 'team-maint', min_severity: 'critical', on_clear: true },
  'r-5': { channel_ids: ['c-2'], team_ids: ['team-maint'], oncall_team: 'team-maint', min_severity: 'critical', on_clear: true },
};

// ── WP-D surfaces: dashboards, report schedules ─────────────────────────────
const W = { tags: [] as string[], agg: 'last', groupBy: 'tag', range: 'inherit', unit: '', decimals: 1, colors: [], lineWidth: 2, yMin: null, yMax: null, legend: true, warn: null, crit: null, note: '', tone: 'blue' };
const dashboards: Record<string, unknown>[] = [
  {
    id: '11111111-2222-4333-8444-555555555551', title: 'Shift handover', description: 'Board shared across shifts by the day team.',
    shared: true, mine: false, updated_at: iso(T0 - 2 * DAY), body: { range: '1h', widgets: [
      { ...W, id: 'w-ts', kind: 'timeseries', title: 'Sorter belt temperature (°C)', x: 0, y: 0, w: 8, h: 3, tags: [tagName('sort.line1.conv1.temp_c')], warn: 70, crit: 75 },
      { ...W, id: 'w-al', kind: 'alarms', title: 'Active alarms', x: 8, y: 0, w: 4, h: 3 },
      { ...W, id: 'w-mx', kind: 'timeseries', title: 'Mixer current (A)', x: 0, y: 3, w: 6, h: 3, tags: [tagName('batch.mix.mixer1.current_a')], crit: 100 },
      { ...W, id: 'w-si', kind: 'timeseries', title: 'Cement silo levels (%)', x: 6, y: 3, w: 6, h: 3, tags: [1, 2, 3, 4].map((i) => tagName(`batch.cem.silo${i}.level_pct`)), warn: 15, crit: 8 },
    ] },
  },
  {
    id: '11111111-2222-4333-8444-555555555552', title: 'My commissioning checks', description: 'Sorter line after the gearbox swap.',
    shared: false, mine: true, updated_at: iso(T0 - DAY), body: { range: '15m', widgets: [
      { ...W, id: 'w-sp', kind: 'timeseries', title: 'Belt speed (m/s)', x: 0, y: 0, w: 6, h: 3, tags: [tagName('sort.line1.conv1.speed_mps')] },
      { ...W, id: 'w-bn', kind: 'timeseries', title: 'Gravel bin level (%)', x: 6, y: 0, w: 6, h: 3, tags: [tagName('sort.line1.bin1.level_pct')], warn: 85, crit: 90 },
    ] },
  },
];
const schedules: Record<string, unknown>[] = [
  { id: 'rs-1', site_id: 'site-1', template: 'daily', to_addrs: ['ops@demo.plant'], send_time: '07:00', send_day: null, enabled: true, last_run_at: iso(T0 - 9 * H), created_at: iso(T0 - 30 * DAY) },
  { id: 'rs-2', site_id: 'site-1', template: 'weekly_oee', to_addrs: ['ops@demo.plant', 'owner@demo.plant'], send_time: '06:30', send_day: 1, enabled: true, last_run_at: iso(T0 - 5 * DAY), created_at: iso(T0 - 60 * DAY) },
  { id: 'rs-3', site_id: null, template: 'monthly_alarms', to_addrs: ['owner@demo.plant'], send_time: '08:00', send_day: 1, enabled: false, last_run_at: null, created_at: iso(T0 - 45 * DAY) },
];

// ── SLOs (WP-C) ─────────────────────────────────────────────────────────────
const UPTIME: Record<string, number> = { speed_mps: 0.9993, temp_c: 0.9962, level_pct: 0.981, gravel_ratio: 0.9991 };
const uptimeOf = (name: string) => UPTIME[name.split('.').pop() ?? ''] ?? 0.999;
/** Deterministic bad-sample patch: (1−uptime) seconds per hour are 'bad'. */
const qAt = (name: string, t: number) => ((t / 1000) % 3600 < (1 - uptimeOf(name)) * 3600 ? 'bad' : 'good');

interface MockSlo {
  id: string; name: string; description: string; tag: string | null; tag_id: string;
  target: number; warning: number; updated_at: string;
  corrections: { id: string; starts_at: string; ends_at: string; reason: string }[];
}
const slos: MockSlo[] = [
  { id: 'slo-belt', name: 'Conveyor belt availability', description: 'Sorter line belt uptime', tag: tagName('sort.line1.conv1.speed_mps'), tag_id: idOf('sort.line1.conv1.speed_mps'), target: 99.9, warning: 99.95, updated_at: iso(T0 - 3 * DAY), corrections: [] },
  { id: 'slo-temp', name: 'Belt temperature telemetry', description: '', tag: tagName('sort.line1.conv1.temp_c'), tag_id: idOf('sort.line1.conv1.temp_c'), target: 99.5, warning: 99.7, updated_at: iso(T0 - 2 * DAY), corrections: [] },
  { id: 'slo-bin', name: 'Bin level sensor uptime', description: 'Downtime during planned calibration is excluded', tag: tagName('sort.line1.bin1.level_pct'), tag_id: idOf('sort.line1.bin1.level_pct'), target: 99.0, warning: 99.5, updated_at: iso(T0 - DAY),
    corrections: [{ id: 'cor-1', starts_at: iso(T0 - 4 * H), ends_at: iso(T0 - 3 * H), reason: 'load-cell calibration' }] },
  { id: 'slo-vision', name: 'Vision camera frames', description: '', tag: tagName('sort.vision.cam1.gravel_ratio'), tag_id: idOf('sort.vision.cam1.gravel_ratio'), target: 99.5, warning: 99.8, updated_at: iso(T0 - 6 * H), corrections: [] },
];

const auditSeed = [
  { seq: 101, at: iso(T0 - 26 * DAY), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-belt' }, detail: { name: 'Conveyor belt availability', target: 99.9 }, hash: 'a1' },
  { seq: 102, at: iso(T0 - 26 * DAY), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-temp' }, detail: { name: 'Belt temperature telemetry', target: 99.5 }, hash: 'a2' },
  { seq: 103, at: iso(T0 - 25 * DAY), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-bin' }, detail: { name: 'Bin level sensor uptime', target: 99.0 }, hash: 'a3' },
  { seq: 104, at: iso(T0 - 25 * DAY), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-vision' }, detail: { name: 'Vision camera frames', target: 99.5 }, hash: 'a4' },
  { seq: 105, at: iso(T0 - 9 * DAY), actor: 'user:admin', action: 'slo.updated', target: { slo_id: 'slo-temp' }, detail: { target: '99.0 → 99.5' }, hash: 'a5' },
  { seq: 106, at: iso(T0 - 5 * DAY), actor: 'user:admin', action: 'datasource.created', target: { source_id: 'src-ua' }, detail: { protocol: 'opcua', endpoint: 'opc.tcp://10.10.1.30:4840' }, hash: 'a6' },
  { seq: 107, at: iso(T0 - 2 * H), actor: 'user:admin', action: 'slo.correction_added', target: { slo_id: 'slo-bin' }, detail: { reason: 'load-cell calibration' }, hash: 'a7' },
];

// ── People, platform, storage ───────────────────────────────────────────────
const members = [
  { user_id: 'u0', sub: 'demo-admin', display_name: 'Demo admin', email: 'admin@demo.plant', role: 'admin', disabled: false },
  { user_id: 'u1', sub: 'oidc|somchai', display_name: 'Somchai K.', email: 'somchai@demo.plant', role: 'operator', disabled: false },
  { user_id: 'u2', sub: 'demo-operator', display_name: 'Demo operator', email: 'operator@demo.plant', role: 'operator', disabled: false },
  { user_id: 'u3', sub: 'oidc|nok', display_name: 'Nok P.', email: 'nok@demo.plant', role: 'admin', disabled: false },
  { user_id: 'u4', sub: 'oidc|arthit', display_name: 'Arthit W.', email: 'arthit@demo.plant', role: 'operator', disabled: false },
  { user_id: 'u5', sub: 'oidc|owner', display_name: 'Plant manager', email: 'owner@demo.plant', role: 'owner', disabled: false },
  { user_id: 'u6', sub: 'demo-viewer', display_name: 'QA auditor', email: 'qa@demo.plant', role: 'viewer', disabled: false },
  { user_id: 'u7', sub: 'oidc|former', display_name: 'Former contractor', email: 'contractor@example.com', role: 'viewer', disabled: true },
];
const invites = [
  { id: 'inv-1', email: 'night.lead@demo.plant', role: 'operator', expires_at: iso(T0 + 5 * DAY), accepted_at: null },
  { id: 'inv-2', email: 'auditor@iso-cert.example', role: 'viewer', expires_at: iso(T0 + 2 * DAY), accepted_at: null },
];
const notebooks = [
  { id: 'nb-1', title: 'Shift handover — swing → night', shared: true, mine: false, updated_at: iso(T0 - 3 * H),
    body: '## Swing shift summary\n\n- 412 m³ poured, 412 trucks loaded\n- Sorter stopped twice for belt cleaning (classified)\n- **Watch:** cement silo 2 trending low, tanker booked for 23:30\n\n## Open items\n\n1. Dust filter ΔP creeping up — bags due for a shake-down\n2. Camera 3 (stockpile) password changed by IT, RTSP failing\n' },
  { id: 'nb-2', title: 'Sorter gearbox swap — commissioning log', shared: true, mine: true, updated_at: iso(T0 - DAY),
    body: '## Checks\n\n| Step | Result |\n|---|---|\n| No-load run 10 min | OK, 31 °C |\n| Loaded run at 32 Hz | OK, 58 °C |\n| Speed-up to 44 Hz | belt temp crosses HiHi after ~4 min |\n\nKeep the speed setpoint at or below **40 Hz** until the new belt is run in.\n' },
  { id: 'nb-3', title: 'Alarm rationalisation notes (ISA-18.2)', shared: false, mine: true, updated_at: iso(T0 - 4 * DAY),
    body: 'Target: under 6 alarms per operator-hour.\n\n- Skip motor temp Hi disabled — it fired every cycle, no operator action\n- Silo low raised to 8 % with 3 % deadband — stopped the chatter\n' },
];
const webhooks = [
  { id: 'wh-1', url: 'https://erp.demo.plant/hooks/downtime', events: ['downtime_classified'], enabled: true, created_at: iso(T0 - 50 * DAY), updated_at: iso(T0 - 10 * DAY) },
  { id: 'wh-2', url: 'https://cmms.demo.plant/api/incidents', events: ['alarm_raised', 'incident_opened'], enabled: true, created_at: iso(T0 - 30 * DAY), updated_at: iso(T0 - 30 * DAY) },
];
const security = { mobile_control: true, mfa_required: false, you_have_mfa: false };

function storage() {
  const items = [
    ...plant.VERSIONS.map((v) => ({ kind: 'model' as const, id: v.id, name: `${plant.MODELS.find((m) => m.id === v.model_id)!.name} v${v.version}.${v.source_format}`, size_bytes: v.size_bytes, sha256: v.sha256, owner_id: 'u3', owner: 'Nok P.', created_at: v.created_at, in_garage: true })),
    { kind: 'video' as const, id: 'vid-1', name: 'truck-bay-2026-10-20.mp4', size_bytes: 184_000_000, sha256: 'e0f1a2b3', owner_id: 'u3', owner: 'Nok P.', created_at: iso(T0 - 6 * DAY), in_garage: true },
    { kind: 'video' as const, id: 'vid-2', name: 'sorter-belt-wet-sand.mp4', size_bytes: 96_500_000, sha256: 'f1a2b3c4', owner_id: 'u0', owner: 'Demo admin', created_at: iso(T0 - 2 * DAY), in_garage: true },
    { kind: 'plant' as const, id: 'pm-1', name: 'batching-plant.glb', size_bytes: 7_300_000, sha256: 'a2b3c4d5', owner_id: 'u0', owner: 'Demo admin', created_at: iso(T0 - 12 * DAY), in_garage: true },
  ];
  const total = items.reduce((s, i) => s + i.size_bytes, 0);
  const by = (k: 'kind' | 'owner_id') => [...new Set(items.map((i) => i[k]))].map((key) => {
    const xs = items.filter((i) => i[k] === key);
    return { key, objects: xs.length, bytes: xs.reduce((s, i) => s + i.size_bytes, 0), name: xs[0].owner ?? '—' };
  });
  return {
    scope: 'org', garage: { enabled: true, reachable: true, bucket: 'wds-demo' },
    totals: { objects: items.length, bytes: total, in_garage: items.length, missing: 0 },
    by_kind: by('kind').map((r) => ({ kind: String(r.key), objects: r.objects, bytes: r.bytes })),
    by_user: by('owner_id').map((r) => ({ user_id: r.key, name: r.name, objects: r.objects, bytes: r.bytes })),
    items, orphans: [{ key: 'videos/tmp-upload-7f3a.part', size: 12_400_000 }],
  };
}

function usage() {
  return {
    plan: 'pro', trial_ends_at: null, suspended: false,
    features: { sso: true, audit_export: true, sms: false, assistant: true, gpu_hours_monthly: 40, retention_days: 90, api_rate_per_min: 600 },
    usage: { sites: { usage: 1, cap: 5 }, edges: { usage: 3, cap: 10 }, tags: { usage: sim.TAGS.length, cap: 2000 }, members: { usage: members.filter((m) => !m.disabled).length, cap: 25 }, cameras: { usage: 3, cap: 8 }, gpu_hours: { usage: 11.4, cap: 40 }, storage_gb: { usage: 0.4, cap: 50 } },
  };
}

// derived (calculated) tags, in the backend's formula language
const derived = [
  { path: 'sort/line1/conv1/temp_margin_c', name: 'temp_margin_c', unit: '°C', type: 'number', expr: '75 - a', inputs: { a: 'sort.line1.conv1.temp_c' }, device: 'dev-sort-line1-conv1' },
  { path: 'batch/cem/silos/avg_level_pct', name: 'avg_level_pct', unit: '%', type: 'number', expr: '(a + b + c + d) / 4', inputs: { a: 'batch.cem.silo1.level_pct', b: 'batch.cem.silo2.level_pct', c: 'batch.cem.silo3.level_pct', d: 'batch.cem.silo4.level_pct' }, device: null },
  { path: 'batch/plant/production/wc_ratio', name: 'wc_ratio', unit: null, type: 'number', expr: 'round(a / b, 3)', inputs: { a: 'batch.plant.recipe.water_target_kg', b: 'batch.plant.recipe.cem_target_kg' }, device: 'dev-batch-plant-recipe' },
  { path: 'batch/mix/mixer1/overloaded', name: 'overloaded', unit: null, type: 'bool', expr: 'avg(a, 30s) > 100', inputs: { a: 'batch.mix.mixer1.current_a' }, device: 'dev-batch-mix-mixer1' },
].map((d, i) => ({
  id: `dt-${i + 1}`, path: d.path, name: d.name, unit: d.unit, type: d.type, expr: d.expr, version: 1 + (i % 2),
  inputs: Object.fromEntries(Object.entries(d.inputs).map(([k, tail]) => [k, idOf(tail)])),
  input_paths: Object.fromEntries(Object.entries(d.inputs).map(([k, tail]) => [k, tail.replace(/\./g, '/')])),
  device_id: d.device, updated_at: iso(T0 - (i + 1) * 3 * DAY),
}));

const OPCUA_TREE: Record<string, { node_id: string; name: string; node_class: string; data_type: string | null; writable: boolean }[]> = {
  root: [{ node_id: 'ns=2;s=Batching', name: 'Batching', node_class: 'Object', data_type: null, writable: false }],
  'ns=2;s=Batching': ['Air', 'Plant'].map((n) => ({ node_id: `ns=2;s=Batching.${n}`, name: n, node_class: 'Object', data_type: null, writable: false })),
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function roleOf(req: IncomingMessage): string | null {
  return roleOfToken(/Bearer (\S+)/.exec(req.headers.authorization ?? '')?.[1]);
}
function roleOfToken(token: string | undefined): string | null {
  const m = /^demo-(\w+)$/.exec(token ?? '');
  return m ? (m[1] === 'admin' || m[1] === 'owner' ? m[1] : m[1] === 'viewer' ? 'viewer' : 'operator') : null;
}
const list = (items: unknown[]) => ({ items, next_cursor: null });
const svg = (res: ServerResponse, body: string) => { res.statusCode = 200; res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'no-store'); res.end(body); };

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const c of req) raw += c;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
const range = (url: URL, defMs: number) => {
  const t = now();
  const to = Date.parse(url.searchParams.get('to') ?? '') || t;
  const from = Date.parse(url.searchParams.get('from') ?? '') || Date.parse(url.searchParams.get('since') ?? '') || to - defMs;
  return { from, to };
};
const v2alarm = (a: sim.SimAlarm) => ({
  id: String(a.id), tag_id: a.tag_id, rule_id: a.rule_id, rule: a.rule, severity: a.severity, state: a.state, raised_at: a.ts,
  acked_at: a.acked_at, acked_by: a.acked_by, cleared_at: a.cleared_at, version: a.version,
  shelved_until: a.shelved_until, assigned_to: a.assigned_to, assigned_name: a.assigned_name,
});
const adminRule = (r: sim.SimRule) => ({
  id: r.id, tag_id: idOf(r.tail), name: r.name, kind: r.kind, threshold: r.threshold, stale_s: r.stale_s,
  window_s: r.window_s, deadband: r.deadband, severity: r.severity, enabled: r.enabled,
});
const alarmEvents: Record<string, { kind: string; author: string; body: string; at: string }[]> = {};

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://mock');
  const p = url.pathname;
  const send = (code: number, data: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };

  // public routes
  if (p === '/api/auth/config') return send(200, { env: 'dev', dev_tokens: true, oidc: null });
  if (p === '/api/health') return send(200, { status: 'ok', db: 'up', mqtt: 'up', edge: 'up' });
  if (p === '/api/v1/status') {
    const since = iso(T0 - 9 * DAY);
    return send(200, { status: plant.EDGES.every((e) => e.online) ? 'operational' : 'degraded', env: 'dev', updated_at: iso(now()), components: [
      { name: 'api', ok: true, since }, { name: 'database', ok: true, since }, { name: 'mqtt', ok: true, since },
      ...plant.EDGES.map((e) => ({ name: e.name, ok: e.online, since: iso(T0 - 3 * DAY) })),
      { name: 'notifications', ok: true, since },
    ] });
  }
  // camera frames + event thumbnails load as <img src> (no auth header)
  const frame = /^\/api\/mock\/frame\/([\w-]+)$/.exec(p);
  if (frame) return svg(res, plant.frameSvg(frame[1]));
  const thumb = /^\/api\/v1\/orgs\/[^/]+\/vision\/events\/([\w-]+)\/thumb$/.exec(p);
  if (thumb) return svg(res, plant.frameSvg('cam-1'));

  const role = roleOf(req);
  if (!role) return send(401, { detail: 'mock: sign in with demo-operator or demo-viewer' });
  const t = now();
  const who = members.find((m) => m.sub === `demo-${role}`)?.display_name ?? `demo-${role}`;
  const operate = role !== 'viewer';
  const config = role === 'admin' || role === 'owner';

  if (p === '/api/me' || p === '/api/v1/me') {
    const perms = role === 'viewer' ? ['read'] : ['read', 'operate', 'config:write', 'member:manage', 'audit:read'];
    return send(200, {
      user: { sub: `demo-${role}`, display_name: `Demo ${role}` }, role, kind: 'dev',
      orgs: [{ org_id: plant.ORG, role }],
      memberships: [{ org_id: plant.ORG, org_name: 'Demo Plant', role, permissions: perms }],
    });
  }
  if (p === '/api/system/health') {
    return send(200, { mqtt: { connected: true }, edge: { last_heartbeat_ts: iso(t - 400), clock_ok: true }, backend: { uptime_s: Math.round((t - T0) / 1000) + 3 * 86400 } });
  }
  if (p === '/api/v1/consents') return send(200, { required: {}, given: {}, missing: [], current: true });
  if (p === '/api/v1/plant-kinds') return send(200, { kinds: PLANT_KINDS });
  if (p === '/api/v1/vision/material-schema') return send(200, MATERIAL_SCHEMA);
  if (p === '/api/v1/orgs' && req.method === 'GET') {
    return send(200, { items: [{ org_id: plant.ORG, name: 'Demo Plant', slug: 'demo-plant', plan: 'pro', role, suspended: false, deleted: false }] });
  }
  if (p.startsWith('/api/v1/platform/')) return platform(p.slice('/api/v1/platform'.length), send);

  // ── v1: tags, alarms, rules, commands ──
  if (p === '/api/tags') return send(200, sim.TAGS.map((g) => ({ name: g.name, writable: g.writable, ...(g.unit ? { unit: g.unit } : {}) })));
  if (p === '/api/tags/latest') { const ts = iso(t); return send(200, sim.snapshot().map((s) => ({ ...s, ts }))); }

  const tagRoute = /^\/api\/tags\/(.+)\/(latest|history|availability)$/.exec(p);
  if (tagRoute) {
    const name = decodeURIComponent(tagRoute[1]);
    const g = sim.tagByName(name);
    if (!g) return send(404, { detail: 'unknown tag' });
    if (tagRoute[2] === 'latest') return send(200, { name, v: sim.value(name), q: 'good', ts: iso(t) });
    const { from, to } = range(url, H);
    if (tagRoute[2] === 'availability') {
      // per-tag uptime so the SLO page shows OK / warning / breached rows
      const up = uptimeOf(name);
      const span = (to - from) / 1000;
      return send(200, { name, from: iso(from), to: iso(to), samples: Math.round(span), good_frac: up, uptime: up, down_s: Math.round(span * (1 - up)) });
    }
    const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 720);
    const rows = plant.series(g, from, to, limit, 'raw') as { ts: string; v: number | boolean }[];
    return send(200, rows.map((r) => ({ v: r.v, q: qAt(name, Date.parse(r.ts)), ts: r.ts })));
  }

  if (p === '/api/alarms') return send(200, sim.ALARMS.slice(0, 300));
  const ack = /^\/api\/alarms\/(\d+)\/ack$/.exec(p);
  if (ack && req.method === 'POST') {
    if (!operate) return send(403, { detail: 'operator role required' });
    const a = sim.ackAlarm(ack[1], who);
    if (!a) return send(404, { detail: 'unknown alarm' });
    (alarmEvents[ack[1]] ??= []).push({ kind: 'ack', author: who, body: '', at: iso(t) });
    return send(200, a);
  }
  if (p === '/api/insights') {
    const state = url.searchParams.get('state');
    return send(200, insights.filter((i) => !state || i.state === state));
  }
  if (p === '/api/alarm-rules') {
    return send(200, sim.RULES.map((r) => ({ tag: tagName(r.tail), name: r.name, kind: r.kind, threshold: r.threshold, stale_s: r.stale_s, window_s: r.window_s, deadband: r.deadband, severity: r.severity, enabled: r.enabled })));
  }
  if (p === '/api/commands') {
    if (!operate) return send(403, { detail: 'operator role required' });
    if (req.method === 'POST') {
      const b = await body(req);
      const r = issue(String(b.tag ?? ''), b.value, who);
      return send(r.code, r.body);
    }
    return send(200, commands.slice(0, Math.min(500, Number(url.searchParams.get('limit')) || 50)));
  }
  const cmd = /^\/api\/commands\/(.+)$/.exec(p);
  if (cmd) {
    const c = commands.find((x) => x.id === cmd[1]);
    return c ? send(200, c) : send(404, { detail: 'unknown command' });
  }

  // ── v2 org-scoped surface ──
  const v2 = /^\/api\/v1\/orgs\/([^/]+)(\/.*)?$/.exec(p);
  if (!v2) {
    res.setHeader('X-Mock-Fallback', '1');
    return send(404, { detail: `mock: ${req.method} ${p} not implemented` });
  }
  const rest = v2[2] ?? '';
  const GET = req.method === 'GET';
  if (rest === '') return send(200, { id: v2[1], name: 'Demo Plant', role, created_at: iso(T0 - 30 * DAY) });
  if (rest === '/sites') return send(200, list([{ id: plant.SITE_ID, name: 'Plant 1 — Lam Luk Ka', code: sim.SITE, timezone: 'Asia/Bangkok' }]));

  // site-scoped
  const sm = /^\/sites\/([^/]+)(\/.*)$/.exec(rest);
  if (sm) {
    const r = await site(sm[2], req, url, send, { role, who, operate, config, t });
    if (r !== undefined) return;
  }

  // incidents (member read; operator+ writes)
  if (rest === '/incidents' && GET) {
    return send(200, { incidents: [...mockIncidents].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), teams: MOCK_TEAMS.map(({ id, name }) => ({ id, name })) });
  }
  if (rest === '/incidents' && req.method === 'POST') {
    if (!operate) return send(403, { detail: 'operator role required' });
    const b = await body(req);
    const team = MOCK_TEAMS.find((x) => x.id === b.owner_team_id);
    const inc = { id: UID(`e${mockIncidents.length + 1}`), title: String(b.title ?? ''), severity: b.severity ?? 'warning', status: 'active', created_at: iso(t), acked_at: null, resolved_at: null, alarm_id: null, team_id: team?.id ?? null, team: team?.name ?? null, mine: true };
    mockIncidents.push(inc);
    mockIncEvents[String(inc.id)] = [{ kind: 'created', body: '', at: inc.created_at, who }];
    return send(201, { incident: inc });
  }
  const incDetail = /^\/incidents\/([^/]+)(\/status|\/notes)?$/.exec(rest);
  if (incDetail) {
    const inc = mockIncidents.find((x) => x.id === incDetail[1]);
    if (!inc) return send(404, { detail: 'incident not found' });
    const events = (mockIncEvents[String(inc.id)] ??= []);
    if (!incDetail[2] && GET) return send(200, { incident: inc, events });
    if (!operate) return send(403, { detail: 'operator role required' });
    const b = await body(req);
    if (incDetail[2] === '/status' && req.method === 'POST') {
      const s = String(b.status);
      if (s === 'acknowledged' && inc.status === 'active') { inc.status = 'acknowledged'; inc.acked_at = iso(t); }
      if (s === 'resolved' && inc.status !== 'resolved') {
        if (!inc.acked_at) inc.acked_at = iso(t);
        inc.status = 'resolved'; inc.resolved_at = iso(t);
      }
      events.push({ kind: 'status', body: s, at: iso(t), who });
      return send(200, { incident: inc });
    }
    if (incDetail[2] === '/notes' && req.method === 'POST') {
      events.push({ kind: 'note', body: String(b.body ?? ''), at: iso(t), who });
      return send(201, {});
    }
    return send(404, { detail: 'mock: not implemented' });
  }
  if (rest === '/teams' && GET) return send(200, { teams: MOCK_TEAMS });

  // on-call
  if (rest === '/oncall') {
    return send(200, list([
      { team_id: 'team-ops', team: 'Ops', user_id: 'u1', name: 'Somchai K.', source: 'rotation', rotation: ['u1', 'u2'] },
      { team_id: 'team-maint', team: 'Maintenance', user_id: 'u4', name: 'Arthit W.', source: 'override', rotation: ['u4'] },
    ]));
  }
  if (/\/teams\/team-maint\/oncall\/overrides$/.test(rest)) return send(200, list([{ id: 'ov-1', user_id: 'u4', name: 'Arthit W.', starts_at: iso(t - 6 * H), ends_at: iso(t + 18 * H) }]));
  if (/\/teams\/[^/]+\/oncall\/overrides$/.test(rest)) return send(200, list([]));
  if (rest === '/members') return send(200, list(members));
  if (rest === '/invites') return send(200, list(invites));
  if (rest === '/area-grants') return send(200, { grants: { u4: ['area-batch'] } });
  if (rest === '/api-keys') {
    return send(200, list([
      { id: 'k1', name: 'grafana-readonly', prefix: 'wds_a1b2', role: 'viewer', created_at: iso(T0 - 20 * DAY), expires_at: iso(T0 + 60 * DAY), last_used_at: iso(T0 - H), revoked_at: null },
      { id: 'k2', name: 'erp-sync', prefix: 'wds_c3d4', role: 'operator', created_at: iso(T0 - 200 * DAY), expires_at: null, last_used_at: iso(T0 - 150 * DAY), revoked_at: null },
      { id: 'k3', name: 'ci-deploy', prefix: 'wds_e5f6', role: 'admin', created_at: iso(T0 - 300 * DAY), expires_at: null, last_used_at: iso(T0 - 2 * DAY), revoked_at: null },
      { id: 'k4', name: 'old-dashboard', prefix: 'wds_0z9y', role: 'viewer', created_at: iso(T0 - 400 * DAY), expires_at: iso(T0 - 30 * DAY), last_used_at: null, revoked_at: iso(T0 - 30 * DAY) },
    ]));
  }

  // gateways: protocol sources, tags, cameras, capabilities
  const em = /^\/edges\/([^/]+)(\/.*)$/.exec(rest);
  if (em) {
    const [, edge, tail] = em;
    if (tail === '/sources' && GET) return send(200, { items: plant.sources(edge, t) });
    if (tail === '/sources:test') {
      const b = await body(req);
      return send(200, b.protocol === 'opcua' && !String((b.connection as Record<string, unknown> | undefined)?.endpoint ?? '').startsWith('opc.tcp://')
        ? { ok: false, detail: 'endpoint must start with opc.tcp://' }
        : { ok: true, detail: 'connected in 4 ms', sample: { value: 42.1, q: 'good' } });
    }
    const st = /^\/sources\/([^/]+)\/tags$/.exec(tail);
    if (st && GET) { const items = plant.sourceTags(st[1]); return items ? send(200, { items }) : send(404, { detail: 'unknown source' }); }
    const br = /^\/sources\/([^/]+)\/browse$/.exec(tail);
    if (br) { const b = await body(req); return send(200, { items: OPCUA_TREE[String(b.node_id ?? 'root')] ?? [] }); }
    if (tail === '/cameras' && GET) return send(200, { items: plant.cameras(edge, MATERIAL_SCHEMA.defaults) });
    if (tail === '/capabilities') {
      const online = plant.EDGES.find((e) => e.id === edge)?.online;
      return send(200, { capabilities: online ? { reported_at: iso(t - 30_000), cpu_cores: 8, ram_mb: 16384, device: edge === 'e1' ? 'Intel N305' : 'Jetson Orin Nano', providers: edge === 'e1' ? ['CPUExecutionProvider', 'OpenVINOExecutionProvider'] : ['CUDAExecutionProvider', 'CPUExecutionProvider'], loaded: ['vv-agg-3'] } : null });
    }
    if (/^\/cameras\/[^/]+$/.test(tail) && req.method === 'PATCH') {
      if (!config) return send(403, { detail: 'admin role required' });
      const cam = plant.cameras(edge, MATERIAL_SCHEMA.defaults).find((c) => tail.endsWith(`/${c.id}`));
      return cam ? send(200, { camera: { ...cam, ...(await body(req)) } }) : send(404, { detail: 'unknown camera' });
    }
  }
  const cam = /^\/cameras\/([^/]+)\/(stream-url|snapshot|model|rules|classes)$/.exec(rest);
  if (cam) {
    const [, id, what] = cam;
    if (what === 'stream-url') return send(200, { url: `/api/mock/frame/${id}`, expires_in: 60 });
    if (what === 'snapshot') return svg(res, plant.frameSvg(id));
    if (what === 'rules') return send(200, { items: plant.VISION_RULES.filter((r) => r.camera_id === id) });
    if (what === 'model') {
      const v = plant.VERSIONS.find((x) => x.status === 'active')!;
      return id === 'cam-3' ? send(200, { camera_id: id, model_version_id: null }) : send(200, { camera_id: id, model_version_id: v.id, model_id: v.model_id, version: v.version, classes: v.classes, placement: 'edge', class_config: {} });
    }
    return send(200, { class_config: {} });
  }

  // vision
  if (rest === '/vision/models' && GET) return send(200, { items: plant.modelsList() });
  const vmv = /^\/vision\/models\/([^/]+)\/(versions|presets)$/.exec(rest);
  if (vmv && GET) return send(200, { items: vmv[2] === 'versions' ? plant.VERSIONS.filter((v) => v.model_id === vmv[1]) : [] });
  if (rest === '/vision/rules' && GET) {
    const c = url.searchParams.get('camera');
    return send(200, { items: plant.VISION_RULES.filter((r) => !c || r.camera_id === c) });
  }
  const vrule = /^\/vision\/rules\/([^/]+)$/.exec(rest);
  if (vrule && GET) { const r = plant.VISION_RULES.find((x) => x.id === vrule[1]); return r ? send(200, { rule: r }) : send(404, { detail: 'unknown rule' }); }
  if (rest === '/vision/events' && GET) {
    return send(200, plant.visionEvents(Math.min(200, Number(url.searchParams.get('limit')) || 50), url.searchParams.get('kind') ?? undefined, url.searchParams.get('cursor') ?? undefined));
  }
  const vev = /^\/vision\/events\/([^/]+)(\/review)?$/.exec(rest);
  if (vev) {
    if (vev[2]) return send(200, { ok: true });
    const e = plant.visionEvents(200).items.find((x) => x.id === vev[1]);
    return e ? send(200, { event: e }) : send(404, { detail: 'unknown event' });
  }
  if (rest === '/vision/events/bulk-review') { const b = await body(req); return send(200, { updated: (b.event_ids as unknown[] | undefined)?.length ?? 0 }); }
  if (rest === '/vision/material/cameras') return send(200, { items: plant.materialCameras(MATERIAL_SCHEMA.defaults) });
  if (rest === '/vision/material/summary') return send(200, plant.materialSummary(Number(url.searchParams.get('minutes')) || 60));
  if (rest === '/vision/metrics') return send(200, plant.visionMetrics(Number(url.searchParams.get('minutes')) || 60));

  // feeds + quality
  if (rest === '/events') {
    const { from, to } = range(url, DAY);
    return send(200, list(plant.events(from, to, url.searchParams.get('type') ?? undefined, Math.min(500, Number(url.searchParams.get('limit')) || 100))));
  }
  if (rest === '/edge-logs') {
    const { from, to } = range(url, H);
    const g = (k: string) => url.searchParams.get(k) ?? undefined;
    return send(200, list(plant.edgeLogs(from, to, { edge: g('edge'), level: g('level'), q: g('q'), limit: Math.min(1000, Number(g('limit')) || 200) })));
  }
  if (rest === '/notification-deliveries') {
    const ch = url.searchParams.get('channel_id');
    return send(200, { items: plant.deliveries(80).filter((d) => !ch || d.channel_id === ch) });
  }
  if (rest === '/alarm-quality') return send(200, plant.alarmQuality(Math.min(168, Number(url.searchParams.get('hours')) || 24)));
  const al = /^\/alarms\/([^/]+)\/(events|shelve|unshelve|comments|assign|ack-link)$/.exec(rest);
  if (al) {
    const [, id, what] = al;
    const a = sim.ALARMS.find((x) => String(x.id) === id);
    const evs = (alarmEvents[id] ??= []);
    if (what === 'events') return send(200, { items: [...(a?.acked_by ? [{ kind: 'ack', author: a.acked_by, body: '', at: a.acked_at! }] : []), ...evs] });
    if (!operate) return send(403, { detail: 'operator role required' });
    const b = await body(req);
    if (what === 'ack-link') return send(200, { url: `${url.origin}/ack/mock-${id}`, expires_in: Number(b.ttl_s) || 3600 });
    if (!a) return send(404, { detail: 'unknown alarm' });
    if (what === 'shelve') { a.shelved_until = iso(t + (Number(b.minutes) || 60) * 60e3); evs.push({ kind: 'shelve', author: who, body: String(b.reason ?? ''), at: iso(t) }); return send(200, { shelved_until: a.shelved_until }); }
    if (what === 'unshelve') { a.shelved_until = null; evs.push({ kind: 'unshelve', author: who, body: '', at: iso(t) }); return send(200, {}); }
    if (what === 'comments') { evs.push({ kind: 'comment', author: who, body: String(b.body ?? ''), at: iso(t) }); return send(200, {}); }
    const m = members.find((x) => x.user_id === b.user_id);
    Object.assign(a, { assigned_to: m?.user_id ?? null, assigned_name: m?.display_name ?? null });
    evs.push({ kind: 'assign', author: who, body: m?.display_name ?? '', at: iso(t) });
    return send(200, {});
  }
  const rn = /^\/alarm-rules\/([^/]+)\/notify$/.exec(rest);
  if (rn) {
    if (req.method === 'PUT') { if (!config) return send(403, { detail: 'admin role required' }); ruleNotify[rn[1]] = await body(req); }
    return send(200, { notify: ruleNotify[rn[1]] ?? { channel_ids: ['c-1'], team_ids: [], oncall_team: 'team-ops', min_severity: 'warning', on_clear: false } });
  }

  // production (org-level)
  if (rest === '/downtime-reasons' && GET) return send(200, { items: plant.REASONS });

  // people + org settings
  if (rest === '/onboarding') {
    // derived from the mock's own lists, never hard-coded to "all done"
    const steps: [string, string, boolean][] = [
      ['gateway', '/infrastructure/sources', plant.edges(t).length > 0], ['data', '/infrastructure/sources', sim.TAGS.some((g) => sim.value(g.name) != null)],
      ['dashboard', '/dashboards?new=1', dashboards.some((d) => d.mine)], ['alarm_rule', '/admin/rules/new', sim.RULES.some((r) => r.enabled)],
      ['notify', '/settings', v2channels.some((c) => c.enabled)], ['teammate', '/admin/users', members.length > 1],
    ];
    const done = steps.filter((x) => x[2]).length;
    return send(200, { steps: steps.map(([id, href, d]) => ({ id, done: d, href })), done, total: steps.length });
  }
  if (rest === '/security') {
    if (req.method === 'PATCH') { if (!config) return send(403, { detail: 'admin role required' }); Object.assign(security, await body(req)); }
    return send(200, security);
  }
  if (rest === '/storage') return send(200, storage());
  if (rest === '/usage') return send(200, usage());
  if (rest === '/webhooks') return send(200, { items: webhooks });
  if (rest === '/webhook-deliveries') {
    return send(200, { items: Array.from({ length: 12 }, (_, i) => ({ id: 500 - i, endpoint_id: i % 3 ? 'wh-2' : 'wh-1', event: i % 3 ? 'alarm_raised' : 'downtime_classified', status: i === 4 ? 'failed' : 'sent', attempts: i === 4 ? 5 : 1, last_code: i === 4 ? 502 : 200, last_error: i === 4 ? 'Bad Gateway' : null, at: iso(t - i * 47 * 60e3) })) });
  }
  if (rest === '/exports') return send(200, { items: [{ id: 'ex-1', status: 'done', size_bytes: 48_200_000, created_at: iso(t - 3 * DAY), ready_at: iso(t - 3 * DAY + 4 * 60e3), expires_at: iso(t + 4 * DAY) }] });
  if (rest === '/feature-flags') return send(200, { flags: { assistant: true, plant_twin: true, vision_material: true, web_push: true } });
  if (rest === '/announcements') return send(200, { items: [] });
  if (rest === '/support-sessions') return send(200, { items: [] });
  if (rest === '/notebooks') {
    if (req.method === 'POST') {
      if (!operate) return send(403, { detail: 'operator role required' });
      const b = await body(req);
      const n = { id: String(b.id ?? `nb-${notebooks.length + 1}`), title: String(b.title ?? ''), body: String(b.body ?? ''), shared: !!b.shared, mine: true, updated_at: iso(t) };
      notebooks.unshift(n);
      return send(200, { notebook: n });
    }
    return send(200, { notebooks });
  }
  const nb = /^\/notebooks\/([^/]+)$/.exec(rest);
  if (nb) {
    const n = notebooks.find((x) => x.id === nb[1]);
    if (!n) return send(404, { detail: 'unknown notebook' });
    if (req.method === 'PUT') { const b = await body(req); Object.assign(n, { title: b.title ?? n.title, body: b.body ?? n.body, shared: b.shared ?? n.shared, updated_at: iso(t) }); return send(200, { notebook: n }); }
    if (req.method === 'DELETE') { notebooks.splice(notebooks.indexOf(n), 1); res.statusCode = 204; res.end(); return; }
    return send(200, { notebook: n });
  }
  if (rest === '/inference') {
    return send(200, { configured: true, model: 'isolation-forest v2 (edge)', ts: t - 4000, latency_ms: 18, error: null, results: [
      { tag: tagName('sort.line1.conv1.temp_c'), label: 'drift', score: 0.82, severity: 'warning', detail: 'rising 2.4 °C/h at constant speed' },
      { tag: tagName('batch.mix.mixer1.current_a'), label: 'normal', score: 0.12, severity: 'info', detail: 'within the learned band' },
    ] });
  }

  // dashboards — custom board bodies synced by useDashboards
  const dash = /^\/dashboards(?:\/([^/]+))?$/.exec(rest);
  if (dash) {
    const id = dash[1];
    if (GET && !id) return send(200, { dashboards });
    if (role === 'viewer' && !GET) return send(403, { detail: 'viewer role cannot write dashboards' });
    if (req.method === 'POST' && !id) {
      const row = { ...(await body(req)), updated_at: iso(t), mine: true };
      dashboards.push(row);
      return send(200, row);
    }
    const d = dashboards.find((x) => x.id === id);
    if (!d) return send(404, { detail: 'unknown dashboard' });
    if (req.method === 'PUT') { Object.assign(d, await body(req), { updated_at: iso(t) }); return send(200, d); }
    if (req.method === 'DELETE') { dashboards.splice(dashboards.indexOf(d), 1); return send(200, {}); }
  }

  // report schedules — writes need admin|owner like the backend
  const sched = /^\/report-schedules(?:\/([^/]+))?$/.exec(rest);
  if (sched) {
    const id = sched[1];
    if (GET && !id) return send(200, list(schedules));
    if (!config) return send(403, { detail: 'admin role required' });
    if (req.method === 'POST' && !id) {
      const b = await body(req);
      const row = { id: `rs-${schedules.length + 1}`, site_id: b.site_id ?? null, last_run_at: null, created_at: iso(t), ...b };
      schedules.push(row);
      return send(200, { schedule: row });
    }
    const s = schedules.find((x) => x.id === id);
    if (!s) return send(404, { detail: 'unknown schedule' });
    if (req.method === 'PATCH') { Object.assign(s, await body(req)); return send(200, { schedule: s }); }
    if (req.method === 'DELETE') { schedules.splice(schedules.indexOf(s), 1); return send(200, {}); }
  }

  // on-demand report downloads — CSV text or a printable HTML page
  const rep = /^\/reports\/(shift|daily|weekly_oee|monthly_alarms)$/.exec(rest);
  if (rep && GET) {
    const fmt = url.searchParams.get('format') ?? 'csv';
    const name = rep[1];
    const o = plant.oee(t - DAY, t).totals;
    const csv = `metric,value\noee_pct,${((o.oee ?? 0) * 100).toFixed(1)}\navailability_pct,${((o.availability ?? 0) * 100).toFixed(1)}\nunits,${o.units}\nalarms_24h,${sim.ALARMS.filter((a) => t - Date.parse(a.ts) < DAY).length}\nopen_alarms,${sim.ALARMS.filter((a) => a.state !== 'cleared').length}\nm3_total,${sim.value(tagName('batch.plant.production.m3_total'))}\n`;
    res.statusCode = 200;
    if (fmt === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`);
      res.end(`<!doctype html><title>${name} report</title><h1>${name} report</h1><p>Demo Plant — generated ${iso(t)}</p><pre>${csv}</pre>`);
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.end(csv);
    return;
  }

  if (rest === '/slos' || rest.startsWith('/slos/')) {
    const m = /^\/slos(\/([^/]+))?(\/corrections(\/([^/]+))?)?$/.exec(rest);
    const id = m?.[2];
    const cid = m?.[5];
    if (rest.startsWith('/slos/status')) {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
      const covered = days * 86400;
      return send(200, { days, items: slos.map((s) => {
        const excluded = s.corrections.reduce((n, c) => n + Math.max(0, (Date.parse(c.ends_at) - Date.parse(c.starts_at)) / 1000), 0);
        return { id: s.id, samples: covered - Math.round(excluded), excluded: Math.round(excluded), sli: +(uptimeOf(s.tag ?? '') * 100).toFixed(3), covered_s: covered };
      }) });
    }
    if (!id && GET) return send(200, list(slos));
    if (!config && !GET) return send(403, { detail: 'config:write required' });
    if (!id && req.method === 'POST') {
      const b = await body(req);
      const target = Number(b.target ?? 99);
      const s: MockSlo = {
        id: `slo-${slos.length + 1}`, name: String(b.name ?? ''), description: String(b.description ?? ''),
        tag: (b.tag as string) ?? null, tag_id: sim.tagByName(String(b.tag))?.id ?? '',
        target, warning: Number(b.warning ?? (target + (100 - target) / 2)), updated_at: iso(t), corrections: [],
      };
      if (slos.some((x) => x.name === s.name)) return send(409, { detail: 'name exists' });
      slos.push(s);
      return send(201, { slo: s });
    }
    const s = slos.find((x) => x.id === id);
    if (!s) return send(404, { detail: 'unknown slo' });
    if (cid) { s.corrections = s.corrections.filter((c) => c.id !== cid); res.statusCode = 204; res.end(); return; }
    if (m?.[3] && req.method === 'POST') {
      const b = await body(req);
      const c = { id: `cor-${s.corrections.length + 1}`, starts_at: String(b.starts_at), ends_at: String(b.ends_at), reason: String(b.reason ?? '') };
      s.corrections.push(c); s.updated_at = iso(t);
      return send(201, { correction: c });
    }
    if (req.method === 'PATCH') {
      const b = await body(req);
      Object.assign(s, { name: b.name ?? s.name, description: b.description ?? s.description, tag: b.tag ?? s.tag, target: b.target ?? s.target, warning: b.warning ?? s.warning, updated_at: iso(t) });
      return send(200, { slo: s });
    }
    if (req.method === 'DELETE') { slos.splice(slos.indexOf(s), 1); res.statusCode = 204; res.end(); return; }
    return send(200, s);
  }
  if (rest.startsWith('/audit')) {
    const action = url.searchParams.get('action');
    const acts = ['auth.login', 'auth.login', 'auth.login', 'member.updated', 'alarm_rule.created', 'alarm_rule.updated', 'edge.rotated', 'downtime.classified', 'command.issued', 'datasource.updated'];
    const actors = ['user:somchai', 'user:nok', 'user:admin', 'user:arthit'];
    const noise = Array.from({ length: 80 }, (_, i) => ({
      seq: 200 + i, at: iso(T0 - i * 2.5 * H), actor: actors[i % actors.length], action: acts[i % acts.length], target: {}, detail: {}, hash: `h${i}`,
    }));
    const all = [...noise, ...auditSeed].sort((a, b) => b.at.localeCompare(a.at));
    const filtered = action ? all.filter((a) => a.action === action) : all;
    return send(200, list(filtered.slice(0, Math.min(500, Number(url.searchParams.get('limit')) || 50))));
  }

  // config surfaces — writes are admin|owner only (mirrors the backend's config:write gate)
  const ch = /^\/notification-channels(\/[^/]+)?$/.exec(rest);
  if (ch) {
    if (!GET && !config) return send(403, { detail: 'admin role required' });
    const id = ch[1]?.slice(1);
    if (id) {
      const c = v2channels.find((x) => x.id === id);
      if (!c) return send(404, { detail: 'unknown channel' });
      if (req.method === 'PATCH') { Object.assign(c, await body(req)); return send(200, { channel: c }); }
      if (req.method === 'DELETE') { v2channels.splice(v2channels.indexOf(c), 1); return send(200, { deleted: id }); }
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const c = { id: `c-${v2channels.length + 1}`, name: String(b.name ?? 'channel'), type: String(b.type ?? 'email'), team_id: b.team_id ?? null, enabled: b.enabled !== false, has_secrets: false, config: b.config ?? {}, created_at: iso(t) };
      v2channels.push(c);
      return send(200, { channel: c });
    }
    return send(200, list(v2channels));
  }
  if (/^\/notification-channels\/[^/]+\/test$/.test(rest)) return send(200, { status: 'sent' });
  const pol = /^\/escalation-policies(\/[^/]+)?$/.exec(rest);
  if (pol) {
    if (!GET && !config) return send(403, { detail: 'admin role required' });
    const id = pol[1]?.slice(1);
    if (id) {
      const x = v2policies.find((e) => e.id === id);
      if (!x) return send(404, { detail: 'unknown policy' });
      if (req.method === 'PATCH') { Object.assign(x, await body(req)); return send(200, { policy: x }); }
      if (req.method === 'DELETE') { v2policies.splice(v2policies.indexOf(x), 1); return send(200, { deleted: id }); }
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const x = { id: `p-${v2policies.length + 1}`, name: String(b.name ?? 'policy'), rule_id: b.rule_id ?? null, levels: b.levels ?? [], enabled: b.enabled !== false, created_at: iso(t) };
      v2policies.push(x);
      return send(200, { policy: x });
    }
    return send(200, list(v2policies));
  }
  if (rest === '/downtimes') {
    if (req.method === 'POST') {
      if (!operate) return send(403, { detail: 'operator role required' });
      const b = await body(req);
      const d = { id: `d-${v2downtimes.length + 1}`, rule_id: b.rule_id ?? null, rule: sim.RULES.find((r) => r.id === b.rule_id)?.name ?? null, description: String(b.description ?? ''), starts_at: String(b.starts_at), ends_at: String(b.ends_at), recurring: !!b.recurring, mine: true };
      v2downtimes.push(d);
      return send(200, { downtime: d });
    }
    return send(200, { downtimes: v2downtimes, rules: sim.RULES.map((r) => ({ id: r.id, name: r.name })) });
  }

  // unknown org route: empty list, flagged so a crawl can list what the mock lacks
  res.setHeader('X-Mock-Fallback', '1');
  return send(200, list([]));
}

interface Ctx { role: string; who: string; operate: boolean; config: boolean; t: number }
type Send = (code: number, data: unknown) => void;

/** /api/v1/orgs/:org/sites/:site/... — returns undefined when not handled. */
async function site(rest: string, req: IncomingMessage, url: URL, send: Send, c: Ctx): Promise<true | undefined> {
  const GET = req.method === 'GET';
  const q = (k: string) => url.searchParams.get(k) ?? undefined;
  const done = (code: number, data: unknown): true => { send(code, data); return true; };
  const t = c.t;

  if (rest === '/tags') return done(200, list(plant.siteTags()));
  if (rest === '/tags/latest') { const ts = iso(t); return done(200, { items: sim.TAGS.map((g) => ({ tag_id: g.id, v: sim.value(g.name) ?? null, q: 'good', ts })) }); }
  if (rest === '/tag-history') {
    const g = plant.tagByPath(q('tag') ?? '') ?? plant.tagById(q('tag') ?? '');
    if (!g) return done(404, { detail: 'unknown tag' });
    const { from, to } = range(url, H);
    const agg = q('agg') ?? 'raw';
    const bucket = Number(q('bucket_s')) || undefined;
    const rows = plant.series(g, from, to, Math.min(5000, Number(q('limit')) || 2000), agg, bucket);
    return done(200, { tag: { id: g.id, path: plant.pathOf(g), name: g.tail.split('.').pop(), unit: g.unit ?? null }, from: iso(from), to: iso(to), agg, ...(bucket ? { bucket_s: bucket } : {}), truncated: false, rows });
  }
  if (rest === '/tag-stats') { const { from, to } = range(url, H); return done(200, { from: iso(from), to: iso(to), gap_s: 30, items: plant.tagStats(from, to) }); }
  if (rest === '/hierarchy') return done(200, plant.hierarchy(q('tags') === 'true'));
  if (rest === '/health') return done(200, plant.siteHealth(t));
  if (rest === '/edges' && GET) return done(200, list(plant.edges(t)));
  if (rest === '/commands') return done(200, list(commands.slice(0, Number(q('limit')) || 50).map(cmdV2)));
  const sc = /^\/commands\/([^/]+)$/.exec(rest);
  if (sc) {
    const x = commands.find((y) => y.id === decodeURIComponent(sc[1]));
    return x ? done(200, { command: { ...cmdV2(x), events: x.events.map((e) => ({ ...e, from: CMD_V2[e.from] ?? e.from, to: CMD_V2[e.to] ?? e.to, reason: e.reason ?? null })) } }) : done(404, { detail: 'unknown command' });
  }

  // alarms + rules — rules are the simulator's, so edits change what raises
  if (rest === '/alarms') return done(200, list(sim.ALARMS.slice(0, Math.min(1000, Number(q('limit')) || 200)).map(v2alarm)));
  const rr = /^\/alarm-rules(?:\/([^/]+))?$/.exec(rest);
  if (rr) {
    if (!GET && !c.config) return done(403, { detail: 'admin role required' });
    const id = rr[1];
    if (id) {
      const r = sim.RULES.find((x) => x.id === id);
      if (!r) return done(404, { detail: 'unknown rule' });
      if (req.method === 'PATCH') {
        const b = await body(req);
        for (const k of ['name', 'kind', 'threshold', 'stale_s', 'window_s', 'deadband', 'severity', 'enabled'] as const) if (k in b) (r as unknown as Record<string, unknown>)[k] = b[k];
        return done(200, { rule: adminRule(r) });
      }
      if (req.method === 'DELETE') { sim.RULES.splice(sim.RULES.indexOf(r), 1); return done(200, { deleted: id }); }
      return done(200, { rule: adminRule(r) });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const g = plant.tagById(String(b.tag_id ?? ''));
      if (!g) return done(422, { detail: 'invalid_field', field: 'tag_id', message: 'unknown tag' });
      if (sim.RULES.some((x) => x.tail === g.tail && x.name === b.name)) return done(409, { detail: 'a rule with this name already exists on that tag' });
      const r: sim.SimRule = {
        id: `r-${sim.RULES.length + 1}-${t % 1000}`, tail: g.tail, name: String(b.name ?? 'rule'), kind: (b.kind ?? 'hi') as sim.SimRule['kind'],
        threshold: (b.threshold as number | null) ?? null, stale_s: (b.stale_s as number | null) ?? null, window_s: (b.window_s as number | null) ?? null,
        deadband: Number(b.deadband ?? 0), severity: (b.severity ?? 'info') as sim.SimRule['severity'], enabled: b.enabled !== false,
      };
      sim.RULES.push(r);
      return done(200, { rule: adminRule(r) });
    }
    return done(200, list(sim.RULES.map(adminRule)));
  }

  // derived tags
  if (rest === '/derived-tags' && GET) return done(200, { items: derived });
  if (rest === '/formulas/validate') {
    const b = await body(req);
    const inputs = Object.entries((b.inputs as Record<string, string>) ?? {}).map(([v, id]) => {
      const g = plant.tagById(id);
      return { var: v, tag_id: id, path: g ? plant.pathOf(g) : '', value: g ? sim.value(g.name) ?? null : null, q: g ? 'good' : null };
    });
    // shortcut: the mock does not evaluate formulas; the real engine is backend/app/production/formula.py
    return done(200, { ok: true, type: /[<>=]/.test(String(b.expr ?? '')) ? 'bool' : 'number', value: null, quality: 'good', inputs, windows: /\d+[smhd]\)/.test(String(b.expr ?? '')) ? 1 : 0, max_window_s: 0 });
  }

  // plant model: no uploaded .glb → the console shows the bundled demo plant
  if (rest === '/plant-models/active') return done(200, { model: null, parts: [] });
  if (rest === '/plant-models' && GET) return done(200, { items: [] });

  // production: shifts, machines, downtime, OEE
  if (rest === '/shifts' && GET) return done(200, list(plant.SHIFTS));
  if (rest === '/shifts/current') return done(200, plant.currentShift(t));
  if (rest === '/nonworking-days' && GET) return done(200, list(plant.NONWORKING));
  if (rest === '/machines') {
    const tags = sim.TAGS.map((g) => ({ id: g.id, path: plant.pathOf(g), name: g.tail.split('.').pop()!, type: g.type }));
    return done(200, { items: plant.MACHINES.map(({ device_id, name, line_id, line, configured }) => ({ device_id, name, line_id, line, configured })), tags });
  }
  const mach = /^\/machines\/([^/]+)\/(state-map|products|timeline)$/.exec(rest);
  if (mach) {
    const m = plant.MACHINES.find((x) => x.device_id === mach[1]);
    if (!m) return done(404, { detail: 'unknown machine' });
    if (mach[2] === 'timeline') { const { from, to } = range(url, 8 * H); return done(200, list(plant.timeline(m.device_id, from, to))); }
    if (mach[2] === 'products') return done(200, list(m.configured ? [{ id: `pr-${m.device_id}`, product: m.device_id === plant.SORTER ? 'Gravel 3/4"' : 'Concrete C30', ideal_cycle_s: m.ideal_cycle_s, active: true }] : []));
    if (!m.configured) return done(404, { detail: 'no state map' });
    return done(200, { map: { device_id: m.device_id, state_tag_id: idOf(m.state), count_tag_id: m.device_id === plant.MIXER ? idOf('batch.mix.truck.count') : null, reject_tag_id: null, states: { running: [true], stopped: [false] }, stop_threshold_s: 60, updated_at: iso(T0 - 7 * DAY) } });
  }
  if (rest === '/downtime-events' && GET) {
    const { from, to } = range(url, DAY);
    const nr = q('needs_reason');
    return done(200, list(plant.dtEvents(from, to, nr == null ? undefined : nr === 'true')));
  }
  const cls = /^\/downtime-events\/([^/]+)\/classify$/.exec(rest);
  if (cls) {
    if (!c.operate) return done(403, { detail: 'operator role required' });
    const b = await body(req);
    const d = plant.classify(cls[1], (b.reason_id as string | null) ?? null, (b.note as string | null) ?? null);
    return d ? done(200, { downtime: d }) : done(404, { detail: 'unknown downtime' });
  }
  if (rest === '/oee') { const { from, to } = range(url, 8 * H); return done(200, plant.oee(from, to, q('device'))); }
  if (rest === '/oee/pareto') { const { from, to } = range(url, 7 * DAY); return done(200, { items: plant.pareto(from, to) }); }
  if (rest === '/oee/trend') return done(200, { items: plant.trend(Math.min(26, Number(q('weeks')) || 8)), timezone: 'Asia/Bangkok' });
  return undefined;
}

function platform(rest: string, send: Send): void {
  const orgRow = {
    id: plant.ORG, name: 'Demo Plant', slug: 'demo-plant', plan: 'pro', plan_limits: { edges: 10, tags: 2000 }, trial_ends_at: null,
    suspended: false, suspended_reason: null, deleted: false, deleted_at: null, created_at: iso(T0 - 400 * DAY),
    usage: usage().usage, edge_health: { active: 3, online: 2, last_hb_at: iso(now() - 400) }, last_activity_at: iso(now() - 60e3),
  };
  const others = [
    { ...orgRow, id: 'org-ckp', name: 'CKP Aggregates', slug: 'ckp-aggregates', plan: 'starter', created_at: iso(T0 - 90 * DAY), edge_health: { active: 1, online: 1, last_hb_at: iso(now() - 2000) }, last_activity_at: iso(now() - 3 * H) },
    { ...orgRow, id: 'org-trial', name: 'Rayong Precast (trial)', slug: 'rayong-precast', plan: 'trial', trial_ends_at: iso(T0 + 9 * DAY), created_at: iso(T0 - 5 * DAY), edge_health: { active: 0, online: 0, last_hb_at: null }, last_activity_at: iso(now() - DAY) },
  ];
  if (rest === '/orgs') return send(200, { items: [orgRow, ...others] });
  if (rest.startsWith('/orgs/')) return send(200, { org: orgRow, usage: usage(), members });
  if (rest === '/health') {
    return send(200, { counters: { ws_clients: clients.size, tag_msgs_1m: sim.TAGS.length * 120 }, jobs: { pending: 0, running: 1, dead: 0, done_last_hour: 42 },
      notification_deliveries_1h: { sent: 9, failed: 0, retrying: 0, suppressed: 2 }, orgs: { total: 3, suspended: 0, deleted: 0 }, support_sessions_active: 0, mqtt_connected: true });
  }
  return send(200, { items: [] });
}

export function mockApi(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      const stop = sim.start();
      linkIncidents();
      sim.subscribe((msg) => broadcast(msg));
      const beat = setInterval(() => broadcast({ type: 'health', mqtt: 'up', edge: 'up' }), 5000);
      server.httpServer?.once('close', () => { stop(); clearInterval(beat); for (const c of clients) c.close(1001); });
      if (server.httpServer) {
        attachWs(server.httpServer as import('node:http').Server, '/ws', (conn) => {
          // first frame must be {type:'auth', token:'demo-…'} within 5 s, as the backend requires
          const deadline = setTimeout(() => conn.close(4401), 5000);
          let authed = false;
          conn.onText((text) => {
            let m: { type?: string; token?: string };
            try { m = JSON.parse(text); } catch { return; }
            if (!authed) {
              if (m.type !== 'auth' || !roleOfToken(m.token)) { conn.close(4401); return; }
              authed = true;
              clearTimeout(deadline);
              clients.add(conn);
              conn.send({ type: 'health', mqtt: 'up', edge: 'up' });
              return;
            }
            if (m.type === 'ping') conn.send({ type: 'pong', ts: iso(now()) });
          });
          conn.onClose(() => { clearTimeout(deadline); clients.delete(conn); });
        });
      }
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        handle(req, res).catch((e) => { res.statusCode = 500; res.end(String(e)); });
      });
    },
  };
}
