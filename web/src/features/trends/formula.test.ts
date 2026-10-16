// Formula engine tests — written before the implementation (TDD).
// Contract: series referenced by letter (a=0, b=1, …) are aligned to the
// COARSEST input cadence (that series' own timestamps become the grid);
// finer series are forward-filled into grid slots only when a sample exists
// within one grid step. Any point where the expression can't produce a
// finite number is dropped — the output never contains NaN or Infinity.

import { describe, expect, test } from 'bun:test';
import { evalFormula, parseFormula, type Pt } from './formula';

const pts = (vals: [number, number][]): Pt[] => vals.map(([t, v]) => ({ t, v }));
const S = 1000; // 1 s in ms

// a: 1 Hz sine-ish ramp; b: 5 s cadence
const A = pts([[0, 1], [S, 2], [2 * S, 3], [3 * S, 4], [4 * S, 5], [5 * S, 6], [6 * S, 7], [7 * S, 8], [8 * S, 9], [9 * S, 10], [10 * S, 11]]);
const B = pts([[0, 10], [5 * S, 20], [10 * S, 30]]);

function run(src: string, inputs: Pt[][]) {
  const p = parseFormula(src);
  if (!p.ok) throw new Error(`parse failed: ${p.err}`);
  return evalFormula(p.ast, inputs);
}

describe('parseFormula', () => {
  test('accepts the spec grammar: + - * /, constants, abs, avg, parens', () => {
    for (const src of ['a+b', 'a-b', 'a/b', 'a*b', 'a*2', '2*a', 'a+10.5', '(a+b)/2', 'abs(a-60)', 'avg(a,b)', '-a', 'a*-1']) {
      const p = parseFormula(src);
      expect(p.ok, src).toBe(true);
    }
  });

  test('vars reports referenced letters as series indexes', () => {
    const p = parseFormula('(a+c)/2');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.vars).toEqual([0, 2]);
  });

  test('rejects malformed input with a typed error', () => {
    expect(parseFormula('')).toEqual({ ok: false, err: 'empty' });
    expect(parseFormula('   ')).toEqual({ ok: false, err: 'empty' });
    expect(parseFormula('a+')).toEqual({ ok: false, err: 'syntax' });
    expect(parseFormula('a b')).toEqual({ ok: false, err: 'syntax' });
    expect(parseFormula('(a+b')).toEqual({ ok: false, err: 'paren' });
    expect(parseFormula('a%2')).toEqual({ ok: false, err: 'char' });
    expect(parseFormula('sqrt(a)')).toEqual({ ok: false, err: 'fn' });
    expect(parseFormula('avg()').ok).toBe(false);
  });
});

describe('evalFormula — same cadence', () => {
  const C = pts([[0, 2], [S, 4], [2 * S, 6]]);
  const D = pts([[0, 1], [S, 2], [2 * S, 3]]);

  test('a+b adds pointwise', () => {
    expect(run('a+b', [C, D]).pts).toEqual(pts([[0, 3], [S, 6], [2 * S, 9]]));
  });
  test('a-b subtracts', () => {
    expect(run('a-b', [C, D]).pts).toEqual(pts([[0, 1], [S, 2], [2 * S, 3]]));
  });
  test('a*b multiplies', () => {
    expect(run('a*b', [C, D]).pts).toEqual(pts([[0, 2], [S, 8], [2 * S, 18]]));
  });
  test('a/b divides', () => {
    expect(run('a/b', [C, D]).pts).toEqual(pts([[0, 2], [S, 2], [2 * S, 2]]));
  });
  test('constants work: a*2, a-5, (a+b)/2', () => {
    expect(run('a*2', [C]).pts).toEqual(pts([[0, 4], [S, 8], [2 * S, 12]]));
    expect(run('a-5', [C]).pts).toEqual(pts([[0, -3], [S, -1], [2 * S, 1]]));
    expect(run('(a+b)/2', [C, D]).pts).toEqual(pts([[0, 1.5], [S, 3], [2 * S, 4.5]]));
  });
  test('abs and unary minus', () => {
    expect(run('abs(a-5)', [C]).pts).toEqual(pts([[0, 3], [S, 1], [2 * S, 1]]));
    expect(run('-a', [C]).pts).toEqual(pts([[0, -2], [S, -4], [2 * S, -6]]));
  });
  test('avg(a,b) is the pointwise mean', () => {
    expect(run('avg(a,b)', [C, D]).pts).toEqual(pts([[0, 1.5], [S, 3], [2 * S, 4.5]]));
  });
});

describe('evalFormula — mismatched cadence', () => {
  test('resamples to the coarser grid (b is 5 s, a is 1 s)', () => {
    const r = run('a+b', [A, B]);
    expect(r.step).toBe(5 * S);
    expect(r.gridIndex).toBe(1);
    expect(r.pts).toEqual(pts([[0, 11], [5 * S, 26], [10 * S, 41]]));
    expect(r.dropped).toBe(0);
  });

  test('a gap in the fine series longer than one grid step drops the row', () => {
    // a samples at 1 s cadence but is silent between 2 s and 11 s; b is the
    // 5 s grid. At t=5 s the last a sample (2 s) is within one step → kept;
    // at t=10 s it is 8 s old (> 1 step) → row dropped, not carried forward.
    const a2 = pts([[0, 1], [S, 2], [2 * S, 3], [11 * S, 12]]);
    const b2 = pts([[0, 10], [5 * S, 20], [10 * S, 30]]);
    const r = run('a+b', [a2, b2]);
    expect(r.step).toBe(5 * S);
    expect(r.gridIndex).toBe(1);
    expect(r.pts).toEqual(pts([[0, 11], [5 * S, 23]]));
    expect(r.dropped).toBe(1);
  });

  test('fine series starting late produces no leading NaN rows', () => {
    const late = pts([[6 * S, 100], [10 * S, 200]]);
    const r = run('a+b', [A, late]);
    // grid = late's times {6 s,10 s}; a ffills: t=6 → a(6 s)=7; t=10 → a(10 s)=11
    expect(r.pts).toEqual(pts([[6 * S, 107], [10 * S, 211]]));
  });

  test('single-series formulas use its own grid', () => {
    const r = run('a*10', [B]);
    expect(r.step).toBe(5 * S);
    expect(r.pts).toEqual(pts([[0, 100], [5 * S, 200], [10 * S, 300]]));
  });
});

describe('evalFormula — safety', () => {
  test('division by zero drops the point instead of emitting Infinity/NaN', () => {
    const z = pts([[0, 1], [S, 0], [2 * S, 2]]);
    const r = run('a/b', [C_fix, z]);
    expect(r.pts).toEqual(pts([[0, 2], [2 * S, 3]]));
    expect(r.dropped).toBe(1);
  });

  test('a referenced series with no data drops every row', () => {
    const r = run('a+b', [A, []]);
    expect(r.pts).toEqual([]);
    expect(r.dropped).toBe(A.length);
  });

  test('output is always finite — sweep a mixed expression', () => {
    const noisy = pts([[0, -5], [S, 0], [2 * S, 8], [3 * S, -3], [5 * S, 4]]);
    const r = run('avg(a, abs(b/2)) - a/3', [A, noisy]);
    for (const p of r.pts) expect(Number.isFinite(p.v)).toBe(true);
  });

  test('empty input list returns an empty result, not a crash', () => {
    const p = parseFormula('a+1');
    expect(p.ok).toBe(true);
    if (p.ok) {
      const r = evalFormula(p.ast, []);
      expect(r.pts).toEqual([]);
    }
  });
});

// helper fixture referenced above (same-cadence partner for div-by-zero)
const C_fix = pts([[0, 2], [S, 4], [2 * S, 6]]);
