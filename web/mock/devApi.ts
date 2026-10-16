// Dev-only mock of the /api surface (CONTRACT shapes) so the console runs
// without the backend stack. Enabled by MOCK_API=1 (see vite.config.ts).
// shortcut: in-memory, resets on restart; no WebSocket — the shell shows
// "offline" for live updates. Use the real backend for anything beyond UI work.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const TAGS = [
  { name: 'plant1.sort.line1.motor1.running', writable: true },
  { name: 'plant1.sort.line1.motor1.speed_sp', writable: true, unit: 'Hz' },
  { name: 'plant1.sort.line1.conv1.speed_mps', writable: false, unit: 'm/s' },
  { name: 'plant1.sort.line1.conv1.temp_c', writable: false, unit: '°C' },
  { name: 'plant1.sort.line1.bin1.level_pct', writable: false, unit: '%' },
  { name: 'plant1.sort.vision.cam1.gravel_ratio', writable: false, unit: '%' },
];

/** Smooth deterministic signal per tag at time t (ms). */
function value(name: string, t: number): number | boolean {
  const s = t / 1000;
  if (name.endsWith('.running')) return true;
  if (name.endsWith('.speed_sp')) return 42;
  if (name.endsWith('.speed_mps')) return +(1.4 + 0.08 * Math.sin(s / 30)).toFixed(3);
  if (name.endsWith('.temp_c')) return +(61 + 6 * Math.sin(s / 300) + 1.5 * Math.sin(s / 17)).toFixed(2);
  if (name.endsWith('.level_pct')) return +(((s / 20) % 100)).toFixed(1);
  return +(0.55 + 0.08 * Math.sin(s / 120)).toFixed(3); // gravel_ratio is a 0–1 fraction
}

const iso = (ms: number) => new Date(ms).toISOString();
const now = () => Date.now();
const T0 = now();

const alarms = [
  { id: 101, tag: 'plant1.sort.line1.conv1.temp_c', rule: 'conveyor temp HiHi > 75 °C', severity: 'critical', state: 'active', ts: iso(T0 - 7 * 60e3), acked_by: null, acked_at: null, cleared_at: null, version: 1 },
  { id: 102, tag: 'plant1.sort.line1.bin1.level_pct', rule: 'bin level Hi > 90 %', severity: 'warning', state: 'active', ts: iso(T0 - 25 * 60e3), acked_by: null, acked_at: null, cleared_at: null, version: 1 },
  { id: 103, tag: 'plant1.sort.line1.conv1.speed_mps', rule: 'belt speed Lo < 1.0 m/s', severity: 'warning', state: 'acked', ts: iso(T0 - 70 * 60e3), acked_by: 'demo-operator', acked_at: iso(T0 - 62 * 60e3), cleared_at: null, version: 2 },
  { id: 104, tag: 'plant1.sort.vision.cam1.gravel_ratio', rule: 'vision stale > 30 s', severity: 'info', state: 'cleared', ts: iso(T0 - 180 * 60e3), acked_by: 'demo-operator', acked_at: iso(T0 - 175 * 60e3), cleared_at: iso(T0 - 150 * 60e3), version: 3 },
];

const insights = [
  { id: 'ins-1', tag: 'plant1.sort.line1.conv1.temp_c', kind: 'drift', severity: 'warning', score: 0.82, state: 'open', ts_start: iso(T0 - 40 * 60e3), ts_end: null, detail: { slope_per_h: 2.4 } },
  { id: 'ins-2', tag: 'plant1.sort.line1.conv1.speed_mps', kind: 'anomaly', severity: 'info', score: 0.61, state: 'open', ts_start: iso(T0 - 15 * 60e3), ts_end: null, detail: { z: 3.1 } },
];

const rules = [
  { tag: 'plant1.sort.line1.conv1.temp_c', name: 'conveyor temp HiHi', kind: 'hihi', threshold: 75, stale_s: null, deadband: 1, severity: 'critical', enabled: true },
  { tag: 'plant1.sort.line1.bin1.level_pct', name: 'bin level Hi', kind: 'hi', threshold: 90, stale_s: null, deadband: 2, severity: 'warning', enabled: true },
  { tag: 'plant1.sort.vision.cam1.gravel_ratio', name: 'vision stale', kind: 'stale', threshold: null, stale_s: 30, deadband: 0, severity: 'info', enabled: true },
];

const commands: Record<string, unknown>[] = [];

// ---- WP-E: incidents + notification fixtures (in-memory, CONTRACT shapes) --
const UID = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const MOCK_TAGS = [
  { id: UID('a1'), path: 'sort.line1.motor1.running', name: 'drive motor running', type: 'bool', unit: null },
  { id: UID('a2'), path: 'sort.line1.conv1.temp_c', name: 'conveyor temp', type: 'number', unit: '°C' },
  { id: UID('a3'), path: 'sort.line1.bin1.level_pct', name: 'bin level', type: 'number', unit: '%' },
  { id: UID('a4'), path: 'sort.vision.cam1.gravel_ratio', name: 'gravel ratio', type: 'number', unit: '%' },
];
const MOCK_RULES = [
  { id: UID('b1'), tag_id: UID('a2'), name: 'conveyor temp HiHi', kind: 'hihi', threshold: 75, stale_s: null, window_s: null, deadband: 1, severity: 'critical', enabled: true },
  { id: UID('b2'), tag_id: UID('a3'), name: 'bin level Hi', kind: 'hi', threshold: 90, stale_s: null, window_s: null, deadband: 2, severity: 'warning', enabled: true },
  { id: UID('b3'), tag_id: UID('a4'), name: 'vision stale', kind: 'stale', threshold: null, stale_s: 30, window_s: null, deadband: 0, severity: 'info', enabled: true },
];
const MOCK_V2_ALARMS = [
  { id: UID('c1'), tag_id: UID('a2'), rule_id: UID('b1'), rule: 'conveyor temp HiHi', severity: 'critical', state: 'active', raised_at: iso(T0 - 7 * 60e3), acked_at: null, acked_by: null, cleared_at: null, version: 1 },
  { id: UID('c2'), tag_id: UID('a3'), rule_id: UID('b2'), rule: 'bin level Hi', severity: 'warning', state: 'acked', raised_at: iso(T0 - 25 * 60e3), acked_at: iso(T0 - 20 * 60e3), acked_by: 'demo-operator', cleared_at: null, version: 2 },
  { id: UID('c3'), tag_id: UID('a4'), rule_id: UID('b3'), rule: 'vision stale', severity: 'info', state: 'cleared', raised_at: iso(T0 - 180 * 60e3), acked_at: iso(T0 - 175 * 60e3), acked_by: 'demo-operator', cleared_at: iso(T0 - 150 * 60e3), version: 3 },
];
const MOCK_TEAMS = [
  { id: 'team-ops', name: 'Ops', description: 'shift operators', members: [{ user_id: 'u1', name: 'Demo operator' }] },
  { id: 'team-maint', name: 'Maintenance', description: 'mechanical & electrical', members: [] },
];
const mockIncidents: Record<string, unknown>[] = [
  { id: UID('d1'), title: 'Conveyor overheating above HiHi', severity: 'critical', status: 'active', created_at: iso(T0 - 6 * 60e3), acked_at: null, resolved_at: null, alarm_id: UID('c1'), team_id: 'team-ops', team: 'Ops', mine: true },
  { id: UID('d2'), title: 'Bin 1 filling faster than discharge', severity: 'warning', status: 'acknowledged', created_at: iso(T0 - 40 * 60e3), acked_at: iso(T0 - 30 * 60e3), resolved_at: null, alarm_id: UID('c2'), team_id: 'team-maint', team: 'Maintenance', mine: false },
  { id: UID('d3'), title: 'Vision feed went stale mid-shift', severity: 'info', status: 'resolved', created_at: iso(T0 - 26 * 3600e3), acked_at: iso(T0 - 25 * 3600e3), resolved_at: iso(T0 - 24 * 3600e3), alarm_id: UID('c3'), team_id: null, team: null, mine: false },
  { id: UID('d4'), title: 'Manual declare — belt slip observed', severity: 'warning', status: 'active', created_at: iso(T0 - 3 * 3600e3), acked_at: null, resolved_at: null, alarm_id: null, team_id: 'team-ops', team: 'Ops', mine: false },
];
const mockIncEvents: Record<string, Record<string, unknown>[]> = {
  [UID('d1')]: [
    { kind: 'created', body: '', at: iso(T0 - 6 * 60e3), who: 'demo-operator' },
  ],
  [UID('d2')]: [
    { kind: 'created', body: '', at: iso(T0 - 40 * 60e3), who: 'demo-operator' },
    { kind: 'status', body: 'acknowledged', at: iso(T0 - 30 * 60e3), who: 'demo-operator' },
    { kind: 'note', body: 'Maintenance is checking the discharge gate.', at: iso(T0 - 12 * 60e3), who: 'demo-operator' },
  ],
  [UID('d3')]: [
    { kind: 'created', body: '', at: iso(T0 - 26 * 3600e3), who: 'demo-operator' },
    { kind: 'status', body: 'acknowledged', at: iso(T0 - 25 * 3600e3), who: 'demo-operator' },
    { kind: 'status', body: 'resolved', at: iso(T0 - 24 * 3600e3), who: 'demo-operator' },
  ],
  [UID('d4')]: [
    { kind: 'created', body: '', at: iso(T0 - 3 * 3600e3), who: 'demo-operator' },
    { kind: 'note', body: 'Operator on shift 2 reported slipping sounds at conv1.', at: iso(T0 - 2 * 3600e3), who: 'demo-operator' },
  ],
};
const mockChannels: Record<string, unknown>[] = [
  { id: 'ch-1', name: 'Ops email', type: 'email', team_id: 'team-ops', enabled: true, has_secrets: false, config: { to: ['ops@demo.local'] }, created_at: iso(T0 - 20 * 86400e3) },
  { id: 'ch-2', name: 'LINE shift group', type: 'line', team_id: null, enabled: true, has_secrets: true, config: {}, created_at: iso(T0 - 19 * 86400e3) },
];
const mockPolicies: Record<string, unknown>[] = [
  { id: 'pol-1', name: 'Night escalation', rule_id: null, enabled: true, created_at: iso(T0 - 15 * 86400e3),
    levels: [
      { after_minutes: 15, channel_ids: ['ch-1'], team_ids: [], oncall_team: 'team-ops' },
      { after_minutes: 45, channel_ids: ['ch-2'], team_ids: ['team-maint'], oncall_team: null },
    ] },
];

function roleOf(req: IncomingMessage): string | null {
  const m = /Bearer demo-(\w+)/.exec(req.headers.authorization ?? '');
  return m ? (m[1] === 'admin' || m[1] === 'owner' ? m[1] : m[1] === 'viewer' ? 'viewer' : 'operator') : null;
}

const list = (items: unknown[]) => ({ items, next_cursor: null });

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const c of req) raw += c;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

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
  if (p === '/api/health') return send(200, { status: 'ok', db: 'ok', mqtt: 'ok', edge: 'up' });

  const role = roleOf(req);
  if (!role) return send(401, { detail: 'mock: sign in with demo-operator or demo-viewer' });
  const t = now();

  if (p === '/api/me' || p === '/api/v1/me') {
    const perms = role === 'viewer' ? ['read'] : ['read', 'operate', 'config:write', 'member:manage', 'audit:read'];
    return send(200, {
      user: { sub: `demo-${role}`, display_name: `Demo ${role}` }, role, kind: 'dev',
      orgs: [{ org_id: 'org-demo', role }],
      memberships: [{ org_id: 'org-demo', org_name: 'Demo Plant', role, permissions: perms }],
    });
  }
  if (p === '/api/system/health') {
    return send(200, { mqtt: { connected: true }, edge: { last_heartbeat_ts: iso(t - 2000), clock_ok: true }, backend: { uptime_s: Math.round((t - T0) / 1000) + 86400 } });
  }
  if (p === '/api/tags') return send(200, TAGS);
  if (p === '/api/v1/consents') {
    return send(200, { required: {}, given: {}, missing: [], current: true });
  }
  if (p === '/api/tags/latest') return send(200, TAGS.map((g) => ({ name: g.name, v: value(g.name, t), q: 'good', ts: iso(t) })));

  const tagRoute = /^\/api\/tags\/(.+)\/(latest|history|availability)$/.exec(p);
  if (tagRoute) {
    const name = decodeURIComponent(tagRoute[1]);
    if (!TAGS.some((g) => g.name === name)) return send(404, { detail: 'unknown tag' });
    if (tagRoute[2] === 'latest') return send(200, { name, v: value(name, t), q: 'good', ts: iso(t) });
    const from = Date.parse(url.searchParams.get('from') ?? '') || t - 3600e3;
    const to = Date.parse(url.searchParams.get('to') ?? '') || t;
    if (tagRoute[2] === 'availability') {
      // per-tag uptime so the SLO page shows OK / warning / breached rows
      const UPTIME: Record<string, number> = { speed_mps: 0.9993, temp_c: 0.9962, level_pct: 0.981, gravel_ratio: 0.9991 };
      const uptime = UPTIME[name.split('.').pop() ?? ''] ?? 0.999;
      const span = (to - from) / 1000;
      return send(200, { name, from: iso(from), to: iso(to), samples: Math.round(span), good_frac: uptime, uptime, down_s: Math.round(span * (1 - uptime)) });
    }
    const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 720);
    const step = Math.max(1000, (to - from) / limit);
    const rows = [];
    for (let x = from; x <= to; x += step) rows.push({ v: value(name, x), q: 'good', ts: iso(x) });
    return send(200, rows);
  }

  if (p === '/api/alarms') return send(200, alarms);
  const ack = /^\/api\/alarms\/(\d+)\/ack$/.exec(p);
  if (ack && req.method === 'POST') {
    if (role === 'viewer') return send(403, { detail: 'operator role required' });
    const a = alarms.find((x) => String(x.id) === ack[1]);
    if (!a) return send(404, { detail: 'unknown alarm' });
    Object.assign(a, { state: 'acked', acked_by: `demo-${role}`, acked_at: iso(t), version: a.version + 1 });
    return send(200, a);
  }
  if (p === '/api/insights') {
    const state = url.searchParams.get('state');
    return send(200, insights.filter((i) => !state || i.state === state));
  }
  if (p === '/api/alarm-rules') return send(200, rules);

  if (p === '/api/commands') {
    if (role === 'viewer') return send(403, { detail: 'operator role required' });
    if (req.method === 'POST') {
      const b = await body(req);
      const id = `cmd-${commands.length + 1}`;
      commands.unshift({ id, tag: b.tag, value: b.value, status: 'done', created_at: iso(t), updated_at: iso(t), user: `demo-${role}`, events: [] });
      return send(200, { command_id: id });
    }
    return send(200, commands);
  }
  const cmd = /^\/api\/commands\/(.+)$/.exec(p);
  if (cmd) {
    const c = commands.find((x) => x.id === cmd[1]);
    return c ? send(200, c) : send(404, { detail: 'unknown command' });
  }

  // v2 org-scoped admin surface — enough for the admin pages to render
  const v2 = /^\/api\/v1\/orgs\/([^/]+)(\/.*)?$/.exec(p);
  if (v2) {
    const rest = v2[2] ?? '';
    if (rest === '') return send(200, { id: v2[1], name: 'Demo Plant', role, created_at: iso(T0 - 30 * 86400e3) });
    if (rest === '/sites') return send(200, list([{ id: 'site-1', name: 'Plant 1', code: 'plant1', timezone: 'Asia/Bangkok' }]));
    if (/\/sites\/[^/]+\/tags$/.test(rest)) return send(200, list(MOCK_TAGS));
    if (/\/sites\/[^/]+\/alarm-rules$/.test(rest)) return send(200, list(MOCK_RULES));
    if (/\/sites\/[^/]+\/alarms$/.test(rest)) return send(200, list(MOCK_V2_ALARMS));

    // --- WP-E: incidents (member read; operator+ writes) ---
    if (rest === '/incidents' && req.method === 'GET') {
      return send(200, { incidents: [...mockIncidents].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), teams: MOCK_TEAMS.map(({ id, name }) => ({ id, name })) });
    }
    if (rest === '/incidents' && req.method === 'POST') {
      if (role === 'viewer') return send(403, { detail: 'operator role required' });
      const b = await body(req);
      const team = MOCK_TEAMS.find((x) => x.id === b.owner_team_id);
      const inc = { id: UID(`e${mockIncidents.length + 1}`), title: String(b.title ?? ''), severity: b.severity ?? 'warning', status: 'active', created_at: iso(t), acked_at: null, resolved_at: null, alarm_id: null, team_id: team?.id ?? null, team: team?.name ?? null, mine: true };
      mockIncidents.push(inc);
      mockIncEvents[String(inc.id)] = [{ kind: 'created', body: '', at: inc.created_at, who: `demo-${role}` }];
      return send(201, { incident: inc });
    }
    const incDetail = /^\/incidents\/([^/]+)(\/status|\/notes)?$/.exec(rest);
    if (incDetail) {
      const inc = mockIncidents.find((x) => x.id === incDetail[1]);
      if (!inc) return send(404, { detail: 'incident not found' });
      const events = (mockIncEvents[String(inc.id)] ??= []);
      const who = `demo-${role}`;
      if (!incDetail[2] && req.method === 'GET') return send(200, { incident: inc, events });
      if (role === 'viewer') return send(403, { detail: 'operator role required' });
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
    if (rest === '/teams' && req.method === 'GET') return send(200, { teams: MOCK_TEAMS });

    // --- WP-E: notification channels / escalation / on-call ---
    if (rest === '/notification-channels' && req.method === 'GET') return send(200, list(mockChannels));
    const chMut = /^\/notification-channels\/([^/]+)$/.exec(rest);
    if (chMut && req.method === 'PATCH') {
      const c = mockChannels.find((x) => x.id === chMut[1]);
      if (!c) return send(404, { detail: 'channel not found' });
      Object.assign(c, await body(req));
      return send(200, { channel: c });
    }
    if (rest === '/escalation-policies' && req.method === 'GET') return send(200, list(mockPolicies));
    if (rest === '/escalation-policies' && req.method === 'POST') {
      const b = await body(req);
      const pol = { id: `pol-${mockPolicies.length + 1}`, name: b.name, rule_id: b.rule_id ?? null, enabled: true, created_at: iso(t), levels: b.levels ?? [] };
      mockPolicies.push(pol);
      return send(201, { policy: pol });
    }
    const polMut = /^\/escalation-policies\/([^/]+)$/.exec(rest);
    if (polMut) {
      const pol = mockPolicies.find((x) => x.id === polMut[1]);
      if (!pol) return send(404, { detail: 'policy not found' });
      if (req.method === 'PATCH') { Object.assign(pol, await body(req)); return send(200, { policy: pol }); }
      if (req.method === 'DELETE') { mockPolicies.splice(mockPolicies.indexOf(pol), 1); return send(204, {}); }
    }
    if (rest === '/oncall') {
      return send(200, list([{ team_id: 'team-ops', team: 'Ops', user_id: 'u1', name: 'Demo operator', source: 'rotation', rotation: ['u1'] }]));
    }
    if (/\/teams\/[^/]+\/oncall\/overrides$/.test(rest)) return send(200, list([]));
    if (/\/sites\/[^/]+\/health$/.test(rest)) return send(200, { edges: [], buffer_depth: 0, clock_ok: true, adapter: 'mock' });
    if (rest === '/members') {
      return send(200, list([{ user_id: 'u1', sub: 'demo-operator', display_name: 'Demo operator', email: 'operator@demo.local', role: 'operator', disabled_at: null, created_at: iso(T0) }]));
    }
    if (rest === '/api-keys') {
      const d = 86400e3;
      return send(200, list([
        { id: 'k1', name: 'grafana-readonly', prefix: 'wds_a1b2', role: 'viewer', created_at: iso(T0 - 20 * d), expires_at: iso(T0 + 60 * d), last_used_at: iso(T0 - 3600e3), revoked_at: null },
        { id: 'k2', name: 'erp-sync', prefix: 'wds_c3d4', role: 'operator', created_at: iso(T0 - 200 * d), expires_at: null, last_used_at: iso(T0 - 150 * d), revoked_at: null },
        { id: 'k3', name: 'ci-deploy', prefix: 'wds_e5f6', role: 'admin', created_at: iso(T0 - 300 * d), expires_at: null, last_used_at: iso(T0 - 2 * d), revoked_at: null },
        { id: 'k4', name: 'old-dashboard', prefix: 'wds_0z9y', role: 'viewer', created_at: iso(T0 - 400 * d), expires_at: iso(T0 - 30 * d), last_used_at: null, revoked_at: iso(T0 - 30 * d) },
      ]));
    }
    if (/\/sites\/[^/]+\/edges$/.test(rest)) {
      return send(200, list([
        { id: 'e1', org_id: v2[1], site_id: 'site-1', name: 'edge-sorter-01', status: 'active', mqtt_username: 'edge-1', credential_version: 3, last_hb_at: iso(T0 - 2e3), clock_ok: true, adapter: 'opcua', needs_rotation: false },
        { id: 'e2', org_id: v2[1], site_id: 'site-1', name: 'edge-conveyor-02', status: 'active', mqtt_username: 'edge-2', credential_version: 1, last_hb_at: iso(T0 - 4e3), clock_ok: false, adapter: 'modbus', needs_rotation: true },
        { id: 'e3', org_id: v2[1], site_id: 'site-1', name: 'edge-vision-03', status: 'active', mqtt_username: 'edge-3', credential_version: 2, last_hb_at: iso(T0 - 900e3), clock_ok: true, adapter: 'mqtt', needs_rotation: true },
      ]));
    }
    if (rest.startsWith('/audit')) {
      const acts = ['auth.login', 'auth.login', 'auth.login', 'member.updated', 'alarm_rule.created', 'alarm_rule.updated', 'edge.rotated', 'downtime.created', 'tag.updated'];
      return send(200, list(Array.from({ length: 60 }, (_, i) => ({
        seq: 60 - i, at: iso(T0 - i * 3 * 3600e3), actor: i % 4 === 0 ? 'user:admin' : 'user:operator', action: acts[i % acts.length], target: {}, detail: {}, hash: `h${i}`,
      }))));
    }
    return send(200, list([]));
  }

  return send(404, { detail: `mock: ${req.method} ${p} not implemented` });
}

export function mockApi(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        handle(req, res).catch((e) => { res.statusCode = 500; res.end(String(e)); });
      });
    },
  };
}
