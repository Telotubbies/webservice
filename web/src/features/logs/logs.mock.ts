// shortcut: demo log stream, replace with a log-query endpoint when the
// backend ships one. Deterministic (seeded LCG) so renders never flicker.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogService = 'edge-bridge' | 'backend' | 'broker';

export interface LogRow {
  id: string;
  ts: number;          // epoch ms
  level: LogLevel;
  service: LogService;
  edge: string;
  host: string;
  message: string;
  attrs: Record<string, unknown>;
}

export const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
export const EDGES = ['edge-gw-01', 'edge-gw-02', 'edge-gw-03'];

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 8) % 100000) / 100000;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

type Tpl = { service: LogService; level: LogLevel; w: number; msg: (r: () => number) => [string, Record<string, unknown>] };

const REG = [40001, 40002, 40012, 40020, 40031];
const TAGS = ['line1.conv1.speed_mps', 'line1.conv1.temp_c', 'line1.bin1.level_pct', 'line1.motor1.running', 'vision.cam1.gravel_ratio'];

const TPLS: Tpl[] = [
  { service: 'edge-bridge', level: 'info', w: 10, msg: (r) => { const n = 20 + Math.floor(r() * 40); return [`modbus poll ok: ${n} registers in ${(8 + r() * 30).toFixed(1)} ms`, { 'modbus.unit_id': 1, 'modbus.registers': n, 'poll.interval_ms': 500 }]; } },
  { service: 'edge-bridge', level: 'debug', w: 6, msg: (r) => { const tag = pick(r, TAGS); return [`publish plant1/sort/${tag.replace(/\./g, '/')} qos=1`, { 'mqtt.topic': `plant1/sort/${tag}`, 'mqtt.qos': 1, bytes: 60 + Math.floor(r() * 80) }]; } },
  { service: 'edge-bridge', level: 'warn', w: 2, msg: (r) => { const reg = pick(r, REG); return [`modbus read retry ${1 + Math.floor(r() * 3)}/3 on holding register ${reg}`, { 'modbus.register': reg, 'modbus.retry': true, 'net.peer': '192.168.10.20:502' }]; } },
  { service: 'edge-bridge', level: 'error', w: 1, msg: (r) => { const reg = pick(r, REG); return [`TimeoutError: read of holding register ${reg} timed out after 2000 ms`, { 'error.kind': 'TimeoutError', 'modbus.register': reg, 'timeout_ms': 2000 }]; } },
  { service: 'edge-bridge', level: 'warn', w: 1, msg: (r) => { const d = Math.floor(r() * 400); return [`store-and-forward buffer depth ${d} (broker slow)`, { 'buffer.depth': d, 'buffer.max': 10000 }]; } },
  { service: 'edge-bridge', level: 'info', w: 2, msg: () => ['heartbeat sent; clock offset 12 ms', { 'clock.offset_ms': 12, 'clock.ok': true }] },
  { service: 'broker', level: 'info', w: 4, msg: (r) => { const c = pick(r, EDGES); return [`client ${c} connected (tls1.3, keepalive 30s)`, { 'mqtt.client_id': c, tls: 'TLSv1.3', keepalive_s: 30 }]; } },
  { service: 'broker', level: 'warn', w: 1, msg: (r) => { const c = pick(r, EDGES); return [`client ${c} keepalive timeout; closing`, { 'mqtt.client_id': c, reason: 'keepalive' }]; } },
  { service: 'broker', level: 'error', w: 1, msg: () => ['connection refused: not authorised (bad credential version)', { 'mqtt.rc': 5, 'error.kind': 'NotAuthorized' }] },
  { service: 'backend', level: 'info', w: 6, msg: (r) => { const n = 50 + Math.floor(r() * 200); return [`ingest batch committed: ${n} samples`, { 'ingest.samples': n, 'db.duration_ms': +(2 + r() * 10).toFixed(1) }]; } },
  { service: 'backend', level: 'info', w: 3, msg: (r) => { const p = pick(r, ['/api/tags/latest', '/api/alarms', '/api/system/health', '/api/commands']); const ms = Math.floor(4 + r() * 60); return [`GET ${p} 200 ${ms}ms`, { 'http.method': 'GET', 'http.route': p, 'http.status_code': 200, duration_ms: ms }]; } },
  { service: 'backend', level: 'warn', w: 1, msg: (r) => { const tag = pick(r, TAGS); return [`alarm raised: ${tag} above Hi limit`, { 'alarm.tag': `plant1.sort.${tag}`, 'alarm.severity': 'warning' }]; } },
  { service: 'backend', level: 'error', w: 1, msg: () => ["KeyError: 'belt_speed' missing from telemetry frame", { 'error.kind': 'KeyError', 'error.stack': 'backend/app/ingest.py:132 in normalise' }] },
  { service: 'backend', level: 'debug', w: 2, msg: (r) => [`ws broadcast to ${1 + Math.floor(r() * 6)} clients`, { 'ws.clients': 3 }] },
];
const TOTAL_W = TPLS.reduce((a, b) => a + b.w, 0);

/** One deterministic log row for index i, stamped at ts. */
export function makeLog(i: number, ts: number): LogRow {
  const r = rng(i * 7919 + 17);
  let x = r() * TOTAL_W;
  let tpl = TPLS[0];
  for (const tp of TPLS) { if ((x -= tp.w) <= 0) { tpl = tp; break; } }
  const edge = pick(r, EDGES);
  const [message, extra] = tpl.msg(r);
  const host = tpl.service === 'edge-bridge' ? edge : tpl.service === 'broker' ? 'mqtt-01' : 'api-01';
  return {
    id: `log-${i}`, ts, level: tpl.level, service: tpl.service, edge, host, message,
    attrs: { service: tpl.service, host, edge, status: tpl.level, site: 'plant1', ...extra },
  };
}

/** `count` rows spread over the last hour before `now`, newest first. */
export function seedLogs(now: number, count = 480): LogRow[] {
  const out: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng(i * 31 + 5);
    out.push(makeLog(i, now - (i / count) * 3600e3 - Math.floor(r() * 4000)));
  }
  return out;
}
