// Client-side derived metrics (WP-B). The backend has no expression-tag
// support, so a formula like `a-b` is parsed here and evaluated in the
// browser over already-fetched history — the result is never stored and is
// labelled as such in the UI.
//
// Alignment contract: every referenced series is resampled onto the grid of
// the COARSEST input (median cadence wins; that series' own timestamps are
// the grid — no invented sample times). Finer series are forward-filled
// into a grid slot only when their newest sample at-or-before the slot is
// no older than one grid step; otherwise the operand is null and the row is
// dropped. The output therefore contains finite numbers only — a division
// by zero or a gap in either input produces a missing point, never NaN.

export interface Pt { t: number; v: number }

export type FormulaError = 'empty' | 'char' | 'var' | 'fn' | 'paren' | 'syntax';

export type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; i: number }
  | { k: 'neg'; a: Node }
  | { k: 'op'; op: '+' | '-' | '*' | '/'; l: Node; r: Node }
  | { k: 'fn'; name: 'abs' | 'avg'; args: Node[] };

export type ParseResult =
  | { ok: true; ast: Node; vars: number[]; src: string }
  | { ok: false; err: FormulaError };

const FUNCS = new Set(['abs', 'avg']);

// ------------------------------------------------------------------ parse

export function parseFormula(src: string): ParseResult {
  const text = src.trim().toLowerCase();
  if (!text) return { ok: false, err: 'empty' };
  let i = 0;
  const vars = new Set<number>();

  const peek = () => text[i] as string | undefined;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };

  function expr(): Node | FormulaError {
    let l = term();
    if (typeof l === 'string') return l;
    for (;;) {
      ws();
      const c = peek();
      if (c !== '+' && c !== '-') break;
      i++;
      const r = term();
      if (typeof r === 'string') return r;
      l = { k: 'op', op: c, l, r };
    }
    return l;
  }

  function term(): Node | FormulaError {
    let l = factor();
    if (typeof l === 'string') return l;
    for (;;) {
      ws();
      const c = peek();
      if (c !== '*' && c !== '/') break;
      i++;
      const r = factor();
      if (typeof r === 'string') return r;
      l = { k: 'op', op: c, l, r };
    }
    return l;
  }

  function factor(): Node | FormulaError {
    ws();
    if (peek() === '-') { i++; const a = factor(); return typeof a === 'string' ? a : { k: 'neg', a }; }
    if (peek() === '+') { i++; return factor(); }
    return atom();
  }

  function atom(): Node | FormulaError {
    ws();
    const c = peek();
    if (c === undefined) return 'syntax';
    if (c === '(') {
      i++;
      const e = expr();
      if (typeof e === 'string') return e;
      ws();
      if (peek() !== ')') return 'paren';
      i++;
      return e;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/.exec(text.slice(i));
      if (!m) return 'syntax';
      i += m[0].length;
      return { k: 'num', v: Number(m[0]) };
    }
    if (/[a-z]/.test(c)) {
      const m = /^[a-z]+/.exec(text.slice(i))!;
      const word = m[0];
      i += word.length;
      ws();
      if (peek() === '(') {
        if (!FUNCS.has(word)) return 'fn';
        i++;
        const args: Node[] = [];
        for (;;) {
          const a = expr();
          if (typeof a === 'string') return a;
          args.push(a);
          ws();
          if (peek() === ',') { i++; continue; }
          if (peek() !== ')') return 'paren';
          i++;
          break;
        }
        return { k: 'fn', name: word as 'abs' | 'avg', args };
      }
      if (word.length === 1) {
        const idx = word.charCodeAt(0) - 97;
        vars.add(idx);
        return { k: 'var', i: idx };
      }
      return 'var'; // multi-letter word that isn't a function call
    }
    return 'char';
  }

  const root = expr();
  if (typeof root === 'string') return { ok: false, err: root };
  ws();
  // trailing junk: a letter/number means the expression is half-written
  // ('a b'), anything else is a character the grammar doesn't know ('a%2')
  if (i < text.length) return { ok: false, err: /[a-z0-9.]/.test(text[i]) ? 'syntax' : 'char' };
  return { ok: true, ast: root, vars: [...vars].sort((a, b) => a - b), src: text };
}

// --------------------------------------------------------------- evaluate

/** Median interval between samples (ms) — robust against jitter. */
export function cadenceOf(pts: readonly Pt[]): number {
  if (pts.length < 2) return 1000;
  const steps: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].t - pts[i - 1].t;
    if (d > 0) steps.push(d);
  }
  if (!steps.length) return 1000;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)];
}

export interface FormulaResult {
  /** output points — finite values only, at the coarse grid's timestamps */
  pts: Pt[];
  /** the grid step actually used (ms) */
  step: number;
  /** which input index supplied the grid (-1 when there was no data) */
  gridIndex: number;
  /** grid slots dropped because an operand was missing / non-finite */
  dropped: number;
}

function evalNode(n: Node, cols: ((number | null)[] | null)[], row: number): number | null {
  switch (n.k) {
    case 'num': return n.v;
    case 'var': return cols[n.i]?.[row] ?? null;
    case 'neg': {
      const v = evalNode(n.a, cols, row);
      return v == null ? null : -v;
    }
    case 'op': {
      const l = evalNode(n.l, cols, row);
      const r = evalNode(n.r, cols, row);
      if (l == null || r == null) return null;
      const v = n.op === '+' ? l + r : n.op === '-' ? l - r : n.op === '*' ? l * r : r === 0 ? null : l / r;
      return v != null && Number.isFinite(v) ? v : null;
    }
    case 'fn': {
      if (n.name === 'abs') {
        const v = evalNode(n.args[0], cols, row);
        return v == null ? null : Math.abs(v);
      }
      // avg: mean over the operands that have data — a tag with a hole does
      // not poison the mean, but an all-null row still drops.
      let sum = 0; let n0 = 0;
      for (const a of n.args) {
        const v = evalNode(a, cols, row);
        if (v != null) { sum += v; n0++; }
      }
      return n0 ? sum / n0 : null;
    }
  }
}

/**
 * Evaluate a parsed expression over input series (index = letter: a→0).
 * Series must be sorted by `t`; missing inputs are allowed (their column is
 * all-null, so every row drops — no fabricated data).
 */
export function evalFormula(ast: Node, inputs: (readonly Pt[] | undefined)[]): FormulaResult {
  // the coarsest non-empty input supplies the grid
  let gridIndex = -1;
  let step = 0;
  inputs.forEach((p, i) => {
    if (!p || p.length === 0) return;
    const c = cadenceOf(p);
    if (c > step) { step = c; gridIndex = i; }
  });
  if (gridIndex < 0) return { pts: [], step: 0, gridIndex: -1, dropped: 0 };

  const grid = inputs[gridIndex]!;
  // one aligned column per input: exact for the grid series, forward-fill
  // (max age = one grid step) for the rest
  const cols: (number | null)[][] = inputs.map((p, i) => {
    if (i === gridIndex) return grid.map((s) => s.v);
    const col: (number | null)[] = [];
    if (!p || p.length === 0) return grid.map(() => null);
    let j = 0;
    for (const g of grid) {
      while (j + 1 < p.length && p[j + 1].t <= g.t) j++;
      const last = p[j];
      col.push(last && last.t <= g.t && g.t - last.t <= step ? last.v : null);
    }
    return col;
  });

  const pts: Pt[] = [];
  let dropped = 0;
  for (let row = 0; row < grid.length; row++) {
    const v = evalNode(ast, cols, row);
    if (v == null || !Number.isFinite(v)) { dropped++; continue; }
    pts.push({ t: grid[row].t, v });
  }
  return { pts, step, gridIndex, dropped };
}
