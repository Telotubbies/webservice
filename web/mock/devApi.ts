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

/* ----- SLOs (WP-C): contract-shaped fixtures for the /slos surface. ------ */
// Quality fractions mirror the availability map below so the SLI shown by
// the list matches what the burndown rebuilds from history.
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
  { id: 'slo-belt', name: 'Conveyor belt availability', description: 'Sorter line belt uptime', tag: 'plant1.sort.line1.conv1.speed_mps', tag_id: 't1', target: 99.9, warning: 99.95, updated_at: iso(T0 - 3 * 86400e3), corrections: [] },
  { id: 'slo-temp', name: 'Belt temperature telemetry', description: '', tag: 'plant1.sort.line1.conv1.temp_c', tag_id: 't2', target: 99.5, warning: 99.7, updated_at: iso(T0 - 2 * 86400e3), corrections: [] },
  { id: 'slo-bin', name: 'Bin level sensor uptime', description: 'Downtime during planned calibration is excluded', tag: 'plant1.sort.line1.bin1.level_pct', tag_id: 't3', target: 99.0, warning: 99.5, updated_at: iso(T0 - 86400e3),
    corrections: [{ id: 'cor-1', starts_at: iso(T0 - 4 * 3600e3), ends_at: iso(T0 - 3 * 3600e3), reason: 'load-cell calibration' }] },
  { id: 'slo-vision', name: 'Vision camera frames', description: '', tag: 'plant1.sort.vision.cam1.gravel_ratio', tag_id: 't4', target: 99.5, warning: 99.8, updated_at: iso(T0 - 6 * 3600e3), corrections: [] },
];

const auditSeed = [
  { seq: 101, at: iso(T0 - 26 * 86400e3), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-belt' }, detail: { name: 'Conveyor belt availability', target: 99.9 }, hash: 'a1' },
  { seq: 102, at: iso(T0 - 26 * 86400e3), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-temp' }, detail: { name: 'Belt temperature telemetry', target: 99.5 }, hash: 'a2' },
  { seq: 103, at: iso(T0 - 25 * 86400e3), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-bin' }, detail: { name: 'Bin level sensor uptime', target: 99.0 }, hash: 'a3' },
  { seq: 104, at: iso(T0 - 25 * 86400e3), actor: 'user:admin', action: 'slo.created', target: { slo_id: 'slo-vision' }, detail: { name: 'Vision camera frames', target: 99.5 }, hash: 'a4' },
  { seq: 105, at: iso(T0 - 9 * 86400e3), actor: 'user:admin', action: 'slo.updated', target: { slo_id: 'slo-temp' }, detail: { target: '99.0 → 99.5' }, hash: 'a5' },
  { seq: 106, at: iso(T0 - 5 * 86400e3), actor: 'user:admin', action: 'slo.deleted', target: { slo_id: 'slo-legacy-pump' }, detail: { name: 'Legacy pump uptime' }, hash: 'a6' },
  { seq: 107, at: iso(T0 - 2 * 3600e3), actor: 'user:admin', action: 'slo.correction_added', target: { slo_id: 'slo-bin' }, detail: { reason: 'load-cell calibration' }, hash: 'a7' },
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
      const uptime = uptimeOf(name);
      const span = (to - from) / 1000;
      return send(200, { name, from: iso(from), to: iso(to), samples: Math.round(span), good_frac: uptime, uptime, down_s: Math.round(span * (1 - uptime)) });
    }
    const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 720);
    const step = Math.max(1000, (to - from) / limit);
    const rows = [];
    for (let x = from; x <= to; x += step) rows.push({ v: value(name, x), q: qAt(name, x), ts: iso(x) });
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
    if (rest === '/slos' || rest.startsWith('/slos/')) {
      const m = /^\/slos(\/([^/]+))?(\/corrections(\/([^/]+))?)?$/.exec(rest);
      const id = m?.[2];
      const cid = m?.[5];
      if (rest === '/slos/status' || rest.startsWith('/slos/status')) {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
        const covered = days * 86400;
        return send(200, { days, items: slos.map((s) => {
          const excluded = s.corrections.reduce((n, c) => n + Math.max(0, (Date.parse(c.ends_at) - Date.parse(c.starts_at)) / 1000), 0);
          const up = uptimeOf(s.tag ?? '');
          return { id: s.id, samples: covered - Math.round(excluded), excluded: Math.round(excluded), sli: +(up * 100).toFixed(3), covered_s: covered };
        }) });
      }
      if (!id && req.method === 'GET') return send(200, list(slos));
      if (!id && req.method === 'POST') {
        if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'config:write required' });
        const b = await body(req);
        const s: MockSlo = {
          id: `slo-${slos.length + 1}`, name: String(b.name ?? ''), description: String(b.description ?? ''),
          tag: (b.tag as string) ?? null, tag_id: 't1',
          target: Number(b.target ?? 99), warning: Number(b.warning ?? (Number(b.target ?? 99) + (100 - Number(b.target ?? 99)) / 2)),
          updated_at: iso(t), corrections: [],
        };
        if (slos.some((x) => x.name === s.name)) return send(409, { detail: 'name exists' });
        slos.push(s);
        return send(201, { slo: s });
      }
      const s = slos.find((x) => x.id === id);
      if (!s) return send(404, { detail: 'unknown slo' });
      if (cid) { // DELETE correction
        if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'config:write required' });
        s.corrections = s.corrections.filter((c) => c.id !== cid);
        res.statusCode = 204; res.end(); return;
      }
      if (m?.[3] && req.method === 'POST') { // add correction
        if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'config:write required' });
        const b = await body(req);
        const c = { id: `cor-${s.corrections.length + 1}`, starts_at: String(b.starts_at), ends_at: String(b.ends_at), reason: String(b.reason ?? '') };
        s.corrections.push(c); s.updated_at = iso(t);
        return send(201, { correction: c });
      }
      if (req.method === 'PATCH') {
        if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'config:write required' });
        const b = await body(req);
        Object.assign(s, { name: b.name ?? s.name, description: b.description ?? s.description, tag: b.tag ?? s.tag, target: b.target ?? s.target, warning: b.warning ?? s.warning, updated_at: iso(t) });
        return send(200, { slo: s });
      }
      if (req.method === 'DELETE') {
        if (role !== 'admin' && role !== 'owner') return send(403, { detail: 'config:write required' });
        slos.splice(slos.indexOf(s), 1);
        res.statusCode = 204; res.end(); return;
      }
      return send(200, s);
    }
    if (rest.startsWith('/audit')) {
      const action = url.searchParams.get('action');
      const acts = ['auth.login', 'auth.login', 'auth.login', 'member.updated', 'alarm_rule.created', 'alarm_rule.updated', 'edge.rotated', 'downtime.created', 'tag.updated'];
      const noise = Array.from({ length: 60 }, (_, i) => ({
        seq: 200 + i, at: iso(T0 - i * 3 * 3600e3), actor: i % 4 === 0 ? 'user:admin' : 'user:operator', action: acts[i % acts.length], target: {}, detail: {}, hash: `h${i}`,
      }));
      const all = [...auditSeed, ...noise];
      const filtered = action ? all.filter((a) => a.action === action) : all;
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 50);
      return send(200, list(filtered.slice(0, limit)));
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
