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
