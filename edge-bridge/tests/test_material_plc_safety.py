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

from edge_bridge.adapters.base import WriteResult  # noqa: E402
from test_plc_write_gate import (  # noqa: E402
    GATE_ON, FakeAdapter, FakeBridge, FakeCfg, FakeClock, FakeHolder)
from edge_bridge.vision.rules import RuleEngine  # noqa: E402

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


# -------------------------------------------------- new truck, stale code
def test_new_uncertain_truck_overwrites_previous_code(tmp_path):
    """Truck 1 sand (code 2); truck 2 uncertain -> code cleared to none_value."""
    a = MatAdapter()
    _run(tmp_path, a, [_pkg("sand"), _pkg("gravel", margin=0.1, uncertain=True)])
    assert _code(a) == [2, 0]
    assert _triggers(a) == [True, False]
