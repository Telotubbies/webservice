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

/* ---- WP-D surfaces: dashboards, report schedules, reports, incidents ----
 * In-memory, contract-shaped rows so the parity pages render without the
 * backend stack. */

// widget body shape mirrors web/src/features/dashboards/model.ts Widget
const demoWidgets = {
  timeseries: { id: 'w-ts', kind: 'timeseries', title: 'Belt temperature (°C)', x: 0, y: 0, w: 8, h: 3, tags: ['plant1.sort.line1.conv1.temp_c'], agg: 'last', groupBy: 'tag', range: 'inherit', unit: '', decimals: 1, colors: [], lineWidth: 2, yMin: null, yMax: null, legend: true, warn: 70, crit: 75, note: '', tone: 'blue' },
  alarms: { id: 'w-al', kind: 'alarms', title: 'Active alarms', x: 8, y: 0, w: 4, h: 3, tags: [], agg: 'last', groupBy: 'tag', range: 'inherit', unit: '', decimals: 1, colors: [], lineWidth: 2, yMin: null, yMax: null, legend: true, warn: null, crit: null, note: '', tone: 'blue' },
};

const dashboards: Record<string, unknown>[] = [
  {
    id: '11111111-2222-4333-8444-555555555551', title: 'Shift handover', description: 'Board shared across shifts by the day team.',
    shared: true, mine: false, body: { range: '1h', widgets: [demoWidgets.timeseries, demoWidgets.alarms] },
    updated_at: iso(T0 - 2 * 86400e3),
  },
  {
    id: '11111111-2222-4333-8444-555555555552', title: 'My commissioning checks', description: '',
    shared: false, mine: true, body: { range: '15m', widgets: [demoWidgets.timeseries] },
    updated_at: iso(T0 - 86400e3),
  },
];

const schedules: Record<string, unknown>[] = [
  { id: 'rs-1', site_id: 'site-1', template: 'daily', to_addrs: ['ops@demo.plant'], send_time: '07:00', send_day: null, enabled: true, last_run_at: iso(T0 - 9 * 3600e3), created_at: iso(T0 - 30 * 86400e3) },
  { id: 'rs-2', site_id: 'site-1', template: 'weekly_oee', to_addrs: ['ops@demo.plant', 'owner@demo.plant'], send_time: '06:30', send_day: 1, enabled: true, last_run_at: iso(T0 - 5 * 86400e3), created_at: iso(T0 - 60 * 86400e3) },
  { id: 'rs-3', site_id: null, template: 'monthly_alarms', to_addrs: ['owner@demo.plant'], send_time: '08:00', send_day: 1, enabled: false, last_run_at: null, created_at: iso(T0 - 45 * 86400e3) },
];

const teams = [
  { id: 'team-ops', org_id: 'org-demo', name: 'Operations', user_ids: ['u1'], created_at: iso(T0 - 90 * 86400e3) },
];

const incidents: Record<string, unknown>[] = [
  { id: 'inc-1', title: 'Bin overfill tripped the conveyor', severity: 'critical', status: 'acknowledged', created_at: iso(T0 - 26 * 60e3), acked_at: iso(T0 - 20 * 60e3), resolved_at: null, alarm_id: '102', team_id: 'team-ops', team: 'Operations', mine: true },
  { id: 'inc-2', title: 'Vision camera feed stalled', severity: 'warning', status: 'active', created_at: iso(T0 - 3 * 3600e3), acked_at: null, resolved_at: null, alarm_id: '104', team_id: null, team: null, mine: false },
  { id: 'inc-3', title: 'Belt slip during morning shift', severity: 'warning', status: 'resolved', created_at: iso(T0 - 3 * 86400e3), acked_at: iso(T0 - 3 * 86400e3 + 9 * 60e3), resolved_at: iso(T0 - 3 * 86400e3 + 47 * 60e3), alarm_id: '103', team_id: 'team-ops', team: 'Operations', mine: false },
  { id: 'inc-4', title: 'Weekend gravel screen clog', severity: 'info', status: 'resolved', created_at: iso(T0 - 9 * 86400e3), acked_at: iso(T0 - 9 * 86400e3 + 30 * 60e3), resolved_at: iso(T0 - 9 * 86400e3 + 6 * 3600e3), alarm_id: null, team_id: null, team: null, mine: false },
];
const incidentEvents: Record<string, Record<string, unknown>[]> = {
  'inc-1': [
    { kind: 'created', body: 'declared the incident', at: iso(T0 - 26 * 60e3), who: 'demo-operator' },
    { kind: 'status', body: 'acknowledged', at: iso(T0 - 20 * 60e3), who: 'demo-operator' },
  ],
};

const slos = [
  { id: 'slo-1', name: 'Sorting line availability', description: 'Belt signal uptime', tag: 'plant1.sort.line1.conv1.speed_mps', tag_id: 't-speed', target: 0.999, warning: 0.9995, updated_at: iso(T0 - 10 * 86400e3), corrections: [] },
];
// status SLI uses the same uptime fixture as /availability so pages agree
const SLOS_SLI: Record<string, number> = { 'slo-1': 0.9993 };

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
  if (p === '/api/v1/consents') return send(200, { given: {}, missing: [], current: true });
  if (p === '/api/tags') return send(200, TAGS);
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
    if (rest === '/sites') return send(200, list([{ id: 'site-1', name: 'Plant 1', code: 'P1', timezone: 'Asia/Bangkok' }]));
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
    // dashboards — custom board bodies synced by useDashboards
    const dash = /^\/dashboards(?:\/([^/]+))?$/.exec(rest);
    if (dash) {
      const id = dash[1];
      if (req.method === 'GET' && !id) return send(200, { dashboards });
      if (req.method === 'POST' && !id) {
        if (role === 'viewer') return send(403, { detail: 'viewer role cannot write dashboards' });
        const b = await body(req);
        const row = { ...b, updated_at: iso(t), mine: true };
        dashboards.push(row);
        return send(200, row);
      }
      const d = dashboards.find((x) => x.id === id);
      if (!d) return send(404, { detail: 'unknown dashboard' });
      if (req.method === 'PUT') {
        if (role === 'viewer') return send(403, { detail: 'viewer role cannot write dashboards' });
        Object.assign(d, await body(req), { updated_at: iso(t) });
        return send(200, d);
      }
      if (req.method === 'DELETE') {
        if (role === 'viewer') return send(403, { detail: 'viewer role cannot write dashboards' });
        dashboards.splice(dashboards.indexOf(d), 1);
        return send(200, {});
      }
    }

    // report schedules — writes need admin|owner like the backend
    const sched = /^\/report-schedules(?:\/([^/]+))?$/.exec(rest);
    if (sched) {
      const id = sched[1];
      if (req.method === 'GET' && !id) return send(200, list(schedules));
      if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'admin role required' });
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
    if (rep && req.method === 'GET') {
      const fmt = url.searchParams.get('format') ?? 'csv';
      const name = rep[1];
      const csv = `metric,value\nuptime_pct,99.9\nopen_alarms,${alarms.filter((a) => a.state !== 'cleared').length}\n`;
      if (fmt === 'html') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`);
        res.end(`<!doctype html><title>${name} report</title><h1>${name} report</h1><p>Demo Plant — generated ${iso(t)}</p><pre>${csv}</pre>`);
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      res.end(csv);
      return;
    }

    // SLOs — list + status so the dashboard SloBody renders
    if (rest === '/slos') {
      if (req.method === 'POST' && role !== 'viewer') { const b = await body(req); slos.push({ id: `slo-${slos.length + 1}`, updated_at: iso(t), corrections: [], ...b } as never); return send(200, { slo: slos[slos.length - 1] }); }
      return send(200, list(slos));
    }
    const sloStatus = /^\/slos\/status$/.exec(rest);
    if (sloStatus) {
      return send(200, { days: Number(url.searchParams.get('days')) || 30, items: slos.map((s) => ({ id: s.id, samples: 86400, excluded: 0, sli: SLOS_SLI[s.id] ?? null, covered_s: 86400 })) });
    }
    const sloRow = /^\/slos\/([^/]+)$/.exec(rest);
    if (sloRow) {
      const s = slos.find((x) => x.id === sloRow[1]);
      if (!s) return send(404, { detail: 'unknown slo' });
      if (req.method === 'PATCH') { Object.assign(s, await body(req)); return send(200, { slo: s }); }
      if (req.method === 'DELETE') { slos.splice(slos.indexOf(s), 1); return send(200, {}); }
    }

    // teams + incidents — read for all; writes need operator+
    if (rest === '/teams') return send(200, list(teams));
    const inc = /^\/incidents(?:\/([^/]+)(\/status|\/notes)?)?$/.exec(rest);
    if (inc) {
      const id = inc[1]; const sub = inc[2];
      if (req.method === 'GET' && !id) return send(200, { incidents, teams });
      if (req.method === 'POST' && !id) {
        if (role === 'viewer') return send(403, { detail: 'operator role required' });
        const b = await body(req);
        const team = teams.find((x) => x.id === b.owner_team_id);
        const row = { id: `inc-${incidents.length + 1}`, title: b.title, severity: b.severity, status: 'active', created_at: iso(t), acked_at: null, resolved_at: null, alarm_id: null, team_id: b.owner_team_id ?? null, team: team?.name ?? null, mine: true };
        incidents.unshift(row);
        return send(200, { incident: row });
      }
      const i = incidents.find((x) => x.id === id);
      if (!i) return send(404, { detail: 'unknown incident' });
      if (req.method === 'GET' && !sub) return send(200, { incident: i, events: incidentEvents[i.id as string] ?? [] });
      if (role === 'viewer') return send(403, { detail: 'operator role required' });
      const b = await body(req);
      if (req.method === 'POST' && sub === '/status') {
        Object.assign(i, { status: b.status, ...(b.status === 'acknowledged' ? { acked_at: iso(t) } : {}), ...(b.status === 'resolved' ? { resolved_at: iso(t) } : {}) });
        (incidentEvents[i.id as string] ??= []).push({ kind: 'status', body: b.status, at: iso(t), who: `demo-${role}` });
        return send(200, { incident: i });
      }
      if (req.method === 'POST' && sub === '/notes') {
        (incidentEvents[i.id as string] ??= []).push({ kind: 'note', body: b.body, at: iso(t), who: `demo-${role}` });
        return send(200, {});
      }
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
