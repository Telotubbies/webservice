// The demo site as the API serves it, derived from the simulator so every
// tag has exactly one home: ISA-95 areas → lines → equipment, three edge
// gateways, and one data source per protocol (Modbus TCP, Siemens S7, OPC UA,
// simulator) with protocol-correct addresses. Everything time-based (OEE,
// downtime, vision decisions, edge logs, alarm quality) is computed from the
// simulator's 24 h history, so pages agree with each other and with the twin.

import * as sim from './sim.ts';

export const ORG = 'org-demo';
export const SITE_ID = 'site-1';
const MIN = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();

// ── Equipment (ISA-95) ──────────────────────────────────────────────────────

const AREAS: Record<string, { id: string; name: string; sort: number }> = {
  batch: { id: 'area-batch', name: 'Batching plant', sort: 1 },
  sort: { id: 'area-sort', name: 'Sorting', sort: 2 },
};
const LINES: Record<string, { name: string; kind: 'line' | 'cell' | 'unit' }> = {
  'batch.agg': { name: 'Aggregates', kind: 'cell' },
  'batch.cem': { name: 'Cement', kind: 'cell' },
  'batch.liq': { name: 'Liquids & admixture', kind: 'cell' },
  'batch.air': { name: 'Air & dust', kind: 'cell' },
  'batch.mix': { name: 'Mixing & loading', kind: 'cell' },
  'batch.plant': { name: 'Plant control', kind: 'unit' },
  'sort.line1': { name: 'Sorting line 1', kind: 'line' },
  'sort.vision': { name: 'Vision', kind: 'unit' },
};

function deviceMeta(line: string, dev: string): { name: string; kind: string } {
  const n = dev.match(/\d+$/)?.[0] ?? '';
  const by: [RegExp, string, string][] = [
    [/^bin/, line === 'sort.line1' ? 'Gravel bin' : `Aggregate bin ${n}`, 'vessel'],
    [/^belt/, n === '4' ? 'Collector belt 4' : `Feeder belt ${n}`, 'conveyor'],
    [/^skip/, 'Skip hoist', 'motor'],
    [/^silo/, `Cement silo ${n}`, 'vessel'],
    [/^screw/, `Cement screw ${n}`, 'conveyor'],
    [/^tank/, 'Water tank', 'vessel'],
    [/^water/, 'Water valve', 'valve'],
    [/^pump/, 'Water pump', 'pump'],
    [/^admix/, 'Admixture pump', 'pump'],
    [/^drum/, `Admixture drum ${n}`, 'vessel'],
    [/^blower/, 'Roots blower', 'pump'],
    [/^fill/, 'Silo fill line', 'valve'],
    [/^filter/, 'Mixer dust filter', 'indicator'],
    [/^mixer/, 'Mixer M1', 'mixer'],
    [/^truck/, 'Truck bay', 'indicator'],
    [/^auto/, 'Batch sequencer', 'other'],
    [/^production/, 'Production counter', 'other'],
    [/^recipe/, 'Recipe', 'other'],
    [/^motor/, 'Sorter drive motor', 'motor'],
    [/^conv/, 'Sorter conveyor', 'conveyor'],
    [/^cam/, 'Sorter camera', 'indicator'],
  ];
  if (dev === 'weigh1') return { name: line === 'batch.agg' ? 'Aggregate weigher' : line === 'batch.cem' ? 'Cement weigh hopper' : 'Liquid weigher', kind: 'vessel' };
  for (const [re, name, kind] of by) if (re.test(dev)) return { name, kind };
  return { name: dev, kind: 'other' };
}

export interface Eq { id: string; area: string; line: string; dev: string; name: string; kind: string; tags: sim.SimTag[] }
const split = (tail: string) => { const p = tail.split('.'); return { area: p[0], line: `${p[0]}.${p[1]}`, dev: p[2], signal: p.slice(3).join('_') }; };
export const EQUIPMENT: Eq[] = [];
const EQ_OF = new Map<string, Eq>();
for (const t of sim.TAGS) {
  const { area, line, dev } = split(t.tail);
  const id = `dev-${line.replace('.', '-')}-${dev}`;
  let e = EQUIPMENT.find((x) => x.id === id);
  if (!e) { e = { id, area, line, dev, ...deviceMeta(line, dev), tags: [] }; EQUIPMENT.push(e); }
  e.tags.push(t);
  EQ_OF.set(t.tail, e);
}
export const SORTER = 'dev-sort-line1-motor1';
export const MIXER = 'dev-batch-mix-mixer1';
export const SKIP = 'dev-batch-agg-skip1';

/** tag path as the v2 API stores it: site-relative, slashes */
export const pathOf = (t: sim.SimTag) => t.tail.replace(/\./g, '/');
export const tagByPath = (p: string) => sim.tagByTail(p.replace(/\//g, '.'));
export const tagById = (id: string) => sim.TAGS.find((t) => t.id === id);

const openAlarmsOn = (tags: sim.SimTag[]) => {
  const names = new Set(tags.map((t) => t.name));
  return sim.ALARMS.filter((a) => a.state !== 'cleared' && names.has(a.tag)).length;
};

export function hierarchy(withTags: boolean) {
  return {
    areas: Object.entries(AREAS).map(([code, a]) => {
      const lines = Object.entries(LINES).filter(([k]) => k.startsWith(`${code}.`)).map(([k, l]) => {
        const eqs = EQUIPMENT.filter((e) => e.line === k);
        const tags = eqs.flatMap((e) => e.tags);
        return {
          id: `line-${k.replace('.', '-')}`, name: l.name, kind: l.kind, tags: tags.length, alarms: openAlarmsOn(tags),
          equipment: eqs.map((e) => ({
            id: e.id, name: e.name, kind: e.kind, tags: e.tags.length, alarms: openAlarmsOn(e.tags), parts: 0,
            ...(withTags ? { tag_paths: e.tags.map(pathOf) } : {}),
          })),
        };
      });
      const tags = EQUIPMENT.filter((e) => e.area === code).flatMap((e) => e.tags);
      return { id: a.id, site_id: SITE_ID, name: a.name, code, sort: a.sort, tags: tags.length, alarms: openAlarmsOn(tags), lines };
    }),
  };
}

// ── Gateways + protocol data sources ────────────────────────────────────────

export interface Src {
  id: string; edge_id: string; name: string; protocol: 'modbus' | 's7' | 'opcua' | 'sim';
  connection: Record<string, unknown>; poll_ms: number; has_secret: boolean; prefixes: string[];
}
export const SOURCES: Src[] = [
  { id: 'src-mb', edge_id: 'e1', name: 'Batching PLC — aggregates & mixer', protocol: 'modbus', connection: { host: '10.10.1.20', port: 502, unit_id: 1, timeout_ms: 2000 }, poll_ms: 500, has_secret: false, prefixes: ['batch.agg.', 'batch.mix.'] },
  { id: 'src-s7', edge_id: 'e1', name: 'Cement & liquids PLC (S7-1500)', protocol: 's7', connection: { host: '10.10.1.21', rack: 0, slot: 1, timeout_ms: 2000 }, poll_ms: 500, has_secret: false, prefixes: ['batch.cem.', 'batch.liq.'] },
  { id: 'src-ua', edge_id: 'e1', name: 'Air & dust server (OPC UA)', protocol: 'opcua', connection: { endpoint: 'opc.tcp://10.10.1.30:4840', security: 'signencrypt', auth: 'user' }, poll_ms: 1000, has_secret: true, prefixes: ['batch.air.', 'batch.plant.'] },
  { id: 'src-sim', edge_id: 'e2', name: 'Sorting line simulator', protocol: 'sim', connection: {}, poll_ms: 500, has_secret: false, prefixes: ['sort.'] },
];
export const sourceOf = (t: sim.SimTag) => SOURCES.find((s) => s.prefixes.some((p) => t.tail.startsWith(p)))!;
const tagsOfSource = (s: Src) => sim.TAGS.filter((t) => sourceOf(t) === s);

/** Modbus registers are 16-bit: engineering value = raw × scale (the PLC convention the
 *  edge's register map uses); 32-bit counters span two registers. */
const SCALE: Record<string, number> = { '%': 0.1, Hz: 0.1, s: 0.1, 'm/s': 0.001, kg: 0.1, '°C': 0.1, A: 0.1, bar: 0.001, mbar: 0.01, 'L/min': 0.1, 'm³/h': 0.01 };

/** Protocol-correct stored address (the shapes datasources/logic formatAddress reads).
 *  `next(area)` hands out consecutive indices per Modbus area / S7 DB. */
function addressOf(t: sim.SimTag, s: Src, next: (k: string, n?: number) => number): Record<string, unknown> {
  const { line, dev, signal } = split(t.tail);
  switch (s.protocol) {
    case 'modbus': {
      const area = t.type === 'bool' ? (t.writable ? 'coil' : 'discrete_input') : (t.writable ? 'holding_register' : 'input_register');
      if (t.type === 'bool') return { area, index: next(area), datatype: 'bool' };
      return t.unit && SCALE[t.unit] ? { area, index: next(area), datatype: 'uint16' } : { area, index: next(area, 2), datatype: 'uint32', word_order: 'big' };
    }
    case 's7': {
      const db = t.tail.startsWith('batch.cem.') ? 10 : 20;
      if (t.type === 'bool') { const b = next(`db${db}x`); return { area: 'DB', db, byte: 100 + Math.floor(b / 8), bit: b % 8, datatype: 'bool' }; }
      return { area: 'DB', db, byte: next(`db${db}`, 4), datatype: 'real' };
    }
    case 'opcua': {
      const cap = (x: string) => x.replace(/(^|_)([a-z0-9])/g, (_m, _u, c: string) => c.toUpperCase());
      return { node_id: `ns=2;s=Batching.${cap(line.split('.')[1])}.${cap(dev)}.${cap(signal)}` };
    }
    case 'sim': return { behavior: t.behavior ?? 'state' };
  }
}

export function sourceTags(sourceId: string) {
  const s = SOURCES.find((x) => x.id === sourceId);
  if (!s) return null;
  const at: Record<string, number> = {};
  const next = (k: string, n = 1) => { const i = at[k] ?? 0; at[k] = i + n; return i; };
  return tagsOfSource(s).map((t) => {
    const { line, dev, signal } = split(t.tail);
    const address = addressOf(t, s, next);
    return {
      id: t.id, source_id: s.id, line, device: dev, path: pathOf(t), name: signal, type: t.type, unit: t.unit ?? null,
      writable: t.writable, min: t.min ?? null, max: t.max ?? null,
      scale: address.datatype === 'uint16' ? SCALE[t.unit!] : null, offset: null, address,
    };
  });
}

export function sources(edgeId: string, now: number) {
  return SOURCES.filter((s) => s.edge_id === edgeId).map((s) => ({
    id: s.id, edge_id: s.edge_id, name: s.name, protocol: s.protocol, connection: s.connection, poll_ms: s.poll_ms, enabled: true,
    has_secret: s.has_secret, status: 'ok', status_detail: `${tagsOfSource(s).length} tags · last poll ${s.protocol === 'opcua' ? 11 : 4} ms`,
    status_at: iso(now - 1500), tag_count: tagsOfSource(s).length,
  }));
}

export interface EdgeDef { id: string; name: string; adapter: string | null; mqtt: string; cred: number; rotate: boolean; online: boolean; clock: boolean }
export const EDGES: EdgeDef[] = [
  { id: 'e1', name: 'edge-batching-01', adapter: 'multi', mqtt: 'edge-batching-01', cred: 4, rotate: false, online: true, clock: true },
  { id: 'e2', name: 'edge-sorter-02', adapter: 'sim', mqtt: 'edge-sorter-02', cred: 2, rotate: false, online: true, clock: true },
  { id: 'e3', name: 'edge-spare-03', adapter: null, mqtt: 'edge-spare-03', cred: 1, rotate: true, online: false, clock: false },
];
export function edges(now: number) {
  return EDGES.map((e, i) => ({
    id: e.id, org_id: ORG, site_id: SITE_ID, name: e.name, status: 'active', mqtt_username: e.mqtt,
    credential_version: e.cred, last_hb_at: e.online ? iso(now - 400 - i * 300) : null, clock_ok: e.online ? e.clock : null,
    adapter: e.adapter, needs_rotation: e.rotate, config_version: e.online ? 12 + i : 1, config_applied: e.online ? 12 + i : null, config_error: null,
  }));
}
export function siteHealth(now: number) {
  return {
    edges: EDGES.map((e, i) => ({
      id: e.id, name: e.name, status: e.online ? 'up' : 'down', last_hb: e.online ? iso(now - 400 - i * 300) : null,
      clock_ok: e.online ? e.clock : null, buffer_depth: e.online ? 0 : 0, adapter: e.adapter,
      credential_version: e.cred, needs_rotation: e.rotate,
    })),
    buffer_depth: 0, clock_ok: true, adapter: 'multi',
  };
}

// ── Tag queries ─────────────────────────────────────────────────────────────

export function siteTags() {
  return sim.TAGS.map((t) => {
    const eq = EQ_OF.get(t.tail)!;
    return { id: t.id, path: pathOf(t), name: split(t.tail).signal, type: t.type, unit: t.unit ?? null, writable: t.writable, device_id: eq.id, source_id: sourceOf(t).id };
  });
}

/** Raw rows or min/max/avg buckets for [from, to] from the 10 s history. */
export function series(t: sim.SimTag, from: number, to: number, limit: number, agg: string, bucketS?: number) {
  const step = Math.max(10_000, bucketS ? bucketS * 1000 : (to - from) / Math.max(1, limit));
  const rows: Record<string, unknown>[] = [];
  for (let x = from; x <= to && rows.length < 20000; x += step) {
    const v = sim.sampleAt(t.tail, x);
    if (v == null) continue;
    if (agg === 'raw') rows.push({ ts: iso(x), v: t.type === 'bool' ? v > 0 : v, q: 'good' });
    else {
      let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
      for (let y = x; y < x + step; y += 10_000) { const z = sim.sampleAt(t.tail, y); if (z == null) continue; lo = Math.min(lo, z); hi = Math.max(hi, z); sum += z; n++; }
      rows.push({ ts: iso(x), min: n ? lo : null, max: n ? hi : null, avg: n ? +(sum / n).toFixed(3) : null, n });
    }
  }
  return rows;
}

export function tagStats(from: number, to: number) {
  return sim.TAGS.map((t) => {
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    const step = Math.max(10_000, (to - from) / 600);
    for (let x = from; x <= to; x += step) { const v = sim.sampleAt(t.tail, x); if (v == null) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++; }
    const last = sim.value(t.name);
    return {
      tag_id: t.id, path: pathOf(t), name: split(t.tail).signal, unit: t.unit ?? null, type: t.type,
      min: n ? +lo.toFixed(3) : null, max: n ? +hi.toFixed(3) : null, avg: n ? +(sum / n).toFixed(3) : null,
      count: Math.round((to - from) / (sourceOf(t).poll_ms)), last: last ?? 0, last_ts: iso(Date.now()), gaps: 0, max_gap_s: 0,
    };
  });
}

// ── Production: shifts, machines, downtime, OEE ─────────────────────────────

const TZ_MS = 7 * H;   // Asia/Bangkok, no DST
export const SHIFTS = [
  { id: 'sh-day', site_id: SITE_ID, name: 'Day', start_time: '06:00', end_time: '14:00', days_of_week: [1, 2, 3, 4, 5, 6], breaks: [{ start: '10:00', end: '10:15', name: 'Tea' }], enabled: true },
  { id: 'sh-swing', site_id: SITE_ID, name: 'Swing', start_time: '14:00', end_time: '22:00', days_of_week: [1, 2, 3, 4, 5, 6], breaks: [{ start: '18:00', end: '18:30', name: 'Dinner' }], enabled: true },
  { id: 'sh-night', site_id: SITE_ID, name: 'Night', start_time: '22:00', end_time: '06:00', days_of_week: [1, 2, 3, 4, 5], breaks: [], enabled: true },
];
export function currentShift(now: number) {
  const local = new Date(now + TZ_MS);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dow = local.getUTCDay() || 7;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const sh = SHIFTS.find((s) => {
    const a = toMin(s.start_time), b = toMin(s.end_time);
    return s.days_of_week.includes(dow) && (a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b);
  });
  if (!sh) return { shift: null, timezone: 'Asia/Bangkok' };
  const dayStart = now - (minutes * MIN) - local.getUTCSeconds() * 1000;
  const startsAt = dayStart + toMin(sh.start_time) * MIN - (toMin(sh.start_time) > minutes ? DAY : 0);
  const len = ((toMin(sh.end_time) - toMin(sh.start_time) + 1440) % 1440) * MIN;
  return { shift: { id: sh.id, name: sh.name, start_time: sh.start_time, end_time: sh.end_time }, starts_at: iso(startsAt), ends_at: iso(startsAt + len), timezone: 'Asia/Bangkok' };
}
export const NONWORKING = [
  { day: '2026-12-05', reason: "Father's Day (national holiday)" },
  { day: '2026-12-10', reason: 'Constitution Day' },
  { day: '2026-12-31', reason: "New Year's Eve" },
  { day: '2027-01-01', reason: "New Year's Day" },
];

export const REASONS = [
  { id: 'rs-plan', parent_id: null, code: 'PL', name_en: 'Planned', name_th: 'หยุดตามแผน', sort: 1, enabled: true },
  { id: 'rs-plan-break', parent_id: 'rs-plan', code: 'PL-BRK', name_en: 'Scheduled break', name_th: 'พักตามตาราง', sort: 1, enabled: true },
  { id: 'rs-plan-clean', parent_id: 'rs-plan', code: 'PL-CLN', name_en: 'Belt cleaning', name_th: 'ทำความสะอาดสายพาน', sort: 2, enabled: true },
  { id: 'rs-mech', parent_id: null, code: 'ME', name_en: 'Mechanical', name_th: 'เครื่องกล', sort: 2, enabled: true },
  { id: 'rs-mech-slip', parent_id: 'rs-mech', code: 'ME-SLP', name_en: 'Belt slip', name_th: 'สายพานลื่น', sort: 1, enabled: true },
  { id: 'rs-mech-gate', parent_id: 'rs-mech', code: 'ME-GTE', name_en: 'Discharge gate stuck', name_th: 'ประตูปล่อยวัสดุติด', sort: 2, enabled: true },
  { id: 'rs-elec', parent_id: null, code: 'EL', name_en: 'Electrical', name_th: 'ไฟฟ้า', sort: 3, enabled: true },
  { id: 'rs-elec-trip', parent_id: 'rs-elec', code: 'EL-TRP', name_en: 'Motor overload trip', name_th: 'มอเตอร์ตัดเกินพิกัด', sort: 1, enabled: true },
  { id: 'rs-mat', parent_id: null, code: 'MA', name_en: 'Material', name_th: 'วัตถุดิบ', sort: 4, enabled: true },
  { id: 'rs-mat-late', parent_id: 'rs-mat', code: 'MA-LTE', name_en: 'Supply truck late', name_th: 'รถวัตถุดิบมาช้า', sort: 1, enabled: true },
];
/** Classification is stored here; unclassified = the newest stops (left for the operator). */
const classified = new Map<string, { reason_id: string; note: string | null; at: number }>();

export const MACHINES = [
  { device_id: SORTER, name: 'Sorting line 1', line_id: 'line-sort-line1', line: 'Sorting line 1', configured: true, state: 'sort.line1.motor1.running', ideal_cycle_s: 3 },
  { device_id: MIXER, name: 'Mixer M1', line_id: 'line-batch-mix', line: 'Mixing & loading', configured: true, state: 'batch.plant.auto.enabled', ideal_cycle_s: 60 },
  { device_id: SKIP, name: 'Skip hoist', line_id: 'line-batch-agg', line: 'Aggregates', configured: false, state: 'batch.agg.skip1.moving', ideal_cycle_s: 60 },
];

export function dtEvents(from: number, to: number, needsReason?: boolean) {
  const rows = sim.STOPS.filter((s) => s.starts_at >= from && s.starts_at <= to).map((s, i) => {
    const end = s.ends_at;
    const seconds = Math.round(((end ?? Date.now()) - s.starts_at) / 1000);
    // the newest three stay unclassified for the operator; older ones read as classified
    const c = classified.get(s.id) ?? (i >= 3 ? { reason_id: (i % 9 === 0 ? 'rs-mech-slip' : i % 7 === 0 ? 'rs-mech-gate' : 'rs-plan-break'), note: null, at: (end ?? s.starts_at) + 10 * MIN } : null);
    const reason = c ? REASONS.find((r) => r.id === c.reason_id) : null;
    return {
      id: s.id, device_id: SORTER, device: 'Sorting line 1', state: 'idle', starts_at: iso(s.starts_at), ends_at: end ? iso(end) : null, seconds,
      needs_reason: !c && seconds >= 60, reason_id: c?.reason_id ?? null, reason: reason ? reason.name_en : null, note: c?.note ?? null,
      classified_at: c ? iso(c.at) : null,
    };
  });
  return needsReason == null ? rows : rows.filter((r) => r.needs_reason === needsReason);
}
export function classify(id: string, reasonId: string | null, note: string | null) {
  if (!reasonId) classified.delete(id); else classified.set(id, { reason_id: reasonId, note, at: Date.now() });
  return dtEvents(0, Date.now()).find((r) => r.id === id) ?? null;
}

function oeeOf(m: (typeof MACHINES)[number], from: number, to: number) {
  let run = 0, n = 0;
  for (let x = from; x < to; x += MIN) { const v = sim.sampleAt(m.state, x); if (v == null) continue; n++; if (v > 0) run++; }
  const planned_s = Math.round((to - from) / 1000);
  const run_s = n ? Math.round((run / n) * planned_s) : 0;
  const availability = planned_s ? run_s / planned_s : null;
  const performance = m.device_id === SORTER ? 0.86 : 0.94;   // speed losses vs the ideal cycle
  const quality = m.device_id === SORTER ? 0.972 : 0.988;     // sand-contaminated loads are rejects
  const units = Math.round((run_s / m.ideal_cycle_s) * performance);
  const rejects = Math.round(units * (1 - quality));
  return {
    availability, performance, quality, oee: availability == null ? null : +(availability * performance * quality).toFixed(4),
    run_s, planned_s, units, rejects, ideal_cycle_s: m.ideal_cycle_s,
  };
}
export function oee(from: number, to: number, device?: string) {
  const ms = MACHINES.filter((m) => m.configured && (!device || m.device_id === device));
  const machines = ms.map((m) => {
    const r = oeeOf(m, from, to);
    return { device_id: m.device_id, name: m.name, line_id: m.line_id, line: m.line, ...r, state_s: { running: r.run_s, stopped: r.planned_s - r.run_s } };
  });
  const sum = (k: 'run_s' | 'planned_s' | 'units' | 'rejects') => machines.reduce((a, b) => a + b[k], 0);
  const planned = sum('planned_s'), run = sum('run_s');
  const a = planned ? run / planned : null;
  const p = machines.length ? machines.reduce((x, m) => x + (m.performance ?? 0), 0) / machines.length : null;
  const q = machines.length ? machines.reduce((x, m) => x + (m.quality ?? 0), 0) / machines.length : null;
  return {
    machines, from: iso(from), to: iso(to), timezone: 'Asia/Bangkok',
    totals: { availability: a, performance: p, quality: q, oee: a != null && p != null && q != null ? +(a * p * q).toFixed(4) : null, run_s: run, planned_s: planned, units: sum('units'), rejects: sum('rejects'), ideal_cycle_s: null },
  };
}
export function pareto(from: number, to: number) {
  const rows = dtEvents(from, to).filter((r) => r.reason_id);
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const by = new Map<string, { count: number; seconds: number }>();
  for (const r of rows) { const x = by.get(r.reason_id!) ?? { count: 0, seconds: 0 }; x.count++; x.seconds += r.seconds; by.set(r.reason_id!, x); }
  let cum = 0;
  return [...by.entries()].sort((a, b) => b[1].seconds - a[1].seconds).map(([id, x]) => {
    const r = REASONS.find((z) => z.id === id)!;
    const pct = total ? x.seconds / total : null;
    cum += pct ?? 0;
    return { reason_id: id, code: r.code, name_en: r.name_en, name_th: r.name_th, count: x.count, seconds: x.seconds, pct, cum_pct: pct == null ? null : +cum.toFixed(4) };
  });
}
export function trend(weeks: number) {
  const now = Date.now();
  return Array.from({ length: weeks }, (_, i) => {
    const w = weeks - 1 - i;
    const a = 0.9 - 0.012 * Math.sin(w * 1.7) - (w === 3 ? 0.06 : 0);   // one bad week: the gearbox swap
    const p = 0.88 + 0.01 * Math.cos(w * 1.3), q = 0.975 + 0.004 * Math.sin(w);
    const planned = 6 * 16 * 3600;
    return {
      week: iso(now - w * 7 * DAY).slice(0, 10), availability: +a.toFixed(4), performance: +p.toFixed(4), quality: +q.toFixed(4),
      oee: +(a * p * q).toFixed(4), run_s: Math.round(planned * a), planned_s: planned, units: Math.round(planned * a / 3 * p), rejects: Math.round(planned * a / 3 * p * (1 - q)),
    };
  });
}
export function timeline(device: string, from: number, to: number) {
  const m = MACHINES.find((x) => x.device_id === device);
  if (!m) return [];
  const out: { state: string; from: string; to: string; seconds: number }[] = [];
  let cur: string | null = null, start = from;
  for (let x = from; x <= to; x += 30_000) {
    const v = sim.sampleAt(m.state, x);
    const s = v == null ? 'unknown' : v > 0 ? 'running' : 'stopped';
    if (s !== cur) { if (cur) out.push({ state: cur, from: iso(start), to: iso(x), seconds: Math.round((x - start) / 1000) }); cur = s; start = x; }
  }
  if (cur) out.push({ state: cur, from: iso(start), to: iso(to), seconds: Math.round((to - start) / 1000) });
  return out;
}

// ── Vision: models, cameras, rules, per-truck material decisions ────────────

export const MODELS = [
  { id: 'vm-agg', name: 'Aggregate classifier', task: 'segment' as const },
  { id: 'vm-ppe', name: 'PPE detector', task: 'detect' as const },
];
export const VERSIONS = [
  { id: 'vv-agg-1', model_id: 'vm-agg', version: 1, status: 'archived', task: 'segment', source_format: 'pt', sha256: 'a1f3c09e', size_bytes: 6_400_000, imgsz: 640, classes: ['gravel', 'sand'], class_count: 2, ultralytics_version: '8.3.40', notes: 'First field set, 1.2k frames', failure_reason: null, license_attested_at: iso(Date.now() - 60 * DAY), created_at: iso(Date.now() - 60 * DAY) },
  { id: 'vv-agg-2', model_id: 'vm-agg', version: 2, status: 'archived', task: 'segment', source_format: 'onnx', sha256: 'b72e4d11', size_bytes: 11_800_000, imgsz: 640, classes: ['gravel', 'sand', 'empty_bed'], class_count: 3, ultralytics_version: '8.3.40', notes: 'Added empty-bed class', failure_reason: null, license_attested_at: iso(Date.now() - 30 * DAY), created_at: iso(Date.now() - 30 * DAY) },
  { id: 'vv-agg-3', model_id: 'vm-agg', version: 3, status: 'active', task: 'segment', source_format: 'onnx', sha256: 'c93a55f0', size_bytes: 11_900_000, imgsz: 640, classes: ['gravel', 'sand', 'empty_bed'], class_count: 3, ultralytics_version: '8.3.52', notes: 'Retrained on night-shift frames (wet sand)', failure_reason: null, license_attested_at: iso(Date.now() - 9 * DAY), created_at: iso(Date.now() - 9 * DAY) },
  { id: 'vv-ppe-1', model_id: 'vm-ppe', version: 1, status: 'draft', task: 'detect', source_format: 'onnx', sha256: 'd0e1f2a3', size_bytes: 12_300_000, imgsz: 640, classes: ['person', 'helmet', 'vest'], class_count: 3, ultralytics_version: '8.3.52', notes: 'Not yet assigned to a camera', failure_reason: null, license_attested_at: null, created_at: iso(Date.now() - 3 * DAY) },
];
export const modelsList = () => MODELS.map((m) => ({ ...m, version_count: VERSIONS.filter((v) => v.model_id === m.id).length, active_version: VERSIONS.find((v) => v.model_id === m.id && v.status === 'active')?.version ?? null }));

export function cameras(edgeId: string, materialDefaults: Record<string, unknown>) {
  const now = Date.now();
  const truck = sim.value('plant1.batch.mix.truck.present') === true;
  const sand = 0.18 + 0.1 * Math.sin(now / 90_000);
  const all = [
    { id: 'cam-1', edge_id: 'e1', name: 'Truck bay — loading chute', kind: 'upload', has_rtsp_url: false, video_id: 'vid-1', fps_sample: 5, enabled: true, status: 'ok', status_detail: null, status_at: iso(now - 2000),
      engine: 'onnxruntime-cpu', latency_ms: 41, bench_fps: 19.6, fps: 5, model_state: 'ready', model_version: 'v3',
      material: { ...materialDefaults, enabled: true, dry_run: false }, material_live: { gate: truck ? 'present' : 'empty', sand_frac: truck ? +sand.toFixed(3) : 0, coverage: truck ? 0.61 : 0.01, frames: truck ? 38 : 0, decisions: decisionsSince(now - DAY).length, last: lastDecision() } },
    { id: 'cam-2', edge_id: 'e2', name: 'Sorter belt — inspection', kind: 'rtsp', has_rtsp_url: true, video_id: null, fps_sample: 10, enabled: true, status: 'ok', status_detail: null, status_at: iso(now - 1500),
      engine: 'onnxruntime-cpu', latency_ms: 33, bench_fps: 24.1, fps: 10, model_state: 'ready', model_version: 'v3', material: null },
    { id: 'cam-3', edge_id: 'e2', name: 'Stockpile overview', kind: 'rtsp', has_rtsp_url: true, video_id: null, fps_sample: 2, enabled: true, status: 'error', status_detail: 'RTSP 401 — camera password changed', status_at: iso(now - 40 * MIN), model_state: 'none', material: null },
  ];
  return all.filter((c) => c.edge_id === edgeId);
}
export const allCameras = (d: Record<string, unknown>) => EDGES.flatMap((e) => cameras(e.id, d));
/** The material-decision page's camera list (cameras with material settings). */
export const materialCameras = (d: Record<string, unknown>) => allCameras(d).filter((c) => c.material).map((c) => ({
  ...c, edge_name: EDGES.find((e) => e.id === c.edge_id)!.name, placement: 'edge',
}));

/** Deterministic decision for truck #n: 72 % gravel, 23 % sand, 5 % empty bed. */
function decisionFor(n: number) {
  const h = ((n * 2654435761) >>> 0) / 4294967296;
  const decision = h < 0.72 ? 'gravel' : h < 0.95 ? 'sand' : 'no-material';
  const sandFrac = decision === 'gravel' ? 0.08 + h * 0.2 : decision === 'sand' ? 0.6 + (h - 0.72) : 0;
  const margin = decision === 'no-material' ? 0 : Math.abs(0.5 - sandFrac) * 2;
  return { decision, sand_frac: +sandFrac.toFixed(3), margin: +margin.toFixed(3), uncertain: margin < 0.3 && decision !== 'no-material' };
}
/** One decision per loaded truck, timed at each batch's discharge. */
function decisionsSince(from: number) {
  const now = Date.now();
  const out: { n: number; at: number }[] = [];
  const first = Math.ceil((from / 1000 - 58) / 60), last = Math.floor((now / 1000 - 58) / 60);
  for (let k = first; k <= last && out.length < 2000; k++) out.push({ n: k, at: (k * 60 + 58) * 1000 });
  return out.reverse();
}
function lastDecision() { const d = decisionsSince(Date.now() - 5 * MIN)[0]; return d ? decisionFor(d.n) : undefined; }

export function visionEvents(limit: number, kind?: string, cursor?: string) {
  const before = cursor ? Number(cursor) : Date.now();
  const mats = kind && kind !== 'material' ? [] : decisionsSince(before - DAY).filter((d) => d.at < before).slice(0, limit).map((d) => {
    const x = decisionFor(d.n);
    return {
      id: `ve-${d.n}`, camera_id: 'cam-1', rule_id: null, kind: 'material', class_id: x.decision === 'gravel' ? 0 : x.decision === 'sand' ? 1 : 2,
      score: +(0.7 + x.margin * 0.29).toFixed(3), bbox: [0.18, 0.32, 0.62, 0.44], model_version_id: 'vv-agg-3', has_thumb: true,
      severity: x.uncertain ? 'warning' : null, blocked_reason: null,
      detail: {
        decision: x.decision, sand_frac: x.sand_frac, margin: x.margin, uncertain: x.uncertain, frames: 30 + (d.n % 17),
        gravel_w: +(1 - x.sand_frac).toFixed(3), sand_w: x.sand_frac, duration_s: 8, rule: 'mass_vote', truck: d.n,
        outputs: [{ tag_path: 'batch/mix/truck/material_code', result: 'written', value: x.decision === 'gravel' ? 1 : x.decision === 'sand' ? 2 : 0 }],
      },
      fired_at: iso(d.at), review: d.n % 11 === 0 ? { verdict: d.n % 22 === 0 ? 'wrong' : 'correct', corrected_class_id: null } : null,
    };
  });
  const items = mats.slice(0, limit);
  return { items, next_cursor: items.length === limit ? String(Date.parse(items[items.length - 1].fired_at)) : null };
}
export function materialSummary(minutes: number) {
  const ds = decisionsSince(Date.now() - minutes * MIN).map((d) => decisionFor(d.n));
  const by: Record<string, number> = { gravel: 0, sand: 0, 'no-material': 0 };
  const hist = Array(10).fill(0);
  for (const d of ds) { by[d.decision]++; if (d.decision !== 'no-material') hist[Math.min(9, Math.floor(d.margin * 10))]++; }
  return { total: ds.length, by_decision: by, mass: { gravel: +(by.gravel * 8.2).toFixed(1), sand: +(by.sand * 7.6).toFixed(1) }, margin_hist: hist, uncertain: ds.filter((d) => d.uncertain).length, reviewed: Math.floor(ds.length / 11), wrong: Math.floor(ds.length / 22) };
}
export function visionMetrics(minutes: number) {
  const now = Date.now(), step = Math.max(60, Math.round((minutes * 60) / 60));
  return { step_s: step, items: Array.from({ length: Math.ceil((minutes * 60) / step) }, (_, i) => {
    const t = now - (minutes * 60 - i * step) * 1000;
    const lat = 38 + 6 * Math.sin(t / 400_000);
    return { t: iso(t), fps: 5, lat_avg: +lat.toFixed(1), lat_p50: +(lat - 2).toFixed(1), lat_p95: +(lat + 14).toFixed(1), infer_n: step * 5, det_n: Math.round(step * 5 * 0.4), present_n: Math.round(step * 5 * 0.45), n: step * 5 };
  }) };
}
export const VISION_RULES = [
  { id: 'vr-1', camera_id: 'cam-1', model_version_id: 'vv-agg-3', name: 'Sand on a gravel order → hold the chute', enabled: true, dry_run: false, allow_cloud_write: false, offline_write_window_s: null,
    conditions: { class_ids: [1], min_score: 0.6, hold_frames: 15 }, actions: [{ kind: 'alarm', severity: 'warning', message: 'Sand detected on a gravel load' }, { kind: 'snapshot' }], created_at: iso(Date.now() - 20 * DAY), updated_at: iso(Date.now() - 2 * DAY) },
  { id: 'vr-2', camera_id: 'cam-2', model_version_id: 'vv-agg-3', name: 'Count gravel lumps on the sorter belt', enabled: true, dry_run: true, allow_cloud_write: false, offline_write_window_s: null,
    conditions: { class_ids: [0], min_score: 0.5, count_in_zone: 3, zone: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8], [0.1, 0.8]] }, actions: [{ kind: 'counter', tag_path: 'sort/line1/bin1/level_pct', by: 1 }], created_at: iso(Date.now() - 12 * DAY), updated_at: iso(Date.now() - 12 * DAY) },
];

/** A camera frame as SVG — the truck bay with or without a truck, timestamped. */
export function frameSvg(camId: string): string {
  const now = new Date();
  const truck = camId === 'cam-1' && sim.value('plant1.batch.mix.truck.present') === true;
  const belt = camId === 'cam-2';
  const ts = now.toISOString().replace('T', ' ').slice(0, 19);
  const scene = belt
    ? `<rect x="0" y="210" width="640" height="70" fill="#3a3f47"/>${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 53 + (now.getTime() / 40) % 53) % 640}" cy="${232 + (i % 3) * 14}" r="${6 + (i % 4)}" fill="#8b7a5e"/>`).join('')}`
    : `<rect x="0" y="300" width="640" height="60" fill="#2b2f36"/><rect x="230" y="40" width="180" height="70" fill="#4a5563"/><path d="M290 110 L350 110 L335 170 L305 170 Z" fill="#5d6670"/>${truck ? '<rect x="150" y="190" width="300" height="110" rx="8" fill="#c9ced6"/><rect x="450" y="215" width="70" height="85" rx="6" fill="#9aa4b1"/><circle cx="210" cy="305" r="22" fill="#18202a"/><circle cx="400" cy="305" r="22" fill="#18202a"/><circle cx="490" cy="305" r="22" fill="#18202a"/><path d="M190 200 Q300 150 420 200 Z" fill="#8b7a5e"/>' : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#1b1f26"/>${scene}<text x="14" y="26" fill="#e7eaf0" font-family="monospace" font-size="15">${camId.toUpperCase()}  ${ts}Z</text><text x="14" y="346" fill="#9aa4b1" font-family="monospace" font-size="12">mock stream · ${truck ? 'truck present' : belt ? 'belt running' : 'bay empty'}</text></svg>`;
}

// ── Feeds: events, edge logs, notification deliveries, alarm quality ────────

export function events(from: number, to: number, type?: string, limit = 100) {
  const items: Record<string, unknown>[] = [];
  for (const a of sim.ALARMS) {
    const t = sim.tagByName(a.tag);
    const push = (ts: string | null, action: string, actor: string | null) => {
      if (!ts) return;
      const ms = Date.parse(ts);
      if (ms < from || ms > to) return;
      items.push({ id: `ev-${a.id}-${action}`, ts, type: 'alarm', action, severity: a.severity, site_id: SITE_ID, tag_id: t?.id ?? null, tag: t ? pathOf(t) : a.tag, actor, subject: a.rule });
    };
    push(a.ts, 'raised', null);
    push(a.acked_at, 'acknowledged', a.acked_by);
    push(a.cleared_at, 'cleared', null);
  }
  for (const s of sim.STOPS) {
    if (s.starts_at < from || s.starts_at > to) continue;
    items.push({ id: `ev-${s.id}`, ts: iso(s.starts_at), type: 'command', action: 'stop', severity: null, site_id: SITE_ID, tag_id: sim.tagByTail('sort.line1.motor1.running')?.id ?? null, tag: 'sort/line1/motor1/running', actor: 'shift-operator', subject: 'Planned stop — sorter' });
  }
  const filtered = (type ? items.filter((e) => e.type === type) : items).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return filtered.slice(0, limit);
}

const LOG_LINES: Record<string, [string, string, string][]> = {
  e1: [['info', 'modbus', 'poll ok · 33 tags · 4 ms'], ['info', 's7', 'poll ok · 34 tags · 6 ms'], ['info', 'opcua', 'subscription heartbeat · 14 monitored items'],
    ['warn', 'modbus', 'read timeout unit 1 holding 40017, retry 1/3 ok'], ['info', 'mqtt', 'published 412 samples, buffer 0'], ['warn', 'opcua', 'server certificate expires in 21 days'],
    ['error', 's7', 'read DB20 failed: connection reset by peer'], ['info', 's7', 'reconnected to 10.10.1.21 rack 0 slot 1']],
  e2: [['info', 'sim', 'tick ok · 6 tags'], ['info', 'mqtt', 'published 120 samples, buffer 0'], ['info', 'vision', 'cam-2 inference 33 ms (onnxruntime-cpu)'],
    ['warn', 'vision', 'cam-3 stream open failed: RTSP 401 Unauthorized'], ['info', 'config', 'config v13 applied']],
};
export function edgeLogs(from: number, to: number, p: { edge?: string; level?: string; q?: string; limit?: number }) {
  const out: Record<string, unknown>[] = [];
  let id = 1;
  for (let t = Math.floor(to / MIN) * MIN; t >= from && out.length < (p.limit ?? 200); t -= MIN) {
    for (const e of ['e1', 'e2']) {
      const lines = LOG_LINES[e];
      const k = Math.floor(t / MIN);
      const [level, source, msg] = lines[k % 7 === 0 ? (k % lines.length) : (k % 2)];
      const row = { id: id++, ts: iso(t + (e === 'e1' ? 1200 : 3400)), level, source, msg, edge_id: e, site_id: SITE_ID };
      if (p.edge && p.edge !== e) continue;
      if (p.level && p.level !== level) continue;
      if (p.q && !msg.toLowerCase().includes(p.q.toLowerCase())) continue;
      out.push(row);
    }
  }
  return out.slice(0, p.limit ?? 200);
}

export function deliveries(limit = 50) {
  return sim.ALARMS.filter((a) => a.severity !== 'info').slice(0, limit).map((a, i) => ({
    id: 9000 - i, channel_id: a.severity === 'critical' ? 'c-2' : 'c-1', channel: a.severity === 'critical' ? 'LINE night shift' : 'Ops email',
    type: a.severity === 'critical' ? 'line' : 'email', alarm_id: String(a.id), kind: 'raised', target: a.severity === 'critical' ? 'LINE group · Maintenance' : 'ops@demo.plant',
    status: i % 23 === 5 ? 'failed' : 'sent', attempts: i % 23 === 5 ? 3 : 1, at: a.ts,
  }));
}

export function alarmQuality(hours: number) {
  const now = Date.now(), from = now - hours * H;
  const rows = sim.ALARMS.filter((a) => Date.parse(a.ts) >= from);
  const hourly = Array.from({ length: hours }, (_, i) => rows.filter((a) => { const t = Date.parse(a.ts); return t >= from + i * H && t < from + (i + 1) * H; }).length);
  let peak = 0;
  for (let t = from; t < now; t += 10 * MIN) peak = Math.max(peak, rows.filter((a) => { const x = Date.parse(a.ts); return x >= t && x < t + 10 * MIN; }).length);
  const byRule = new Map<string, typeof rows>();
  for (const a of rows) byRule.set(a.rule_id, [...(byRule.get(a.rule_id) ?? []), a]);
  const total = rows.length;
  const ruleRows = [...byRule.entries()].map(([rid, as]) => {
    const r = sim.RULES.find((x) => x.id === rid)!;
    const acked = as.filter((a) => a.acked_at);
    const mtta = acked.length ? acked.reduce((s, a) => s + (Date.parse(a.acked_at!) - Date.parse(a.ts)) / 1000, 0) / acked.length : null;
    const chatter = as.filter((a) => a.cleared_at && Date.parse(a.cleared_at) - Date.parse(a.ts) < 60_000).length;
    const standing = as.filter((a) => a.state !== 'cleared' && now - Date.parse(a.ts) > 24 * H).length;
    const unacked = as.filter((a) => a.state === 'active').length;
    const flags = [...(as.length / Math.max(total, 1) > 0.2 ? ['frequent'] : []), ...(chatter > 2 ? ['chatter'] : []), ...(standing ? ['standing'] : []), ...(unacked ? ['unacked'] : [])];
    return { rule_id: rid, rule: sim.ruleText(r), severity: r.severity, count: as.length, share: +(as.length / Math.max(total, 1)).toFixed(4), chatter, standing, unacked, mtta_s: mtta == null ? null : Math.round(mtta), flags };
  }).sort((a, b) => b.count - a.count);
  const top10 = ruleRows.slice(0, 10).reduce((s, r) => s + r.count, 0);
  return {
    hours, operators: 2, total, alarms_per_hour: +(total / hours).toFixed(2), alarms_per_operator_hour: +(total / hours / 2).toFixed(2),
    peak_10m: peak, hourly, standing: ruleRows.reduce((s, r) => s + r.standing, 0), unacked: ruleRows.reduce((s, r) => s + r.unacked, 0),
    top10_share: total ? +(top10 / total).toFixed(4) : 0, rules: ruleRows,
  };
}
