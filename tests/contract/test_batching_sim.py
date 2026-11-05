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
        is_control = leaf in ("running", "gate_open", "open", "door_open", "enabled")             or ".recipe." in dotted
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


def _cycle_log(v, watch_tags, seconds=None):
    seen = {t: [] for t in watch_tags}
    _run(v, seconds or b.CYCLE_S + 1, seen=lambda vals: [seen[t].append(vals[_tag(t)]) for t in watch_tags])
    return seen


def test_feeder_belts_run_while_their_bins_discharge():
    v = _fresh()
    log = _cycle_log(v, ["agg/belt3/running", "agg/belt5/running", "agg/belt4/running", "agg/bin1/gate_open"])
    assert any(log["agg/belt3/running"]) and any(log["agg/belt5/running"])
    # the collector belt runs whenever a feeder runs
    for b3, b4 in zip(log["agg/belt3/running"], log["agg/belt4/running"]):
        assert b4 or not b3


def test_skip_hoist_lifts_the_aggregate_into_the_mixer_and_returns():
    v = _fresh()
    log = _cycle_log(v, ["agg/skip1/position_pct", "agg/skip1/moving"])
    assert max(log["agg/skip1/position_pct"]) > 95
    assert log["agg/skip1/position_pct"][-1] < 5
    assert any(log["agg/skip1/moving"])


def test_a_truck_waits_under_the_mixer_for_the_discharge():
    v = _fresh()
    log = _cycle_log(v, ["mix/truck/present", "mix/mixer1/door_open"])
    for present, door in zip(log["mix/truck/present"], log["mix/mixer1/door_open"]):
        assert present or not door
    assert v[_tag("mix/truck/count")] == 1


def test_each_batch_adds_to_the_production_total():
    v = _fresh()
    _run(v, 2 * b.CYCLE_S + 1)
    assert v[_tag("plant/production/m3_total")] == pytest.approx(2 * b.BATCH_M3)
    assert v[_tag("plant/production/rate_m3h")] > 0


def test_a_low_silo_is_refilled_through_the_fill_pipe_with_the_blower():
    v = _fresh()
    v[_tag("cem/silo3/level_pct")] = 5.0
    log = _cycle_log(v, ["cem/silo3/filling", "air/fill1/flowing", "air/blower1/running"], seconds=30)
    assert any(log["cem/silo3/filling"])
    for f, flow, blower in zip(log["cem/silo3/filling"], log["air/fill1/flowing"], log["air/blower1/running"]):
        assert not f or (flow and blower)
    assert v[_tag("cem/silo3/level_pct")] > 20


def test_cement_is_drawn_from_the_silos_in_turn():
    v = _fresh()
    used = set()
    _run(v, 4 * b.CYCLE_S, seen=lambda vals: used.update(i for i in b.SILOS if vals[_tag(f"cem/screw{i}/running")]))
    assert used == set(b.SILOS)


def test_recipe_targets_drive_the_weighers():
    v = _fresh()
    v[_tag("plant/recipe/cem_target_kg")] = 200.0
    peak = {"cem": 0.0}
    _run(v, b.CYCLE_S, seen=lambda vals: peak.__setitem__("cem", max(peak["cem"], vals[_tag("cem/weigh1/weight_kg")])))
    assert 180 < peak["cem"] < 225


def test_weigher_levels_follow_their_weights():
    v = _fresh()
    peak = {"lvl": 0.0}
    _run(v, b.CYCLE_S, seen=lambda vals: peak.__setitem__("lvl", max(peak["lvl"], vals[_tag("cem/weigh1/level_pct")])))
    assert peak["lvl"] > 80
