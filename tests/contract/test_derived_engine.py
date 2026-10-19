"""Derived-tag engine without a database: fan-in, throttle, quality, leadership
fallbacks, chaining. The SQL paths are exercised in tests/integration."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.production import derived as D
from app.production.formula import WindowStore, check_variables, compile_formula

ORG, SITE = uuid.uuid4(), uuid.uuid4()
T0 = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)


class Reg:
    def __init__(self, tags):
        self.tags = tags

    def by_id(self, tid):
        return self.tags.get(tid)


class Tag:
    def __init__(self, tid):
        self.id = tid


def make(expr, names="ab"):
    """Engine with one derived tag reading tags named by `names`."""
    ins = {n: uuid.uuid4() for n in names}
    out = uuid.uuid4()
    emitted = []

    async def emit(tag, org, site, v, q, ts):
        emitted.append((tag.id, v, q, ts))

    eng = D.DerivedEngine(None, Reg({out: Tag(out)}), emit)
    c = compile_formula(expr)
    check_variables(c, ins)
    e = D.Entry(out, ORG, SITE, expr, 1, ins, c, WindowStore(c.windows))
    eng.entries[out] = e
    for t in ins.values():
        eng.users.setdefault(t, set()).add(out)

    async def lead():
        return True
    eng._lead = lead
    eng._reload_at = 10 ** 12          # never hit the database in tick()
    return eng, e, ins, out, emitted


def feed(eng, ins, name, v, q="good", ts=T0):
    eng.on_sample(ins[name], v, q, ts)


def test_sample_of_an_unrelated_tag_is_ignored():
    eng, e, ins, out, _ = make("a + b")
    eng.on_sample(uuid.uuid4(), 1, "good", T0)
    assert not eng.dirty and not eng.latest


def test_waits_until_every_input_has_a_value():
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "a", 1)
    assert eng.dirty == {out}
    asyncio.run(eng.tick())
    assert emitted == []                           # b never reported
    feed(eng, ins, "b", 2)
    assert asyncio.run(eng.tick()) == 1
    assert emitted[0][:3] == (out, 3.0, "good")


def test_many_input_samples_cost_one_evaluation_per_tick():
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "b", 1)
    for i in range(500):
        feed(eng, ins, "a", i, ts=T0 + timedelta(milliseconds=i))
    asyncio.run(eng.tick())
    asyncio.run(eng.tick())                        # nothing new: nothing recomputed
    assert len(emitted) == 1 and emitted[0][1] == 499 + 1


def test_late_replay_does_not_replace_a_newer_value():
    eng, e, ins, out, _ = make("a + b")
    feed(eng, ins, "a", 10, ts=T0 + timedelta(seconds=5))
    feed(eng, ins, "a", 1, ts=T0)                  # QoS1 replay of an older sample
    assert eng.latest[ins["a"]][0] == 10


def test_quality_follows_the_worst_input():
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "b", 1)
    for q, want in (("good", "good"), ("uncertain", "uncertain"),
                    ("stale", "uncertain"), ("bad", "bad")):
        feed(eng, ins, "a", 1, q=q)
        asyncio.run(eng.tick())
        assert emitted[-1][2] == want, q


def test_an_input_that_stopped_reporting_makes_the_result_uncertain(monkeypatch):
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "a", 1, ts=T0)
    feed(eng, ins, "b", 1, ts=T0)
    monkeypatch.setattr(D, "utcnow", lambda: T0 + timedelta(seconds=D.STALE_INPUT_S + 1))
    asyncio.run(eng.tick())
    assert emitted[-1][2] == "uncertain"


def test_division_by_zero_is_bad_quality_not_a_number():
    eng, e, ins, out, emitted = make("a / b")
    feed(eng, ins, "a", 1)
    feed(eng, ins, "b", 0)
    asyncio.run(eng.tick())
    assert emitted[-1][2] == "bad"
    feed(eng, ins, "b", 4)
    asyncio.run(eng.tick())
    assert emitted[-1][1:3] == (0.25, "good")


def test_non_numeric_input_value_is_bad():
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "a", "text")
    feed(eng, ins, "b", 1)
    asyncio.run(eng.tick())
    assert emitted[-1][2] == "bad"


def test_boolean_formula_emits_bool_and_booleans_count_as_one():
    eng, e, ins, out, emitted = make("a and b")
    feed(eng, ins, "a", True)
    feed(eng, ins, "b", 1)
    asyncio.run(eng.tick())
    assert emitted[-1][1] is True
    eng2, _, ins2, _, em2 = make("a + b")
    feed(eng2, ins2, "a", True)
    feed(eng2, ins2, "b", True)
    asyncio.run(eng2.tick())
    assert em2[-1][1] == 2.0


def test_quiet_formulas_are_refreshed_so_staleness_can_show():
    eng, e, ins, out, emitted = make("a + b")
    feed(eng, ins, "a", 1)
    feed(eng, ins, "b", 1)
    asyncio.run(eng.tick())
    asyncio.run(eng.tick())
    assert len(emitted) == 1
    e.last_eval -= D.REFRESH_S + 1                 # nothing arrived for a while
    asyncio.run(eng.tick())
    assert len(emitted) == 2


def test_windowed_formula_keeps_state_across_ticks():
    eng, e, ins, out, emitted = make("avg(a, 1m)", names="a")
    for i, v in enumerate((0, 10, 20)):
        feed(eng, ins, "a", v, ts=T0 + timedelta(seconds=10 * i))
        asyncio.run(eng.tick())
    assert len(e.store.pts[0]) >= 1 and emitted[-1][2] == "good"


def test_a_failing_emit_does_not_stop_the_other_tags():
    eng, e, ins, out, emitted = make("a + b")
    other = uuid.uuid4()
    c = compile_formula("a * 2")
    e2 = D.Entry(other, ORG, SITE, "a * 2", 1, {"a": ins["a"]}, c, WindowStore([]))
    eng.entries[other] = e2
    eng.users[ins["a"]].add(other)
    eng.registry.tags[other] = Tag(other)
    calls = []

    async def emit(tag, org, site, v, q, ts):
        calls.append(tag.id)
        if tag.id == out:
            raise RuntimeError("db down")
    eng.emit = emit
    feed(eng, ins, "a", 1)
    feed(eng, ins, "b", 1)
    asyncio.run(eng.tick())
    assert set(calls) == {out, other}


def test_only_the_leader_computes():
    eng, e, ins, out, emitted = make("a + b")

    async def follower():
        return False
    eng._lead = follower
    feed(eng, ins, "a", 1)
    feed(eng, ins, "b", 1)
    assert asyncio.run(eng.tick()) == 0 and emitted == []
    assert eng.dirty == {out}                      # kept for when it takes over


def test_build_skips_invalid_formula_and_keeps_window_state_on_reload():
    eng, e, ins, out, _ = make("avg(a, 1m)", names="a")
    row = {"tag_id": out, "site_id": SITE, "expr": "avg(a, 1m)", "version": 1,
           "inputs": {"a": str(ins["a"])}}
    assert eng._build(ORG, row) is e               # same version: same object, same buffers
    bad = {**row, "expr": "avg(a", "version": 2}
    assert eng._build(ORG, bad) is None
    unbound = {**row, "expr": "a + b", "version": 3}
    assert eng._build(ORG, unbound) is None
    changed = {**row, "expr": "max(a, 2m)", "version": 4}
    assert eng._build(ORG, changed) is not e
