"""Concrete-batching-plant sim: auto sequencer, manual hold, derived signals."""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2] / "edge-bridge"
sys.path.insert(0, str(ROOT))

from edge_bridge.adapters import batching_sim as b  # noqa: E402

SITE = "plant1"


def _tag(t: str) -> str:
    return f"{SITE}.batch.{t.replace('/', '.')}"


def _fresh() -> dict:
    spec = yaml.safe_load((ROOT / "tags.yaml").read_text(encoding="utf-8"))["sim"]["tags"]
    return {f"{SITE}.{k}": v["initial"] for k, v in spec.items()}


def _run(values: dict, seconds: float, dt: float = 0.5, seen=None):
    rnd = random.Random(1).uniform
    for _ in range(int(seconds / dt)):
        b.tick(values, _tag, dt, rnd)
        if seen:
            seen(values)


def test_yaml_declares_every_tail_the_sim_reads():
    v = _fresh()
    missing = [t for t in b.tails() if _tag(t) not in v]
    assert not missing


def test_yaml_writable_flags_match_what_the_sim_treats_as_controls():
    spec = yaml.safe_load((ROOT / "tags.yaml").read_text(encoding="utf-8"))["sim"]["tags"]
    for dotted, m in spec.items():
        if not dotted.startswith("batch."):
            continue
        leaf = dotted.rsplit(".", 1)[1]
        is_control = leaf in ("running", "gate_open", "open", "door_open", "enabled")
        assert bool(m["writable"]) == is_control, dotted


def test_auto_cycle_charges_mixes_discharges_and_counts():
    v = _fresh()
    log = {"bins": [], "mixer": False, "door": False, "agg": 0.0, "cem": 0.0, "amps": 0.0}

    def watch(vals):
        opened = tuple(i for i in b.BINS if vals[_tag(f"agg/bin{i}/gate_open")])
        if opened and (not log["bins"] or log["bins"][-1] != opened):
            log["bins"].append(opened)
        log["mixer"] |= bool(vals[_tag("mix/mixer1/running")])
        log["door"] |= bool(vals[_tag("mix/mixer1/door_open")])
        log["agg"] = max(log["agg"], vals[_tag("agg/weigh1/weight_kg")])
        log["cem"] = max(log["cem"], vals[_tag("cem/weigh1/weight_kg")])
        log["amps"] = max(log["amps"], vals[_tag("mix/mixer1/current_a")])

    _run(v, b.CYCLE_S + 1, seen=watch)
    assert log["bins"][:4] == [(1,), (2,), (3,), (4,)]        # one at a time, in order
    assert log["mixer"] and log["door"]
    assert log["agg"] > 0.9 * b.AGG_TARGET_KG
    assert log["cem"] > 0.9 * b.CEM_TARGET_KG
    assert log["amps"] > 60
    assert v[_tag("plant/auto/cycle_count")] == 1


def test_manual_mode_holds_operator_flags():
    v = _fresh()
    v[_tag("plant/auto/enabled")] = False
    v[_tag("mix/mixer1/running")] = True
    v[_tag("agg/bin2/gate_open")] = True
    _run(v, 20)
    assert v[_tag("mix/mixer1/running")] is True
    assert v[_tag("agg/bin2/gate_open")] is True
    assert v[_tag("mix/mixer1/current_a")] > 40            # derived signal follows the flag
    assert v[_tag("agg/bin2/level_pct")] < 64              # open gate drains the bin
    assert v[_tag("agg/bin1/level_pct")] >= 72             # closed bins don't


def test_signals_stay_in_range_over_many_cycles():
    v = _fresh()
    rnd = random.Random(7).uniform
    for _ in range(int(3 * b.CYCLE_S / 0.5)):
        b.tick(v, _tag, 0.5, rnd)
        for t in b.tails():
            x = v[_tag(t)]
            if t.endswith("level_pct"):
                assert 0 <= x <= 100, t
            if t.endswith(("weight_kg", "current_a", "flow_lpm", "speed_mps")):
                assert x >= 0, t


def test_silo_level_switches_follow_level():
    v = _fresh()
    v[_tag("plant/auto/enabled")] = False
    _run(v, 1)
    assert v[_tag("cem/silo3/low_level")] is True           # seeded at 9 %
    assert v[_tag("cem/silo1/low_level")] is False
