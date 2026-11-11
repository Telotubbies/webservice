import { expect, test } from 'bun:test';
import type { Alarm, AlarmRule, Command } from '../../types';
import {
  buildRows, commandCode, connOf, levelOf, atLevel, matches, newestCommand, rowLimits, rowState, staleOf, worstAlarm,
  type EqMeta,
} from './lineModel';

const rule = (r: Partial<AlarmRule> & Pick<AlarmRule, 'kind'>): AlarmRule => ({
  tag: 'line.speed', name: r.kind, threshold: 10, stale_s: null, deadband: 0, severity: 'warning', enabled: true, ...r,
});

const cmd = (c: Partial<Command> & Pick<Command, 'id' | 'tag'>): Command => ({
  value: 1, status: 'done', created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z', ...c,
});

const EQUIPMENT: EqMeta[] = [
  { id: 'motor', labelKey: 'line.motor', signals: ['line.speed', 'line.running'] },
  { id: 'bin', labelKey: 'line.bin', signals: ['line.level'] },
];

test('limits take the tightest lo and hi of the enabled rules of that tag', () => {
  const rules = [
    rule({ kind: 'hi', threshold: 55 }), rule({ kind: 'hihi', threshold: 58 }),
    rule({ kind: 'lo', threshold: 5 }), rule({ kind: 'lolo', threshold: 2 }),
    rule({ kind: 'hi', threshold: 40, enabled: false }),
    rule({ kind: 'hi', tag: 'other.signal', threshold: 10 }),
  ];
  expect(rowLimits(rules, 'line.speed')).toEqual({ lo: 5, hi: 55 });
});

test('a missing reading, an old one or bad quality all count as stale', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  expect(staleOf(undefined, now)).toBe(true);
  expect(staleOf({ v: 1, q: 'good', ts: '2026-11-11T10:00:10Z' }, now)).toBe(true);
  expect(staleOf({ v: 1, q: 'good', ts: '2026-11-11T10:00:28Z' }, now)).toBe(false);
  expect(staleOf({ v: 1, q: 'bad', ts: '2026-11-11T10:00:29Z' }, now)).toBe(true);
});

test('the command word follows what the signal means, not the value type', () => {
  expect(commandCode('run', true)).toBe('START');
  expect(commandCode('run', false)).toBe('STOP');
  expect(commandCode('set', 32)).toBe('SET');
  expect(commandCode('other', 1)).toBe('OTHER');
});

test('the last command is the newest one on the equipment, never another tag', () => {
  const rows = [
    cmd({ id: 'a', tag: 'line.speed', updated_at: '2026-11-11T09:00:00Z' }),
    cmd({ id: 'b', tag: 'line.running', updated_at: '2026-11-11T09:30:00Z' }),
    cmd({ id: 'c', tag: 'other.tag', updated_at: '2026-11-11T09:59:00Z' }),
  ];
  expect(newestCommand(rows, new Set(['line.speed', 'line.running']))?.id).toBe('b');
  expect(newestCommand([], new Set(['line.speed']))).toBeUndefined();
});

test('the last command on an equipment knows the type of the tag it touched', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: { motor: 'line.speed', bin: 'line.level' },
    now,
    latest: new Map(),
    // a STOP on the run signal of an equipment whose reading is a setpoint
    commands: [cmd({ id: 's', tag: 'line.running', value: false, updated_at: '2026-11-11T10:00:00Z' })],
    rules: [],
    alarms: [],
    running: false,
    kinds: { 'line.running': 'run', 'line.speed': 'set' },
    runTag: 'line.running',
  });
  expect(rows[0].command?.code).toBe('STOP');
});

test('only the equipment that owns the run signal may claim a line state', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: { motor: 'line.speed', bin: 'line.level' },
    now,
    latest: new Map(),
    commands: [],
    rules: [],
    alarms: [],
    running: true,
    kinds: { 'line.running': 'run', 'line.speed': 'set' },
    runTag: 'line.running',
  });
  expect(rows.find((r) => r.id === 'motor')?.hasRunSignal).toBe(true);
  expect(rows.find((r) => r.id === 'bin')?.hasRunSignal).toBe(false);
});

test('a row without a numeric reading has no reading to show', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: { motor: 'line.speed', bin: 'line.level' },
    now,
    latest: new Map([
      // a boolean is not a number an operator can read off a value panel
      ['line.speed', { v: true, q: 'good' as const, ts: '2026-11-11T10:00:29Z' }],
    ]),
    commands: [],
    rules: [],
    alarms: [],
    running: true,
    kinds: { 'line.running': 'run', 'line.speed': 'set' },
    runTag: 'line.running',
  });
  expect(rows[0]).toMatchObject({ value: true, reading: null });
  expect(rows[1]).toMatchObject({ value: null, reading: null });
});

test('a row with a numeric reading carries it, even when it is zero', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: { motor: 'line.speed', bin: 'line.level' },
    now,
    latest: new Map([['line.speed', { v: 0, q: 'good' as const, ts: '2026-11-11T10:00:29Z' }]]),
    commands: [],
    rules: [],
    alarms: [],
    running: false,
    kinds: { 'line.running': 'run', 'line.speed': 'set' },
    runTag: 'line.running',
  });
  expect(rows[0]).toMatchObject({ value: 0, reading: 0 });
});

test('a stale row never reads as running', () => {
  expect(rowState(true, true)).toBe('stale');
  expect(rowState(false, true)).toBe('running');
  expect(rowState(false, false)).toBe('stopped');
});

test('an open critical alarm outranks a warning; cleared ones are ignored', () => {
  const a = (id: string, severity: string, state: string, tag = 'line.speed'): Alarm =>
    ({ id, tag, rule: 'r', severity, state, ts: '2026-11-11T10:00:00Z' });
  const open = [a('1', 'warning', 'active'), a('2', 'critical', 'rtn_unack'), a('3', 'critical', 'cleared')];
  expect(worstAlarm(open, new Set(['line.speed']))).toBe('critical');
  expect(worstAlarm(open, new Set(['line.level']))).toBeUndefined();
});

test('buildRows keeps the equipment order, its primary tag and its state', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  const latest = new Map([
    ['line.speed', { v: 32, q: 'good' as const, ts: '2026-11-11T10:00:29Z' }],
    ['line.running', { v: true, q: 'good' as const, ts: '2026-11-11T10:00:29Z' }],
    ['line.level', { v: 20, q: 'good' as const, ts: '2026-11-11T09:00:00Z' }],
  ]);
  const rows = buildRows({
    equipment: EQUIPMENT,
    primary: { motor: 'line.speed', bin: 'line.level' },
    now, latest,
    commands: [cmd({ id: 'a', tag: 'line.speed', value: 33, updated_at: '2026-11-11T10:00:00Z' })],
    rules: [rule({ kind: 'hi', threshold: 55 }), rule({ kind: 'lo', threshold: 5 })],
    alarms: [{ id: 9, tag: 'line.level', rule: 'r', severity: 'warning', state: 'active', ts: '2026-11-11T10:00:00Z' }],
    running: true,
    kinds: { 'line.running': 'run', 'line.speed': 'set' },
    runTag: 'line.running',
  });
  expect(rows.map((r) => r.id)).toEqual(['motor', 'bin']);
  expect(rows[0]).toMatchObject({ tag: 'line.speed', value: 32, stale: false, state: 'running' });
  expect(rows[0].limits).toEqual({ lo: 5, hi: 55 });
  expect(rows[0].command?.code).toBe('SET');
  expect(rows[1]).toMatchObject({ tag: 'line.level', stale: true, state: 'stale', alarm: 'warning' });
});

test('the connection pill never says live without a recent reading', () => {
  const now = Date.parse('2026-11-11T10:00:30Z');
  expect(connOf('open', '2026-11-11T10:00:29Z', now).state).toBe('live');
  expect(connOf('open', '2026-11-11T09:00:00Z', now).state).toBe('stale');
  expect(connOf('closed', '2026-11-11T10:00:29Z', now).state).toBe('offline');
  expect(connOf('open', undefined, now).state).toBe('offline');
});

test('the filter matches the visible name or the tag and ignores case', () => {
  expect(matches(['Drive motor', 'plant1.sort.line1.motor1.speed_sp'], 'motor')).toBe(true);
  expect(matches(['Drive motor', 'plant1.sort.line1.motor1.speed_sp'], 'SPEED_SP')).toBe(true);
  expect(matches(['Drive motor', 'plant1.sort.line1.motor1.speed_sp'], 'bin')).toBe(false);
  expect(matches(['Drive motor', 'x'], '')).toBe(true);
});

test('log levels come from severity and a higher level hides the quieter rows', () => {
  expect(levelOf(undefined)).toBe('info');
  expect(levelOf('warning')).toBe('warning');
  expect(levelOf('critical')).toBe('error');
  expect(atLevel('info', 'warning')).toBe(false);
  expect(atLevel('warning', 'warning')).toBe(true);
  expect(atLevel('critical', 'warning')).toBe(true);
});
