import { describe, expect, test } from 'bun:test';
import {
  addressPlaceholder, configState, csvErrorsFromBody, opcuaIssues, parseTagCsv,
  remapDashboardTag, splitCsv, tagsToCsv, templatePlan,
} from './logic';
import { factoryioSorting } from './templates';

const H = 'line,device,signal,address,type,unit,writable,min,max,scale';

describe('addressPlaceholder', () => {
  test('per protocol', () => {
    expect(addressPlaceholder('modbus')).toBe('40001');
    expect(addressPlaceholder('modbus', 'bool')).toBe('%QX0.0');
    expect(addressPlaceholder('s7')).toBe('DB1.DBD4');
    expect(addressPlaceholder('opcua')).toBe('ns=3;s=Motor1.Speed');
  });
});

describe('parseTagCsv', () => {
  test('valid rows', () => {
    const r = parseTagCsv(`${H}\nsort,motor1,speed,40001,number,Hz,true,0,60,0.1\nsort,motor1,running,%QX0.0,bool,,yes,,,\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ address: '40001', writable: true, min: 0, max: 60, scale: 0.1, unit: 'Hz' });
    expect(r.rows[1]).toMatchObject({ type: 'bool', writable: true, min: null });
  });
  test('minimal columns default to number, read-only', () => {
    const r = parseTagCsv('line,device,signal,address\nA,B,C,40001');
    expect(r.rows[0]).toMatchObject({ type: 'number', writable: false });
  });
  test('tab separated (spreadsheet paste) and CRLF', () => {
    const r = parseTagCsv('line\tdevice\tsignal\taddress\r\nA\tB\tC\t40001\r\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
  test('quoted cell with comma', () => {
    expect(splitCsv('a,"b,c",d')[0].cells).toEqual(['a', 'b,c', 'd']);
  });
  test('header problems', () => {
    expect(parseTagCsv('line,device,address\nA,B,1').errors[0].message).toContain('missing columns: signal');
    expect(parseTagCsv(`${H},bogus\n`).errors[0].message).toContain('unknown columns: bogus');
    expect(parseTagCsv('').errors[0].message).toBe('empty body');
    expect(parseTagCsv(`${H}\n`).errors[0].message).toBe('no data rows');
  });
  test('collects every bad row with file line numbers, all-or-nothing', () => {
    const r = parseTagCsv(`${H}\nA,B,C,1,number,,maybe,,,\nA,B,D,1,number,,,5,1,\nA,B,E,1,number,,,,,0\nA,B,F,,number,,,,,\nA,B,G,1,text,,,,,\nA,B,H,1,number,,,x,,`);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[2, 'writable'], [3, 'min'], [4, 'scale'], [5, 'address'], [6, 'type'], [7, 'min']]);
  });
  test('duplicate path after normalisation', () => {
    const r = parseTagCsv(`${H}\nSort,Motor 1,Speed,1,number,,,,,\nsort,motor-1,speed,2,number,,,,,`);
    expect(r.errors[0]).toMatchObject({ row: 3, field: 'signal' });
  });
  test('bool with scale rejected', () => {
    expect(parseTagCsv(`${H}\nA,B,C,%QX0.0,bool,,,,,2`).errors[0].field).toBe('scale');
  });
});

describe('csv round trip', () => {
  test('tagsToCsv -> parseTagCsv', () => {
    const r = parseTagCsv(tagsToCsv(factoryioSorting.tags));
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual(factoryioSorting.tags);
  });
});

describe('csvErrorsFromBody', () => {
  test('extracts server row errors', () => {
    const e = [{ row: 2, field: 'address', message: 'bad' }];
    expect(csvErrorsFromBody({ detail: 'invalid_csv', errors: e })).toEqual(e);
    expect(csvErrorsFromBody({ detail: 'other' })).toBeNull();
  });
});

describe('configState', () => {
  test('labels', () => {
    expect(configState({})).toEqual({ kind: 'none' });
    expect(configState({ config_version: 3, config_applied: 3 })).toEqual({ kind: 'applied', version: 3 });
    expect(configState({ config_version: 4, config_applied: 3 })).toEqual({ kind: 'pending', version: 4, applied: 3 });
    expect(configState({ config_version: 1, config_applied: null }).kind).toBe('pending');
    expect(configState({ config_version: 3, config_applied: 3, config_error: 'boom' })).toEqual({ kind: 'error', version: 3, message: 'boom' });
  });
});

describe('template plan', () => {
  const plan = templatePlan(factoryioSorting, 'plant1');
  test('order: source, tags, dashboard, rules', () => {
    expect(plan.map((s) => s.kind)).toEqual(['source', 'tags', 'dashboard', 'rule', 'rule']);
  });
  test('modbus source verbatim', () => {
    expect(plan[0]).toMatchObject({ body: { protocol: 'modbus', connection: { host: 'host.docker.internal', port: 502, unit_id: 1 } } });
  });
  test('tags: 6 yaml tags + writable pusher coil', () => {
    const t = factoryioSorting.tags;
    expect(t).toHaveLength(7);
    expect(t.find((x) => x.signal === 'extend')).toMatchObject({ device: 'pusher1', address: '%QX0.1', type: 'bool', writable: true });
    expect(t.find((x) => x.signal === 'speed_sp')).toMatchObject({ address: '%QW2', scale: 0.1, min: 0, max: 60, writable: true });
  });
  test('rules reference existing tags', () => {
    const paths = new Set(factoryioSorting.tags.map((t) => `${t.line}/${t.device}/${t.signal}`));
    for (const r of factoryioSorting.rules) expect(paths.has(r.path)).toBe(true);
  });
});

describe('tag names', () => {
  test('dashboard tag remap', () => {
    expect(remapDashboardTag('plant1.sort.line1.motor1.running', 'plant1')).toBe('plant1.sort.motor1.running');
    expect(remapDashboardTag('plant1.sort.vision.cam1.gravel_ratio', 'p2')).toBe('p2.sort.cam1.gravel_ratio');
  });
});

describe('opcuaIssues', () => {
  test('rules', () => {
    expect(opcuaIssues({ security: 'none', auth: 'anonymous' })).toEqual([]);
    expect(opcuaIssues({ security: 'sign' })).toEqual(['securityUnsupported']);
    expect(opcuaIssues({ security: 'none', auth: 'user' })).toEqual(['authNeedsEncryption']);
  });
});

import { addressInput, browseToDrafts, formatAddress } from './logic';

describe('formatAddress', () => {
  test('modbus / s7 / opcua', () => {
    expect(formatAddress({ area: 'holding_register', index: 0, datatype: 'uint16', word_order: 'big' })).toBe('40001');
    expect(formatAddress({ area: 'coil', index: 1, datatype: 'bool', word_order: 'big' })).toBe('00002');
    expect(formatAddress({ area: 'input_register', index: 4, datatype: 'float32', word_order: 'big' })).toContain('float32');
    expect(formatAddress({ area: 'DB', db: 1, byte: 4, datatype: 'real' })).toBe('DB1.DBD4');
    expect(formatAddress({ area: 'DB', db: 1, byte: 0, bit: 3, datatype: 'bool' })).toBe('DB1.DBX0.3');
    expect(formatAddress({ area: 'M', byte: 10, datatype: 'word' })).toBe('MW10:word');
    expect(formatAddress({ area: 'I', byte: 0, bit: 0, datatype: 'bool' })).toBe('I0.0');
    expect(formatAddress({ node_id: 'ns=3;s=A' })).toBe('ns=3;s=A');
  });
  test('addressInput', () => {
    expect(addressInput(' 40001 ')).toBe('40001');
    expect(addressInput('{"node_id":"ns=1;i=5"}')).toEqual({ node_id: 'ns=1;i=5' });
  });
});

describe('browseToDrafts', () => {
  test('names, types, duplicate signals', () => {
    const d = browseToDrafts([
      { node_id: 'ns=3;s=Motor1.Speed', name: 'Speed', node_class: 'Variable', data_type: 'Double', writable: false },
      { node_id: 'ns=3;s=Motor2.Speed', name: 'Speed', node_class: 'Variable', data_type: 'Double', writable: true },
      { node_id: 'ns=3;s=Run', name: 'Run', node_class: 'Variable', data_type: 'Boolean', writable: true },
    ], 'line1', 'plc');
    expect(d.map((x) => x.signal)).toEqual(['speed', 'speed_2', 'run']);
    expect(d[2].type).toBe('bool');
    expect(parseTagCsv(tagsToCsv(d)).errors).toEqual([]);
  });
});

describe('tsv paste', () => {
  test('re-serialised rows are comma csv the server accepts', () => {
    const r = parseTagCsv('line\tdevice\tsignal\taddress\tunit\nA\tB\tC\t40001\tm/s,x\n');
    expect(r.errors).toEqual([]);
    const csv = tagsToCsv(r.rows);
    expect(csv.split('\n')[0]).toBe('line,device,signal,address,type,unit,writable,min,max,scale');
    expect(splitCsv(csv)[1].cells[5]).toBe('m/s,x');
  });
});
