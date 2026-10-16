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

// ---- v2 fixtures (WP-A: monitor templates, settings sections) — the v1
// `rules`/`alarms` lists stay the v1 mirror; these carry ids for the
// org-scoped contract. Mutable so POST/PATCH persist for the session.
const v2tags = [
  { id: 'tag-temp', path: 'plant1.sort.line1.conv1.temp_c', name: 'temp_c', type: 'float', unit: '°C' },
  { id: 'tag-speed', path: 'plant1.sort.line1.conv1.speed_mps', name: 'speed_mps', type: 'float', unit: 'm/s' },
  { id: 'tag-level', path: 'plant1.sort.line1.bin1.level_pct', name: 'level_pct', type: 'float', unit: '%' },
  { id: 'tag-ratio', path: 'plant1.sort.vision.cam1.gravel_ratio', name: 'gravel_ratio', type: 'float', unit: '%' },
  { id: 'tag-run', path: 'plant1.sort.line1.motor1.running', name: 'running', type: 'bool' },
  { id: 'tag-sp', path: 'plant1.sort.line1.motor1.speed_sp', name: 'speed_sp', type: 'float', unit: 'Hz' },
];
const tagPath = (id: string) => v2tags.find((x) => x.id === id)?.path ?? '';
const pathTag = (path: string) => v2tags.find((x) => x.path === path)?.id ?? '';
const v2rules: Record<string, unknown>[] = [
  { id: 'r-1', tag_id: 'tag-temp', name: 'conveyor temp HiHi', kind: 'hihi', threshold: 75, stale_s: null, window_s: null, deadband: 1, severity: 'critical', enabled: true },
  { id: 'r-2', tag_id: 'tag-level', name: 'bin level Hi', kind: 'hi', threshold: 90, stale_s: null, window_s: null, deadband: 2, severity: 'warning', enabled: true },
  { id: 'r-3', tag_id: 'tag-ratio', name: 'vision stale', kind: 'stale', threshold: null, stale_s: 30, window_s: null, deadband: 0, severity: 'info', enabled: true },
  { id: 'r-4', tag_id: 'tag-sp', name: 'motor setpoint drift', kind: 'roc', threshold: 5, stale_s: null, window_s: 600, deadband: 0.5, severity: 'info', enabled: false },
];
const v2channels: Record<string, unknown>[] = [
  { id: 'c-1', name: 'Ops email', type: 'email', team_id: null, enabled: true, has_secrets: false, config: { to: 'ops@demo.local' }, created_at: iso(T0 - 90 * 86400e3) },
  { id: 'c-2', name: 'LINE night shift', type: 'line', team_id: null, enabled: true, has_secrets: true, config: {}, created_at: iso(T0 - 40 * 86400e3) },
  { id: 'c-3', name: 'SCADA webhook', type: 'webhook', team_id: null, enabled: false, has_secrets: true, config: { url: 'https://hooks.demo.local/alarm' }, created_at: iso(T0 - 12 * 86400e3) },
];
const v2policies: Record<string, unknown>[] = [
  { id: 'p-1', name: 'Shift escalation', rule_id: null, enabled: true, created_at: iso(T0 - 60 * 86400e3), levels: [
    { after_minutes: 15, channel_ids: ['c-1'], team_ids: [], oncall_team: null },
    { after_minutes: 45, channel_ids: ['c-1', 'c-2'], team_ids: [], oncall_team: 'team-night' },
  ] },
  { id: 'p-2', name: 'Critical fast path', rule_id: 'r-1', enabled: false, created_at: iso(T0 - 20 * 86400e3), levels: [
    { after_minutes: 5, channel_ids: ['c-3'], team_ids: [], oncall_team: null },
  ] },
];
const v2downtimes: Record<string, unknown>[] = [
  { id: 'd-1', rule_id: 'r-3', rule: 'vision stale', description: 'Camera lens cleaning', starts_at: iso(T0 - 3600e3), ends_at: iso(T0 + 3 * 3600e3), recurring: false, mine: true },
  { id: 'd-2', rule_id: null, rule: null, description: 'Weekly preventive maintenance', starts_at: iso(T0 + 2 * 86400e3), ends_at: iso(T0 + 2 * 86400e3 + 4 * 3600e3), recurring: true, mine: false },
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
    if (rest.startsWith('/audit')) {
      const acts = ['auth.login', 'auth.login', 'auth.login', 'member.updated', 'alarm_rule.created', 'alarm_rule.updated', 'edge.rotated', 'downtime.created', 'tag.updated'];
      return send(200, list(Array.from({ length: 60 }, (_, i) => ({
        seq: 60 - i, at: iso(T0 - i * 3 * 3600e3), actor: i % 4 === 0 ? 'user:admin' : 'user:operator', action: acts[i % acts.length], target: {}, detail: {}, hash: `h${i}`,
      }))));
    }
    // config surfaces — writes are admin|owner only (mirrors the backend's
    // config:write gate; the mock grants operators no config role)
    const siteTags = /^\/sites\/[^/]+\/tags$/.exec(rest);
    if (siteTags) return send(200, list(v2tags));
    const siteRules = /^\/sites\/[^/]+\/alarm-rules(\/[^/]+)?$/.exec(rest);
    if (siteRules) {
      const config = role === 'admin' || role === 'owner';
      if (req.method !== 'GET' && !config) return send(403, { detail: 'admin role required' });
      const id = siteRules[1]?.slice(1);
      if (id) {
        const r = v2rules.find((x) => x.id === id);
        if (!r) return send(404, { detail: 'unknown rule' });
        if (req.method === 'PATCH') {
          Object.assign(r, await body(req));
          const v1 = rules.find((x) => x.name === r.name);
          if (v1) Object.assign(v1, { enabled: r.enabled });
          return send(200, { rule: r });
        }
        if (req.method === 'DELETE') {
          v2rules.splice(v2rules.indexOf(r), 1);
          const i = rules.findIndex((x) => x.name === r.name);
          if (i >= 0) rules.splice(i, 1);
          return send(200, { deleted: id });
        }
        return send(200, { rule: r });
      }
      if (req.method === 'POST') {
        const b = await body(req);
        if (v2rules.some((x) => x.tag_id === b.tag_id && x.name === b.name)) {
          return send(409, { detail: 'a rule with this name already exists on that tag' });
        }
        const r = {
          id: `r-${v2rules.length + 1}-${Math.floor(t % 1000)}`,
          tag_id: String(b.tag_id ?? ''), name: String(b.name ?? 'rule'),
          kind: String(b.kind ?? 'hi'), threshold: b.threshold ?? null,
          stale_s: b.stale_s ?? null, window_s: b.window_s ?? null,
          deadband: Number(b.deadband ?? 0), severity: String(b.severity ?? 'info'),
          enabled: b.enabled !== false,
        };
        v2rules.push(r);
        rules.push({ tag: tagPath(r.tag_id), name: r.name, kind: r.kind as never, threshold: r.threshold as never, stale_s: r.stale_s as never, deadband: r.deadband, severity: r.severity as never, enabled: r.enabled });
        return send(200, { rule: r });
      }
      return send(200, list(v2rules));
    }
    const siteAlarms = /^\/sites\/[^/]+\/alarms$/.exec(rest);
    if (siteAlarms) {
      return send(200, list(alarms.map((a) => ({
        id: String(a.id), tag_id: pathTag(a.tag), rule_id: v2rules.find((r) => r.name === a.rule.split(' >')[0].split(' <')[0])?.id ?? 'r-1',
        rule: a.rule, severity: a.severity, state: a.state, raised_at: a.ts,
        acked_at: a.acked_at, acked_by: a.acked_by, cleared_at: a.cleared_at,
        version: a.version, shelved_until: null, assigned_to: null, assigned_name: null,
      }))));
    }
    const ch = /^\/notification-channels(\/[^/]+)?$/.exec(rest);
    if (ch) {
      const config = role === 'admin' || role === 'owner';
      if (req.method !== 'GET' && !config) return send(403, { detail: 'admin role required' });
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
    const pol = /^\/escalation-policies(\/[^/]+)?$/.exec(rest);
    if (pol) {
      const config = role === 'admin' || role === 'owner';
      if (req.method !== 'GET' && !config) return send(403, { detail: 'admin role required' });
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
        if (role === 'viewer') return send(403, { detail: 'operator role required' });
        const b = await body(req);
        const d = { id: `d-${v2downtimes.length + 1}`, rule_id: b.rule_id ?? null, rule: v2rules.find((r) => r.id === b.rule_id)?.name ?? null, description: String(b.description ?? ''), starts_at: String(b.starts_at), ends_at: String(b.ends_at), recurring: !!b.recurring, mine: true };
        v2downtimes.push(d);
        return send(200, { downtime: d });
      }
      return send(200, { downtimes: v2downtimes, rules: v2rules.map((r) => ({ id: r.id, name: r.name })) });
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
