"""Formula language for derived tags (spec 2026-10-19 §7).

Parsed by hand — a lexer and a Pratt parser build an AST of tuples that a small
evaluator walks. Nothing here ever reaches `eval`/`exec`/`compile`, imports or
attribute access, so a formula can only do arithmetic on the variables it was
given. Limits keep a hostile or careless formula cheap: 500 characters, 200 AST
nodes, windows of 1 s to 24 h.

Language
  variables      a..z (bound to tags by the caller), numbers, true / false
  operators      + - * / %   ^   < <= > >= == !=   and or not   cond ? x : y
  current value  abs(x) min(x,y) max(x,y) round(x[,n]) clamp(x,lo,hi) sqrt log exp
  over a window  avg(x, 5m) min(x, 1h) max(x, 1h) delta(x, 1m) rate(x, 1m)
                 integral(x, 1h)        durations: 30s 5m 1h 1d (1 s .. 24 h)

A boolean counts as 1/0 in arithmetic. A result that is not a finite number is
reported as `None` — the engine turns that into quality `bad` instead of a
made-up value.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

MAX_LEN = 500
MAX_NODES = 200
MAX_NEST = 100            # parser recursion guard (nested parentheses / unary signs)
MIN_WINDOW_S = 1
MAX_WINDOW_S = 24 * 3600
MAX_VARS = 26

_UNIT_S = {"s": 1, "m": 60, "h": 3600, "d": 86400}
_TOKEN = re.compile(
    r"\s*(?:"
    r"(?P<dur>\d+(?:\.\d+)?[smhd])(?![A-Za-z0-9_])"
    r"|(?P<num>(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)"
    r"|(?P<id>[A-Za-z_][A-Za-z0-9_]*)"
    r"|(?P<op><=|>=|==|!=|[-+*/%^<>?:(),])"
    r")")

_CURRENT_FUNCS = {  # name -> (min args, max args)
    "abs": (1, 1), "min": (2, 2), "max": (2, 2), "round": (1, 2),
    "clamp": (3, 3), "sqrt": (1, 1), "log": (1, 1), "exp": (1, 1),
}
_WINDOW_FUNCS = {"avg", "min", "max", "delta", "rate", "integral"}
_BOOL_OPS = {"<", "<=", ">", ">=", "==", "!=", "and", "or"}


class FormulaError(ValueError):
    """Syntax/semantic problem; `pos` is the 0-based offset into the formula
    and `code` a stable key the web layer translates."""

    def __init__(self, code: str, pos: int, **detail):
        super().__init__(code)
        self.code, self.pos, self.detail = code, pos, detail

    def as_dict(self) -> dict:
        return {"code": self.code, "pos": self.pos, **self.detail}


@dataclass(frozen=True)
class Window:
    """One windowed call site. `key` is its index in `Compiled.windows`."""
    key: int
    func: str
    seconds: float


@dataclass
class Compiled:
    ast: tuple
    variables: frozenset          # variable names the formula uses
    windows: list                 # [Window], in call-site order
    is_bool: bool                 # result type: boolean (0/1) or number
    nodes: int = 0
    max_window_s: float = 0.0
    _src: str = field(default="", repr=False)


# ── lexer ────────────────────────────────────────────────────────────────

def _lex(src: str) -> list[tuple[str, str, int]]:
    out: list[tuple[str, str, int]] = []
    i = 0
    while i < len(src):
        if src[i:].strip() == "":
            break
        m = _TOKEN.match(src, i)
        if m is None:
            raise FormulaError("unexpected_char", i + len(src[i:]) - len(src[i:].lstrip()))
        kind = m.lastgroup
        text = m.group(kind)
        out.append((kind, text, m.start(kind)))
        i = m.end()
    out.append(("end", "", len(src)))
    return out


# ── parser (Pratt) ───────────────────────────────────────────────────────

# binding powers, low -> high
_BP = {"?": 10, "or": 20, "and": 30,
       "<": 50, "<=": 50, ">": 50, ">=": 50, "==": 50, "!=": 50,
       "+": 60, "-": 60, "*": 70, "/": 70, "%": 70, "^": 90}
_NOT_BP = 40
_NEG_BP = 80   # unary minus binds tighter than * but looser than ^: -a^2 = -(a^2)


class _Parser:
    def __init__(self, toks):
        self.toks, self.i, self.nodes, self.depth = toks, 0, 0, 0

    def peek(self):
        return self.toks[self.i]

    def next(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def expect(self, text: str):
        t = self.next()
        if t[1] != text:
            raise FormulaError("expected", t[2], want=text)
        return t

    def node(self, n: tuple) -> tuple:
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise FormulaError("too_complex", self.toks[min(self.i, len(self.toks) - 1)][2])
        return n

    def parse(self, rbp: int = 0):
        self.depth += 1
        if self.depth > MAX_NEST:
            raise FormulaError("too_complex", self.peek()[2])
        try:
            return self._parse(rbp)
        finally:
            self.depth -= 1

    def _parse(self, rbp: int):
        kind, text, pos = self.next()
        left = self.nud(kind, text, pos)
        while True:
            kind, text, pos = self.peek()
            op = text if (kind == "op" or (kind == "id" and text in ("and", "or"))) else None
            if op not in _BP or _BP[op] <= rbp:
                break
            self.next()
            if op == "?":
                a = self.parse(0)
                self.expect(":")
                b = self.parse(_BP["?"] - 1)   # right associative
                left = self.node(("tern", left, a, b, pos))
            elif op == "^":
                left = self.node(("bin", "^", left, self.parse(_BP["^"] - 1), pos))
            else:
                left = self.node(("bin", op, left, self.parse(_BP[op]), pos))
        return left

    def nud(self, kind, text, pos):
        if kind == "num":
            return self.node(("num", float(text)))
        if kind == "dur":
            raise FormulaError("duration_misplaced", pos)
        if kind == "id":
            if text in ("true", "false"):
                return self.node(("bool", text == "true"))
            if text == "not":
                return self.node(("not", self.parse(_NOT_BP), pos))
            if self.peek()[1] == "(":
                return self.call(text, pos)
            if re.fullmatch(r"[a-z]", text):
                return self.node(("var", text, pos))
            if text in _CURRENT_FUNCS or text in _WINDOW_FUNCS:
                raise FormulaError("expected", self.peek()[2], want="(")
            raise FormulaError("unknown_name", pos, name=text)
        if kind == "op":
            if text == "-":
                return self.node(("neg", self.parse(_NEG_BP), pos))
            if text == "+":
                return self.parse(_NEG_BP)
            if text == "(":
                e = self.parse(0)
                self.expect(")")
                return e
        raise FormulaError("unexpected_token", pos, token=text or "end")

    def call(self, name: str, pos: int):
        self.expect("(")
        args: list = []
        if self.peek()[1] != ")":
            while True:
                if self.peek()[0] == "dur":
                    _, text, dpos = self.next()
                    secs = float(text[:-1]) * _UNIT_S[text[-1]]
                    if not (MIN_WINDOW_S <= secs <= MAX_WINDOW_S):
                        raise FormulaError("window_range", dpos)
                    args.append(self.node(("dur", secs, dpos)))
                else:
                    args.append(self.parse(0))
                if self.peek()[1] == ",":
                    self.next()
                    continue
                break
        self.expect(")")
        if any(a[0] == "dur" for a in args[:-1]):
            raise FormulaError("bad_args", pos, name=name)   # a duration is always last
        windowed = bool(args) and args[-1][0] == "dur"
        if windowed:
            if name not in _WINDOW_FUNCS or len(args) != 2 or args[0][0] == "dur":
                raise FormulaError("bad_args", pos, name=name)
            return self.node(("win", name, args[0], args[1][1], pos))
        if name in _WINDOW_FUNCS and name not in _CURRENT_FUNCS:
            raise FormulaError("window_required", pos, name=name)
        if name not in _CURRENT_FUNCS:
            raise FormulaError("unknown_function", pos, name=name)
        lo, hi = _CURRENT_FUNCS[name]
        if not lo <= len(args) <= hi or any(a[0] == "dur" for a in args):
            raise FormulaError("bad_args", pos, name=name)
        return self.node(("call", name, tuple(args), pos))


def _is_bool(n: tuple) -> bool:
    k = n[0]
    if k == "bool" or k == "not":
        return True
    if k == "bin":
        return n[1] in _BOOL_OPS
    if k == "tern":
        return _is_bool(n[2]) and _is_bool(n[3])
    return False


def _number_windows(n, out: list) -> tuple:
    """Rewrite ("win", ...) nodes to carry their index in `out`."""
    k = n[0]
    if k == "win":
        inner = _number_windows(n[2], out)
        w = Window(len(out), n[1], n[3])
        out.append(w)
        return ("win", w.key, w.func, inner, w.seconds, n[4])
    if k == "bin":
        return ("bin", n[1], _number_windows(n[2], out), _number_windows(n[3], out), n[4])
    if k == "tern":
        return ("tern", _number_windows(n[1], out), _number_windows(n[2], out),
                _number_windows(n[3], out), n[4])
    if k in ("neg", "not"):
        return (k, _number_windows(n[1], out), n[2])
    if k == "call":
        return ("call", n[1], tuple(_number_windows(a, out) for a in n[2]), n[3])
    return n


def _vars(n, out: set) -> None:
    k = n[0]
    if k == "var":
        out.add(n[1])
    elif k == "bin":
        _vars(n[2], out); _vars(n[3], out)
    elif k == "tern":
        for c in n[1:4]:
            _vars(c, out)
    elif k in ("neg", "not"):
        _vars(n[1], out)
    elif k == "call":
        for a in n[2]:
            _vars(a, out)
    elif k == "win":
        _vars(n[3], out)


def compile_formula(src: str) -> Compiled:
    """Parse `src` or raise FormulaError. Variables are not bound here."""
    if not isinstance(src, str) or not src.strip():
        raise FormulaError("empty", 0)
    if len(src) > MAX_LEN:
        raise FormulaError("too_long", MAX_LEN)
    p = _Parser(_lex(src))
    ast = p.parse(0)
    kind, text, pos = p.peek()
    if kind != "end":
        raise FormulaError("unexpected_token", pos, token=text)
    windows: list[Window] = []
    ast = _number_windows(ast, windows)
    used: set = set()
    _vars(ast, used)
    if not used:
        raise FormulaError("no_variable", 0)
    return Compiled(ast=ast, variables=frozenset(used), windows=windows,
                    is_bool=_is_bool(ast), nodes=p.nodes,
                    max_window_s=max((w.seconds for w in windows), default=0.0), _src=src)


def check_variables(c: Compiled, bound) -> None:
    """Every variable used must be bound (raise with the first unbound one)."""
    for name in sorted(c.variables):
        if name not in bound:
            raise FormulaError("unknown_variable", _find_var(c.ast, name), name=name)


def _find_var(n, name: str) -> int:
    k = n[0]
    if k == "var" and n[1] == name:
        return n[2]
    kids = {"bin": (n[2], n[3]) if k == "bin" else (), "tern": n[1:4] if k == "tern" else (),
            "neg": (n[1],), "not": (n[1],), "call": n[2] if k == "call" else (),
            "win": (n[3],) if k == "win" else ()}.get(k, ())
    for c in kids:
        r = _find_var(c, name)
        if r >= 0:
            return r
    return -1


# ── evaluation ───────────────────────────────────────────────────────────

class WindowStore:
    """Samples of the expression inside each windowed call, held in memory.

    Each evaluation pushes (t, value) per call site; a window function reads
    the step-held series over [t - seconds, t]. Spacing is thinned to
    window/MAX_POINTS so a 24 h window stays bounded.
    """
    MAX_POINTS = 2000

    def __init__(self, windows: list):
        self.win = windows
        self.pts: list[list] = [[] for _ in windows]

    def push(self, key: int, t: float, v: float) -> None:
        pts = self.pts[key]
        secs = self.win[key].seconds
        if pts and t - pts[-1][0] < max(0.5, secs / self.MAX_POINTS):
            pts[-1] = (pts[-1][0], v)  # same slot: keep the newest value
        else:
            pts.append((t, v))
        cut = t - secs
        i = 0
        while i + 1 < len(pts) and pts[i + 1][0] <= cut:
            i += 1                      # keep one sample at/before the window start
        if i:
            del pts[:i]

    def read(self, key: int, func: str, t: float) -> float | None:
        pts = self.pts[key]
        if not pts:
            return None
        secs = self.win[key].seconds
        lo = t - secs
        # step-held series clipped to [lo, t]
        seg: list[tuple[float, float]] = []
        for j, (ts, v) in enumerate(pts):
            if ts <= lo:
                seg = [(lo, v)]
            elif ts <= t:
                seg.append((ts, v))
        if not seg:
            seg = [(max(lo, pts[0][0]), pts[0][1])]
        vals = [v for _, v in seg]
        if func == "min":
            return min(vals)
        if func == "max":
            return max(vals)
        span = t - seg[0][0]
        if func == "delta":
            return vals[-1] - vals[0]
        if func == "rate":
            return (vals[-1] - vals[0]) / span if span > 0 else 0.0
        area = 0.0
        for (t0, v0), (t1, _) in zip(seg, seg[1:] + [(t, 0.0)]):
            area += v0 * max(0.0, t1 - t0)
        if func == "integral":
            return area
        return area / span if span > 0 else vals[-1]   # avg


def _num(x) -> float:
    return float(x)


def _eval(n, env: dict, store: WindowStore | None, t: float):
    k = n[0]
    if k == "num":
        return n[1]
    if k == "bool":
        return 1.0 if n[1] else 0.0
    if k == "var":
        return env[n[1]]
    if k == "neg":
        return -_eval(n[1], env, store, t)
    if k == "not":
        return 0.0 if _eval(n[1], env, store, t) else 1.0
    if k == "bin":
        op = n[1]
        if op == "and":
            return 1.0 if (_eval(n[2], env, store, t) and _eval(n[3], env, store, t)) else 0.0
        if op == "or":
            return 1.0 if (_eval(n[2], env, store, t) or _eval(n[3], env, store, t)) else 0.0
        a, b = _eval(n[2], env, store, t), _eval(n[3], env, store, t)
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/": return a / b if b != 0 else math.nan
        if op == "%": return math.fmod(a, b) if b != 0 else math.nan
        if op == "^": return _pow(a, b)
        if op == "<": return 1.0 if a < b else 0.0
        if op == "<=": return 1.0 if a <= b else 0.0
        if op == ">": return 1.0 if a > b else 0.0
        if op == ">=": return 1.0 if a >= b else 0.0
        if op == "==": return 1.0 if a == b else 0.0
        if op == "!=": return 1.0 if a != b else 0.0
    if k == "tern":
        return _eval(n[2] if _eval(n[1], env, store, t) else n[3], env, store, t)
    if k == "call":
        return _call(n[1], [_eval(a, env, store, t) for a in n[2]])
    if k == "win":
        inner = _eval(n[3], env, store, t)
        if store is None:
            return inner
        if math.isfinite(inner):
            store.push(n[1], t, inner)
        r = store.read(n[1], n[2], t)
        return math.nan if r is None else r
    raise AssertionError(f"unknown node {k}")


def _pow(a: float, b: float) -> float:
    try:
        r = a ** b
    except (OverflowError, ZeroDivisionError):
        return math.nan
    return r if isinstance(r, float) else math.nan   # negative ** fraction -> complex


def _call(name: str, a: list):
    try:
        if name == "abs": return abs(a[0])
        if name == "min": return min(a[0], a[1])
        if name == "max": return max(a[0], a[1])
        if name == "round":
            nd = int(a[1]) if len(a) > 1 else 0
            return float(round(a[0], max(-9, min(9, nd))))
        if name == "clamp": return max(a[1], min(a[2], a[0])) if a[1] <= a[2] else math.nan
        if name == "sqrt": return math.sqrt(a[0]) if a[0] >= 0 else math.nan
        if name == "log": return math.log(a[0]) if a[0] > 0 else math.nan
        if name == "exp": return math.exp(a[0])
    except (OverflowError, ValueError):
        return math.nan
    raise AssertionError(name)


def evaluate(c: Compiled, env: dict, store: WindowStore | None = None,
             t: float = 0.0) -> float | bool | None:
    """Value of the formula for `env` (variable -> number/bool), or None when
    it is not a finite number (division by zero, sqrt of a negative, ...)."""
    r = _eval(c.ast, {k: _num(v) for k, v in env.items()}, store, t)
    if not isinstance(r, float) or not math.isfinite(r):
        return None
    return bool(r) if c.is_bool else r


# ── quality ──────────────────────────────────────────────────────────────

_RANK = {"good": 0, "uncertain": 1, "stale": 1, "bad": 2}


def combine_quality(qs) -> str:
    """good only when every input is good; a stale/uncertain input makes the
    result uncertain; a bad input makes it bad."""
    worst = max((_RANK.get(q, 2) for q in qs), default=0)
    return "good" if worst == 0 else "uncertain" if worst == 1 else "bad"


# ── dependency graph ─────────────────────────────────────────────────────

MAX_DEPTH = 5


def find_cycle_or_depth(start: str, inputs_of: dict[str, set]) -> tuple[str, list[str]] | None:
    """`inputs_of` maps a derived tag id to the ids of the tags it reads
    (including the one being saved). Returns ("cycle"|"depth", path) or None."""
    def walk(node: str, path: list[str]):
        if node in path:
            return ("cycle", path[path.index(node):] + [node])
        if len(path) > MAX_DEPTH:
            return ("depth", path + [node])
        for child in inputs_of.get(node, ()):
            r = walk(child, path + [node])
            if r:
                return r
        return None
    return walk(start, [])
