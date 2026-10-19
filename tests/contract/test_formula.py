"""Derived-tag formula language (spec 2026-10-19 §7): grammar, evaluation,
windows, limits, and that nothing but arithmetic is reachable."""

import inspect
import math
import re

import pytest

from app.production import formula as F
from app.production.formula import FormulaError, WindowStore, compile_formula, evaluate


def ev(src, **env):
    return evaluate(compile_formula(src), env)


def err(src) -> FormulaError:
    with pytest.raises(FormulaError) as e:
        compile_formula(src)
    return e.value


# ── arithmetic and precedence ────────────────────────────────────────────

@pytest.mark.parametrize("src,env,want", [
    ("a + b * 2", dict(a=3, b=4), 11),
    ("(a + b) * 2", dict(a=3, b=4), 14),
    ("a - b - 1", dict(a=3, b=4), -2),             # left associative
    ("a / b / 2", dict(a=3, b=4), 0.375),
    ("a % 2", dict(a=3), 1),
    ("a ^ 3 ^ 2", dict(a=2), 512),                 # right associative
    ("-a ^ 2", dict(a=3), -9),                     # ^ binds tighter than unary minus
    ("a ^ -1", dict(a=2), 0.5),
    ("-a * b", dict(a=3, b=4), -12),
    ("a - -b", dict(a=3, b=4), 7),
    ("+a", dict(a=3), 3),
    ("a + 1e2 + .5", dict(a=3), 103.5),
    ("a * b + a / b", dict(a=3, b=4), 12.75),
    ("a + 2 * 3 ^ 2", dict(a=1), 19),
    ("a * 2 ^ 3", dict(a=2), 16),
])
def test_arithmetic(src, env, want):
    assert ev(src, **env) == pytest.approx(want)


# ── booleans and conditions ──────────────────────────────────────────────

@pytest.mark.parametrize("src,env,want", [
    ("a > b", dict(a=2, b=1), True),
    ("a >= b", dict(a=1, b=1), True),
    ("a == b", dict(a=1, b=2), False),
    ("a != b", dict(a=1, b=2), True),
    ("a and b", dict(a=1, b=0), False),
    ("a or b", dict(a=0, b=1), True),
    ("not a", dict(a=False), True),
    ("not a and b", dict(a=0, b=1), True),          # (not a) and b
    ("not (a and b)", dict(a=1, b=1), False),
    ("a > 1 and b < 5", dict(a=2, b=3), True),
    ("a or true", dict(a=0), True),
    ("a or b", dict(a=True, b=False), True),
])
def test_boolean_results_are_booleans(src, env, want):
    assert ev(src, **env) is want


def test_ternary():
    assert ev("a > 0 ? a : -a", a=-4) == 4
    assert ev("a > 0 ? 1 : a < -5 ? 2 : 3", a=-9) == 2          # right associative
    assert ev("a ? 10 : 20", a=0) == 20
    assert compile_formula("a > 0 ? true : false").is_bool
    assert not compile_formula("a > 0 ? 1 : 0").is_bool


def test_result_types():
    assert compile_formula("a + b").is_bool is False
    assert compile_formula("a > b").is_bool is True
    assert compile_formula("not a").is_bool is True
    assert ev("a + b", a=True, b=True) == 2.0   # a boolean counts as 1


# ── functions ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("src,env,want", [
    ("abs(a)", dict(a=-3), 3),
    ("min(a, b)", dict(a=1, b=2), 1),
    ("max(a, b)", dict(a=1, b=2), 2),
    ("round(a)", dict(a=2.6), 3),
    ("round(a, 1)", dict(a=2.66), 2.7),
    ("clamp(a, 0, 10)", dict(a=14), 10),
    ("clamp(a, 0, 10)", dict(a=-1), 0),
    ("clamp(a, 0, 10)", dict(a=4), 4),
    ("sqrt(a)", dict(a=9), 3),
    ("log(a)", dict(a=math.e), 1),
    ("exp(a)", dict(a=0), 1),
    ("a * 3.6", dict(a=10), 36),
])
def test_current_value_functions(src, env, want):
    assert ev(src, **env) == pytest.approx(want)


@pytest.mark.parametrize("src,env", [
    ("a / b", dict(a=1, b=0)), ("a % b", dict(a=1, b=0)), ("sqrt(a)", dict(a=-1)),
    ("log(a)", dict(a=0)), ("log(a)", dict(a=-2)), ("a ^ b", dict(a=-8, b=0.5)),
    ("a ^ b", dict(a=0, b=-1)), ("a ^ b", dict(a=10, b=1000)), ("exp(a)", dict(a=1000)),
    ("clamp(a, 5, 1)", dict(a=3)), ("a * b", dict(a=float("inf"), b=1)),
    ("a + b", dict(a=float("nan"), b=1)),
])
def test_non_finite_results_are_none(src, env):
    assert ev(src, **env) is None


# ── windows ──────────────────────────────────────────────────────────────

def run_window(src, series, **extra):
    c = compile_formula(src)
    store = WindowStore(c.windows)
    out = None
    for t, v in series:
        out = evaluate(c, {"a": v, **extra}, store, t)
    return out


RAMP = [(0, 0), (10, 10), (20, 20), (30, 30)]


def test_window_functions_over_a_step_held_series():
    assert run_window("max(a, 1m)", RAMP) == 30
    assert run_window("min(a, 1m)", RAMP) == 0
    assert run_window("delta(a, 1m)", RAMP) == 30
    assert run_window("rate(a, 1m)", RAMP) == pytest.approx(1.0)
    # each value is held until the next sample: 0*10 + 10*10 + 20*10
    assert run_window("integral(a, 1m)", RAMP) == pytest.approx(300)
    assert run_window("avg(a, 1m)", RAMP) == pytest.approx(10.0)


def test_window_forgets_old_samples():
    series = [(t, t) for t in range(0, 200, 5)]
    # 30 s window ending at t=195: the value held since t=165, then 170..195
    assert run_window("min(a, 30s)", series) == 165
    assert run_window("delta(a, 30s)", series) == 30


def test_window_over_an_expression():
    # the editor's own example shape: avg(a - b, 5m) + b
    series = [(t, 10 + t) for t in range(0, 61, 10)]
    # a-b = 5,15,...,55 held 10 s each over 60 s -> avg 30, plus b=5
    assert run_window("avg(a - b, 5m) + b", series, b=5) == pytest.approx(35)


def test_window_buffer_is_bounded():
    c = compile_formula("avg(a, 24h)")
    store = WindowStore(c.windows)
    for i in range(20000):
        evaluate(c, {"a": i % 7}, store, i * 5.0)
    assert len(store.pts[0]) <= WindowStore.MAX_POINTS + 5


def test_window_with_one_sample():
    assert run_window("avg(a, 5m)", [(100, 4.0)]) == 4.0
    assert run_window("rate(a, 5m)", [(100, 4.0)]) == 0.0


def test_two_calls_keep_separate_windows():
    c = compile_formula("max(a, 1m) - min(a, 1m)")
    assert len(c.windows) == 2 and c.max_window_s == 60
    store = WindowStore(c.windows)
    r = None
    for t, v in [(0, 5), (10, 9), (20, 2)]:
        r = evaluate(c, {"a": v}, store, t)
    assert r == 7


def test_windowed_nan_does_not_poison_the_window():
    c = compile_formula("avg(a / b, 1m)")
    store = WindowStore(c.windows)
    assert evaluate(c, {"a": 4, "b": 2}, store, 0) == 2
    assert evaluate(c, {"a": 4, "b": 0}, store, 10) == 2    # the bad sample is skipped
    assert evaluate(c, {"a": 6, "b": 2}, store, 20) is not None


# ── errors ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("src,code", [
    ("", "empty"), ("   ", "empty"),
    ("a +", "unexpected_token"), ("(a", "expected"), ("a b", "unexpected_token"),
    ("a ? b", "expected"), ("5", "no_variable"),
    ("foo(a)", "unknown_function"), ("avg(a)", "window_required"),
    ("sqrt(a, b)", "bad_args"), ("min(a)", "bad_args"), ("avg(a, 5m, 1m)", "bad_args"),
    ("round(a, 5m)", "bad_args"), ("avg(5m, a)", "bad_args"),
    ("a + 5m", "duration_misplaced"), ("5m", "duration_misplaced"),
    ("avg(a, 0s)", "window_range"), ("avg(a, 25h)", "window_range"), ("avg(a, 2d)", "window_range"),
    ("A + 1", "unknown_name"), ("ab", "unknown_name"), ("x1 + a", "unknown_name"),
    ("a $ b", "unexpected_char"), ("a & b", "unexpected_char"),
    ("abs", "expected"),
])
def test_error_codes(src, code):
    assert err(src).code == code


def test_error_positions_point_at_the_problem():
    assert err("a + $").pos == 4
    assert err("a + foo(b)").pos == 4
    assert err("a + 5m").pos == 4
    assert err("a + b c").pos == 6


def test_unbound_variable_names_the_variable():
    c = compile_formula("a + b * c")
    with pytest.raises(FormulaError) as e:
        F.check_variables(c, {"a", "c"})
    assert e.value.code == "unknown_variable" and e.value.detail["name"] == "b"
    assert e.value.pos == 4
    F.check_variables(c, {"a", "b", "c"})


# ── limits ───────────────────────────────────────────────────────────────

def test_length_and_node_limits():
    assert err("a+" * 251 + "a").code == "too_long"
    ok = "+".join(["a"] * 99)           # 99 variables + 98 operators = 197 nodes
    assert compile_formula(ok).nodes <= F.MAX_NODES
    assert err("+".join(["a"] * 120)).code == "too_complex"


def test_deep_nesting_is_rejected_not_a_crash():
    assert err("(" * 300 + "a" + ")" * 300).code == "too_long"
    assert err("(" * 200 + "a" + ")" * 200).code == "too_complex"      # 401 chars: depth guard
    assert err("-" * 400 + "a").code == "too_complex"
    assert ev("-" * 60 + "a", a=1) == 1.0                              # even count: back to +a


# ── nothing but arithmetic is reachable ──────────────────────────────────

@pytest.mark.parametrize("src", [
    "__import__('os').system('x')", "a.real", "a[0]", "(a).__class__", "open('f')",
    "exec(a)", "eval(a)", "lambda: a", "a; b", "a\nb", "a # b", "'x'", '"x"', "a`b", "a@b",
    "import os", "a if b else c", "{a}", "a := 1", "a = 1", "a ** 2", "a // 2", "a ! b",
])
def test_no_escape_hatches(src):
    with pytest.raises(FormulaError):
        compile_formula(src)


def test_module_never_uses_dynamic_execution():
    import ast
    tree = ast.parse(inspect.getsource(F))
    called = {n.func.id for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert not called & {"eval", "exec", "compile", "getattr", "setattr", "globals",
                         "locals", "__import__", "open", "vars"}
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)
                for a in n.names} | {n.module.split(".")[0] for n in ast.walk(tree)
                                      if isinstance(n, ast.ImportFrom) and n.module}
    assert imported <= {"__future__", "math", "re", "dataclasses"}


# ── quality + dependency graph ───────────────────────────────────────────

@pytest.mark.parametrize("qs,want", [
    ([], "good"), (["good", "good"], "good"), (["good", "stale"], "uncertain"),
    (["uncertain"], "uncertain"), (["good", "bad", "stale"], "bad"), (["weird"], "bad"),
])
def test_combine_quality(qs, want):
    assert F.combine_quality(qs) == want


def test_cycle_and_depth_detection():
    g = {"x": {"y"}, "y": {"z"}, "z": set()}
    assert F.find_cycle_or_depth("x", g) is None
    g["z"] = {"x"}
    kind, path = F.find_cycle_or_depth("x", g)
    assert kind == "cycle" and path[0] == path[-1] == "x"
    assert F.find_cycle_or_depth("n", {"n": {"n"}})[0] == "cycle"
    chain = {f"t{i}": {f"t{i + 1}"} for i in range(8)}
    assert F.find_cycle_or_depth("t0", chain)[0] == "depth"
    shallow = {f"t{i}": {f"t{i + 1}"} for i in range(F.MAX_DEPTH)}
    assert F.find_cycle_or_depth("t0", shallow) is None
