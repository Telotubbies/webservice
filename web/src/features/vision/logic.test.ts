import { describe, expect, test } from 'bun:test';
import { classRows, diffSummary, modelFileError, nameCountError, namesFromText, patchClass, scoreOk } from './logic';

describe('modelFileError', () => {
  test('accepts onnx and pt within 500 MB, rejects the rest', () => {
    expect(modelFileError({ name: 'a.onnx', size: 10 })).toBeNull();
    expect(modelFileError({ name: 'WEIGHTS.PT', size: 10 })).toBeNull();
    expect(modelFileError({ name: 'a.engine', size: 10 })).toBe('type');
    expect(modelFileError({ name: 'a.onnx', size: 501 * 1024 * 1024 })).toBe('size');
    expect(modelFileError({ name: 'a.onnx', size: 0 })).toBe('size');
    expect(modelFileError({ name: 'noext', size: 10 })).toBe('type');
  });
});

describe('class names', () => {
  test('one per line, blanks dropped, trimmed', () => {
    expect(namesFromText(' person \n\n car\r\nbus ')).toEqual(['person', 'car', 'bus']);
  });
  test('count must match when the model declares one', () => {
    expect(nameCountError(['a', 'b'], 3)).toEqual({ got: 2, expected: 3 });
    expect(nameCountError(['a', 'b', 'c'], 3)).toBeNull();
    expect(nameCountError(['a'], null)).toBeNull();
    expect(nameCountError([], null)).toEqual({ got: 0, expected: null });
  });
});

describe('class config rows', () => {
  const classes = ['person', 'car'];
  const cfg = {
    '0': { enabled: true, names: { en: 'person', th: 'คน' }, min_score: 0.25, colour: '#e6194b', alert: false },
    '1': { enabled: false, names: { en: 'car', th: 'รถ' }, min_score: 0.5, colour: '#3cb44b', alert: true },
  };
  test('rows follow class ids, in order', () => {
    const rows = classRows(classes, cfg);
    expect(rows.map((r) => r.id)).toEqual(['0', '1']);
    expect(rows[1].enabled).toBe(false);
  });
  test('classes without a config entry are skipped, not half-rendered', () => {
    expect(classRows(classes, {})).toEqual([]);
    expect(classRows(classes, { '1': cfg['1'] }).map((r) => r.id)).toEqual(['1']);
  });
  test('patchClass is immutable and touches one class', () => {
    const next = patchClass(cfg, '1', { enabled: true });
    expect(next['1'].enabled).toBe(true);
    expect(cfg['1'].enabled).toBe(false);
    expect(next['0']).toBe(cfg['0']);
  });
  test('score range matches the backend', () => {
    expect(scoreOk(0.05)).toBe(true);
    expect(scoreOk(0.95)).toBe(true);
    expect(scoreOk(0.04)).toBe(false);
    expect(scoreOk(Number.NaN)).toBe(false);
  });
});

describe('diffSummary', () => {
  test('counts changes, null when nothing changed', () => {
    expect(diffSummary({ added: [3], removed: [], renamed: [1, 2] })).toEqual({ added: 1, removed: 0, renamed: 2 });
    expect(diffSummary({ added: [], removed: [], renamed: [] })).toBeNull();
    expect(diffSummary(null)).toBeNull();
  });
});
