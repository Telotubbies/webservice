"""F01 — the material decision must fail closed before the PLC trigger.

The PLC latches the data tags (code / margin / uncertain) on the trigger edge,
so a trigger must never go out when:
  - the AI answer is uncertain or there is no material;
  - the `code` write failed or was blocked (the PLC would latch the previous
    truck's code);
  - no `code` tag is configured at all.
"""

from __future__ import annotations

import pytest

pytest.importorskip("numpy")
pytest.importorskip("cv2")

from test_plc_write_gate import (
    GATE_ON,
    FakeAdapter,
    FakeBridge,
    FakeCfg,
    FakeClock,
    FakeHolder,
)

from edge_bridge.adapters.base import WriteResult
from edge_bridge.vision.rules import RuleEngine

CODE, MARGIN, UNC, TRIG = "site.mat.code", "site.mat.margin", "site.mat.unc", "site.mat.trig"


class MatAdapter(FakeAdapter):
    """Material tags writable; writes to `fail_tags` are denied by the PLC."""

    def __init__(self, fail_tags=(), writable=(CODE, MARGIN, UNC, TRIG)):
        super().__init__()
        self._fail_tags = set(fail_tags)
        self._meta.update({t: {"writable": True} for t in writable})

    def write(self, tag, value):
        if tag in self._fail_tags:
            return WriteResult.denied("plc_fault")
        return super().write(tag, value)


def _cam(outputs=None, dry_run=False, min_margin=0.3):
    out = {"code": "mat/code", "margin_pct": "mat/margin", "uncertain": "mat/unc",
           "trigger": "mat/trig", "pulse_ms": 50} if outputs is None else outputs
    return {"id": "c1", "enabled": True, "gate": dict(GATE_ON),
            "model": {"version_id": "mv1", "placement": "edge", "class_config": {}},
            "rules": [],
            "material": {"enabled": True, "dry_run": dry_run, "min_margin": min_margin,
                         "outputs": out}}


def _pkg(decision="sand", margin=0.8, uncertain=False):
    return {"schema": "wds.material.v1", "decision": decision, "margin": margin,
            "uncertain": uncertain}


def _engine(tmp_path, adapter):
    bridge = FakeBridge()
    return RuleEngine(FakeHolder(adapter), bridge, FakeCfg(), str(tmp_path),
                      clock=FakeClock()), bridge


def _run(tmp_path, adapter, pkgs, cam=None):
    e, bridge = _engine(tmp_path, adapter)
    for p in pkgs:
        e.on_material(cam or _cam(), p, None)
        e._pool.shutdown(wait=True)                    # visit fully written before the next
        e._pool = type(e._pool)(max_workers=4)
    e._pool.shutdown(wait=True)
    return e, bridge


def _triggers(adapter):
    return [v for t, v in adapter.writes if t == TRIG]


def _code(adapter):
    return [v for t, v in adapter.writes if t == CODE]


# ------------------------------------------------------------- certain path
def test_certain_decision_writes_code_then_triggers(tmp_path):
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("sand")])
    assert _code(a) == [2]
    assert _triggers(a) == [True, False]               # pulse + reset
    assert a.writes.index((CODE, 2)) < a.writes.index((TRIG, True))


def test_single_worker_pool_still_triggers(tmp_path):
    """The trigger waits on the code write: a 1-worker pool must not deadlock."""
    from concurrent.futures import ThreadPoolExecutor
    a = MatAdapter()
    e = RuleEngine(FakeHolder(a), FakeBridge(), FakeCfg(), str(tmp_path),
                   clock=FakeClock(), executor=ThreadPoolExecutor(max_workers=1))
    e.on_material(_cam(), _pkg("gravel"), None)
    e._pool.shutdown(wait=True)
    assert _code(a) == [1] and _triggers(a) == [True, False]


# ------------------------------------------------------ uncertain / no material
def test_uncertain_decision_never_triggers_and_clears_code(tmp_path):
    a = MatAdapter()
    _e, bridge = _run(tmp_path, a, [_pkg("sand", margin=0.1, uncertain=True)])
    assert _triggers(a) == []
    assert _code(a) == [0]                             # none_value, not the guess
    assert (UNC, True) in a.writes
    outs = bridge.events[-1]["detail"]["outputs"]
    assert all(o["tag_path"] != "mat/trig" for o in outs)


def test_no_material_never_triggers_even_with_zero_min_margin(tmp_path):
    """Boundary: min_margin=0 makes margin 0.0 'certain' — no-material still must not trigger."""
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("no-material", margin=0.0, uncertain=False)],
         cam=_cam(min_margin=0.0))
    assert _triggers(a) == []
    assert _code(a) == [0]


def test_unknown_decision_never_triggers(tmp_path):
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("mud", uncertain=False)])
    assert _triggers(a) == []


def test_uncertain_flag_must_be_strictly_false(tmp_path):
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("gravel", uncertain=None)])
    assert _triggers(a) == []


def test_dry_run_uncertain_lists_no_trigger(tmp_path):
    a = MatAdapter()
    _e, bridge = _run(tmp_path, a, [_pkg("sand", uncertain=True)], cam=_cam(dry_run=True))
    assert a.writes == []
    outs = bridge.events[-1]["detail"]["outputs"]
    assert all(o["tag_path"] != "mat/trig" for o in outs)


# ---------------------------------------------------------- code write fails
def test_code_write_failure_blocks_trigger_on_first_visit(tmp_path):
    """Boundary: the very first visit on a fresh engine, PLC denies the code write."""
    a = MatAdapter(fail_tags={CODE})
    _e, bridge = _run(tmp_path, a, [_pkg("sand")])
    assert _triggers(a) == []
    trig_audit = [r for r in bridge.audits if r["tag_path"] == "mat/trig"]
    assert len(trig_audit) == 1 and trig_audit[0]["status"] == "blocked:code_not_written"


def test_code_write_exception_blocks_trigger(tmp_path):
    class Boom(MatAdapter):
        def write(self, tag, value):
            if tag == CODE:
                raise OSError("link down")
            return super().write(tag, value)

    a = Boom()
    _run(tmp_path, a, [_pkg("gravel")])
    assert _triggers(a) == []


def test_code_blocked_at_gate_blocks_trigger(tmp_path):
    a = MatAdapter(writable=(MARGIN, UNC, TRIG))       # code tag not writable
    _e, bridge = _run(tmp_path, a, [_pkg("sand")])
    assert _triggers(a) == []
    outs = {o["tag_path"]: o for o in bridge.events[-1]["detail"]["outputs"]}
    assert outs["mat/code"]["reason"] == "not_writable"
    assert outs["mat/trig"]["result"] == "blocked"
    assert outs["mat/trig"]["reason"] == "code_not_written"


def test_no_code_tag_configured_never_triggers(tmp_path):
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("sand")],
         cam=_cam(outputs={"trigger": "mat/trig", "pulse_ms": 50}))
    assert _triggers(a) == []


# -------------------------------------------------- new truck, stale code
def test_new_truck_never_latches_previous_truck_code(tmp_path):
    """Truck 1 sand is latched; truck 2's code write fails -> no trigger, so the
    PLC never latches truck 1's code for truck 2."""
    a = MatAdapter()
    e, _bridge = _run(tmp_path, a, [_pkg("sand")])
    assert _triggers(a) == [True, False]
    a._fail_tags = {CODE}
    e._pool = type(e._pool)(max_workers=4)
    e.on_material(_cam(), _pkg("gravel"), None)
    e._pool.shutdown(wait=True)
    assert _triggers(a) == [True, False]               # no second trigger
    assert _code(a) == [2]


def test_new_uncertain_truck_overwrites_previous_code(tmp_path):
    """Truck 1 sand (code 2); truck 2 uncertain -> code cleared to none_value."""
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("sand"), _pkg("gravel", margin=0.1, uncertain=True)])
    assert _code(a) == [2, 0]
    assert _triggers(a) == [True, False]


# ------------------------------------- overlapping visits (no executor drain)
def test_stale_trigger_dropped_when_next_visit_code_write_fails(tmp_path):
    """Truck A's trigger is still in its delay when truck B closes and B's code
    write fails: A's trigger must not latch A's code for B."""
    a = MatAdapter()
    e, bridge = _engine(tmp_path, a)
    e.on_material(_cam(), _pkg("sand"), None)          # A: code ok, trigger pending
    a._fail_tags = {CODE}
    e.on_material(_cam(), _pkg("gravel"), None)        # B: code write denied
    e._pool.shutdown(wait=True)
    assert _triggers(a) == []
    assert any(r["status"] == "blocked:superseded" for r in bridge.audits)


def test_stale_trigger_dropped_when_next_visit_uncertain(tmp_path):
    a = MatAdapter()
    e, _b = _engine(tmp_path, a)
    e.on_material(_cam(), _pkg("sand"), None)
    e.on_material(_cam(), _pkg("sand", margin=0.1, uncertain=True), None)
    e._pool.shutdown(wait=True)
    assert _triggers(a) == []
    assert _code(a)[-1] == 0                           # B's none_value is the last code


def test_slow_code_write_of_old_visit_gets_no_trigger(tmp_path):
    """A's code write is still running when B closes (B's same-tag write is gated
    off as in flight): nobody triggers, so the PLC never latches A's code for B."""
    import threading
    gate = threading.Event()

    class Slow(MatAdapter):
        def write(self, tag, value):
            if tag == CODE and value == 2:
                gate.wait(2)                           # A's code write is slow
            return super().write(tag, value)

    a = Slow()
    e, _b = _engine(tmp_path, a)
    e.on_material(_cam(), _pkg("sand"), None)
    e.on_material(_cam(), _pkg("gravel"), None)
    gate.set()
    e._pool.shutdown(wait=True)
    assert _triggers(a) == []


# ---------------------------------------------------------- adapter swap
def test_trigger_not_sent_through_swapped_adapter(tmp_path):
    a, b = MatAdapter(), MatAdapter()
    holder = FakeHolder(a)

    class Swap(MatAdapter):
        def write(self, tag, value):
            r = super().write(tag, value)
            if tag == CODE:
                holder._a = b                          # live swap after the code write
            return r

    a2 = Swap()
    holder._a = a2
    e = RuleEngine(holder, FakeBridge(), FakeCfg(), str(tmp_path), clock=FakeClock())
    e.on_material(_cam(), _pkg("sand"), None)
    e._pool.shutdown(wait=True)
    assert _code(a2) == [2]
    assert _triggers(a2) == [] and _triggers(b) == []


# ------------------------------------------------------------- faults
def test_pulse_reset_exception_is_not_audited_as_fired(tmp_path):
    class Boom(MatAdapter):
        def write(self, tag, value):
            if tag == TRIG and value is False:
                raise OSError("link down")
            return super().write(tag, value)

    a = Boom()
    _e, bridge = _run(tmp_path, a, [_pkg("sand")])
    st = [r["status"] for r in bridge.audits if r["tag_path"] == "mat/trig"]
    assert st and st[0] != "fired"


def test_code_write_timeout_blocks_trigger(tmp_path, monkeypatch):
    import threading
    import edge_bridge.vision.rules as R
    monkeypatch.setattr(R, "AFTER_WAIT_S", 0.05)
    gate = threading.Event()

    class Hang(MatAdapter):
        def write(self, tag, value):
            if tag == CODE:
                gate.wait(1)
            return super().write(tag, value)

    a = Hang()
    e, bridge = _engine(tmp_path, a)
    e.on_material(_cam(), _pkg("sand"), None)
    e._pool.shutdown(wait=True)
    assert _triggers(a) == []
    assert any(r["status"] == "blocked:code_not_written" for r in bridge.audits)


# ------------------------------------------------ round 2: lock scope
def _blocking_trig(entered, release):
    class B(MatAdapter):
        def write(self, tag, value):
            if tag == TRIG and value is True:
                entered.set()
                release.wait(3)
            return super().write(tag, value)
    return B()


def test_new_visit_cannot_register_between_check_and_trigger_write(tmp_path):
    """While A's trigger edge is being written, B's visit bump must wait."""
    import threading
    entered, release = threading.Event(), threading.Event()
    a = _blocking_trig(entered, release)
    e, _b = _engine(tmp_path, a)
    e.on_material(_cam(), _pkg("sand"), None)
    assert entered.wait(3)
    t = threading.Thread(target=e.on_material, args=(_cam(), _pkg("gravel"), None))
    t.start()
    t.join(0.3)
    blocked = t.is_alive()
    release.set()
    t.join(3)
    e._pool.shutdown(wait=True)
    assert blocked


def test_holder_swap_waits_for_material_write(tmp_path):
    import threading
    from edge_bridge.cfg import AdapterHolder
    entered, release = threading.Event(), threading.Event()
    a, other = _blocking_trig(entered, release), MatAdapter()
    holder = AdapterHolder(a, 1000)
    e = RuleEngine(holder, FakeBridge(), FakeCfg(), str(tmp_path), clock=FakeClock())
    e.on_material(_cam(), _pkg("sand"), None)
    assert entered.wait(3)
    t = threading.Thread(target=holder.swap, args=(other,), kwargs={"close_old": False})
    t.start()
    t.join(0.3)
    blocked = t.is_alive()
    release.set()
    t.join(3)
    e._pool.shutdown(wait=True)
    assert blocked and holder.get() is other


def test_long_pulse_does_not_block_next_visit_and_still_resets(tmp_path):
    import time
    a = MatAdapter()
    e, _b = _engine(tmp_path, a)
    cam = _cam(outputs={"code": "mat/code", "trigger": "mat/trig", "pulse_ms": 1000})
    e.on_material(cam, _pkg("sand"), None)
    t0 = time.monotonic()
    while (TRIG, True) not in a.writes and time.monotonic() - t0 < 3:
        time.sleep(0.01)
    t1 = time.monotonic()
    e.on_material(cam, _pkg("gravel", margin=0.1, uncertain=True), None)
    assert time.monotonic() - t1 < 0.4
    e._pool.shutdown(wait=True)
    assert _triggers(a) == [True, False]               # the old pulse is still reset


def test_pulse_reset_failure_raises_critical_alarm(tmp_path, caplog):
    import logging

    class NoReset(MatAdapter):
        def write(self, tag, value):
            if tag == TRIG and value is False:
                return WriteResult.denied("plc_fault")
            return super().write(tag, value)

    with caplog.at_level(logging.CRITICAL):
        _run(tmp_path, NoReset(), [_pkg("sand")])
    assert any("ALARM" in r.getMessage() and r.levelno == logging.CRITICAL for r in caplog.records)
