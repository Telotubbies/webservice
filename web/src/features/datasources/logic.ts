// Pure logic for the Data sources console (no React, no i18n, no fetch) so it
// can be unit-tested with `bun test`. Mirrors the backend rules in
// backend/app/datasources/{taginput,addresses}.py closely enough to give
// instant row-level feedback; the server stays the authority.

export type Protocol = 'sim' | 'modbus' | 's7' | 'opcua';
export const PROTOCOLS: Protocol[] = ['sim', 'modbus', 's7', 'opcua'];
export type TagType = 'bool' | 'number';

export const CSV_COLUMNS = ['line', 'device', 'signal', 'address', 'type', 'unit', 'writable', 'min', 'max', 'scale'] as const;
const REQUIRED = ['line', 'device', 'signal', 'address'] as const;
export const BULK_MAX_ROWS = 1000;

/** Placeholder shown in the address input, per protocol (and tag type). */
export function addressPlaceholder(protocol: Protocol, type: TagType = 'number'): string {
  switch (protocol) {
    case 'modbus': return type === 'bool' ? '%QX0.0' : '40001';
    case 's7': return type === 'bool' ? 'DB1.DBX0.0' : 'DB1.DBD4';
    case 'opcua': return 'ns=3;s=Motor1.Speed';
    case 'sim': return '{"behavior":"random_walk"}';
  }
}

/** Same normalisation as the backend `norm_name`; null when unusable. */
export function normName(s: string): string | null {
  const out = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return out && out.length <= 40 ? out : null;
}

export const tagPath = (line: string, device: string, signal: string): string | null => {
  const l = normName(line), d = normName(device), s = normName(signal);
  return l && d && s ? `${l}/${d}/${s}` : null;
};

// ------------------------------------------------------------------- CSV
export interface CsvRowError { row: number; field: string; message: string }
export interface TagDraft {
  line: string; device: string; signal: string; address: string; type: TagType;
  unit: string; writable: boolean; min: number | null; max: number | null; scale: number | null;
}

/** RFC-4180-ish splitter: quoted cells, doubled quotes, CRLF, comma or tab.
 *  Excel/Sheets paste is tab-separated, so the delimiter is sniffed from the
 *  header line. Returns rows with their 1-based file line number. */
export function splitCsv(text: string): { row: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: { row: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = '', quoted = false, line = 1, start = 1;
  const endRow = () => { cells.push(cell); rows.push({ row: start, cells }); cells = []; cell = ''; start = line; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      line++; endRow();
    } else cell += c;
  }
  if (cell !== '' || cells.length) endRow();
  return rows.filter((r) => r.cells.some((x) => x.trim() !== ''));
}

const TRUE = new Set(['true', '1', 'yes', 'y']);
const FALSE = new Set(['false', '0', 'no', 'n', '']);

export interface CsvResult { rows: TagDraft[]; errors: CsvRowError[] }

/** Validate pasted CSV. All-or-nothing like the server: any error => no rows. */
export function parseTagCsv(text: string): CsvResult {
  const raw = splitCsv(text);
  const fail = (message: string, field = 'header'): CsvResult => ({ rows: [], errors: [{ row: 1, field, message }] });
  if (raw.length === 0) return fail('empty body');
  const header = raw[0].cells.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  const unknown = header.filter((c) => !(CSV_COLUMNS as readonly string[]).includes(c));
  if (missing.length) return fail(`missing columns: ${missing.join(', ')}`);
  if (unknown.length) return fail(`unknown columns: ${unknown.join(', ')}`);
  const data = raw.slice(1);
  if (data.length === 0) return fail('no data rows');
  if (data.length > BULK_MAX_ROWS) return fail(`at most ${BULK_MAX_ROWS} rows`, 'rows');
  const rows: TagDraft[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  for (const { row, cells } of data) {
    const get = (k: string) => (cells[header.indexOf(k)] ?? '').trim();
    const bad = (field: string, message: string) => errors.push({ row, field, message });
    const miss = REQUIRED.find((f) => !get(f));
    if (miss) { bad(miss, 'required'); continue; }
    const w = get('writable').toLowerCase();
    if (!TRUE.has(w) && !FALSE.has(w)) { bad('writable', 'must be true or false'); continue; }
    const type = (get('type') || 'number') as TagType;
    if (type !== 'bool' && type !== 'number') { bad('type', 'must be bool or number'); continue; }
    const path = tagPath(get('line'), get('device'), get('signal'));
    if (!path) {
      const f = (['line', 'device', 'signal'] as const).find((k) => !normName(get(k))) ?? 'signal';
      bad(f, 'must contain 1-40 letters/digits'); continue;
    }
    let numErr = false;
    const n: Record<string, number | null> = {};
    for (const f of ['min', 'max', 'scale']) {
      const s = get(f);
      const v = s === '' ? null : Number(s);
      if (v !== null && !Number.isFinite(v)) { bad(f, 'must be a number'); numErr = true; }
      n[f] = v;
    }
    if (numErr) continue;
    if (n.scale === 0) { bad('scale', 'must not be 0'); continue; }
    if (type === 'bool' && n.scale != null) { bad('scale', 'not applicable to bool tags'); continue; }
    if (n.min != null && n.max != null && n.min > n.max) { bad('min', 'must be <= max'); continue; }
    if (seen.has(path)) { bad('signal', `duplicate tag ${path}`); continue; }
    seen.add(path);
    rows.push({
      line: get('line'), device: get('device'), signal: get('signal'), address: get('address'),
      type, unit: get('unit'), writable: TRUE.has(w), min: n.min, max: n.max, scale: n.scale,
    });
  }
  return errors.length ? { rows: [], errors } : { rows, errors: [] };
}

const csvCell = (v: string | number | boolean | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialise drafts to the exact CSV the bulk endpoint takes. */
export function tagsToCsv(tags: TagDraft[]): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const t of tags) {
    lines.push([t.line, t.device, t.signal, t.address, t.type, t.unit, t.writable ? 'true' : 'false', t.min, t.max, t.scale].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// --------------------------------------------------------- config state
export type ConfigState =
  | { kind: 'none' }
  | { kind: 'applied'; version: number }
  | { kind: 'pending'; version: number; applied: number | null }
  | { kind: 'error'; version: number; message: string };

/** Gateway config sync state: error beats pending beats applied. */
export function configState(e: { config_version?: number; config_applied?: number | null; config_error?: string | null }): ConfigState {
  const version = e.config_version ?? 0;
  if (e.config_error) return { kind: 'error', version, message: e.config_error };
  if (version <= 0) return { kind: 'none' };
  if (e.config_applied != null && e.config_applied === version) return { kind: 'applied', version };
  return { kind: 'pending', version, applied: e.config_applied ?? null };
}

// ----------------------------------------------------------- templates
export interface TemplateRule { name: string; path: string; kind: 'hi' | 'lo'; threshold: number; severity: 'critical' | 'warning' | 'info' }
export interface SourceTemplate {
  id: string;
  source: { name: string; protocol: Protocol; connection: Record<string, unknown>; poll_ms: number };
  tags: TagDraft[];
  /** id in features/dashboards/templates.ts (resolved by the executor) */
  dashboardTemplateId: string;
  rules: TemplateRule[];
}

export type PlanStep =
  | { kind: 'source'; body: SourceTemplate['source'] }
  | { kind: 'tags'; csv: string; count: number }
  | { kind: 'dashboard'; templateId: string; siteCode: string }
  | { kind: 'rule'; rule: TemplateRule };

/** The ordered API calls applying a template makes. Pure so it is testable;
 *  the executor (apply.ts) runs them in sequence and reports progress. */
export function templatePlan(tpl: SourceTemplate, siteCode: string): PlanStep[] {
  return [
    { kind: 'source', body: tpl.source },
    { kind: 'tags', csv: tagsToCsv(tpl.tags), count: tpl.tags.length },
    { kind: 'dashboard', templateId: tpl.dashboardTemplateId, siteCode },
    ...tpl.rules.map((rule): PlanStep => ({ kind: 'rule', rule })),
  ];
}

/** Dashboard templates name tags `plant1.sort.line1.motor1.running`; tags made
 *  through the console API have three path segments (`sort/motor1/running`),
 *  displayed as `<site>.sort.motor1.running`. Map the 5-part sim name onto it
 *  (drops the plant prefix and the `line1` segment). */
export function remapDashboardTag(name: string, siteCode: string): string {
  const p = name.split('.');
  return p.length === 5 ? [siteCode, p[1], p[3], p[4]].join('.') : name;
}

/** Live value lookup key: tag display name is `<site>.<path with dots>`. */
export function liveKey(siteCode: string, path: string): string {
  return `${siteCode}.${path.replace(/\//g, '.')}`;
}

/** Row errors from a 422 invalid_csv body, or null when it is another error. */
export function csvErrorsFromBody(body: unknown): CsvRowError[] | null {
  const b = body as { detail?: string; errors?: CsvRowError[] } | null;
  return b && b.detail === 'invalid_csv' && Array.isArray(b.errors) ? b.errors : null;
}

/** OPC UA form rules: sign/signencrypt are not supported yet; user auth needs encryption. */
export function opcuaIssues(c: { security?: string; auth?: string }): string[] {
  const out: string[] = [];
  if (c.security && c.security !== 'none') out.push('securityUnsupported');
  if (c.auth === 'user' && (c.security ?? 'none') === 'none') out.push('authNeedsEncryption');
  return out;
}

// ------------------------------------------------------ address display
/** Canonical, re-parseable text for a stored (normalised) address object. */
export function formatAddress(a: unknown): string {
  if (typeof a === 'string') return a;
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  if (typeof o.node_id === 'string') return o.node_id;
  if (typeof o.behavior === 'string') return JSON.stringify(o);
  if (typeof o.area === 'string' && typeof o.index === 'number') {
    const lead = ({ coil: '0', discrete_input: '1', input_register: '3', holding_register: '4' } as Record<string, string>)[o.area];
    const dt = o.datatype;
    const plain = dt === 'bool' || dt === 'uint16';
    if (lead && plain && o.index + 1 <= 9999 && (o.word_order ?? 'big') === 'big') return `${lead}${String(o.index + 1).padStart(4, '0')}`;
    return JSON.stringify(o);
  }
  if (typeof o.area === 'string' && typeof o.byte === 'number' && typeof o.datatype === 'string') {
    const dt = o.datatype;
    const k = dt === 'bool' ? 'X' : dt === 'int' || dt === 'word' ? 'W' : 'D';
    const suffix = dt === 'word' ? ':word' : dt === 'dint' ? ':dint' : '';
    const bit = dt === 'bool' ? `.${o.bit}` : '';
    return o.area === 'DB' ? `DB${o.db}.DB${k}${o.byte}${bit}${suffix}` : `${o.area}${k === 'X' ? '' : k}${o.byte}${bit}${suffix}`;
  }
  return JSON.stringify(o);
}

/** Text typed in an address box -> API value (JSON object when it looks like one). */
export function addressInput(text: string): string | Record<string, unknown> {
  const s = text.trim();
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { return s; } }
  return s;
}

// ---------------------------------------------------------- OPC UA browse
export interface BrowseNode { node_id: string; name: string; node_class: string; data_type: string | null; writable: boolean }

/** Selected OPC UA variables -> tag drafts under one line/device. */
export function browseToDrafts(nodes: BrowseNode[], line: string, device: string): TagDraft[] {
  const used = new Set<string>();
  return nodes.map((n) => {
    let base = normName(n.name) ?? 'node', sig = base, i = 2;
    while (used.has(sig)) sig = `${base.slice(0, 36)}_${i++}`;
    used.add(sig);
    return {
      line, device, signal: sig, address: n.node_id, type: /^bool/i.test(n.data_type ?? '') ? 'bool' : 'number',
      unit: '', writable: false, min: null, max: null, scale: null,
    } satisfies TagDraft;
  });
}
