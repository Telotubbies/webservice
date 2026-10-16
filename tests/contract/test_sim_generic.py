"""Generic sim behaviours for tags made by the plant-model editor."""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "edge-bridge"
sys.path.insert(0, str(ROOT))

from edge_bridge.adapters import make_source_adapter  # noqa: E402

SITE = "plant1"


def _adapter():
    tags = [
        {"path": "auto/pump/running", "writable": True, "address": {"behavior": "state", "initial": False}},
        {"path": "auto/pump/flow_lpm", "address": {"behavior": "follow", "initial": 0, "follows": "auto/pump/running",
                                                    "gain": 120.0, "lag": 0.5}},
        {"path": "auto/pump/fault", "address": {"behavior": "follow", "initial": False, "follows": "auto/pump/running",
                                                 "invert": True}},
        {"path": "auto/car/position_pct", "address": {"behavior": "cycle", "initial": 0, "period": 4, "lo": 0, "hi": 100}},
    ]
    return make_source_adapter({"protocol": "sim", "tags": tags}, SITE)


def _read(a):
    return {t.name: t.v for t in a.read_all()}


def _run(a, seconds, step=0.25):
    for _ in range(int(seconds / step)):
        a._last_tick = time.monotonic() - step   # drive the clock deterministically
        a.read_all()


def test_follow_tracks_the_source_flag():
    a = _adapter()
    assert _read(a)[f"{SITE}.auto.pump.flow_lpm"] < 1
    assert a.write(f"{SITE}.auto.pump.running", True).ok
    _run(a, 8)
    v = _read(a)
    assert v[f"{SITE}.auto.pump.flow_lpm"] > 100
    assert v[f"{SITE}.auto.pump.fault"] is False          # inverted bool follows "not running"... off while running
    a.write(f"{SITE}.auto.pump.running", False)
    _run(a, 8)
    v = _read(a)
    assert v[f"{SITE}.auto.pump.flow_lpm"] < 10
    assert v[f"{SITE}.auto.pump.fault"] is True


def test_cycle_stays_in_range_and_moves():
    a = _adapter()
    seen = set()
    for _ in range(40):
        a._last_tick = time.monotonic() - 0.25
        v = _read(a)[f"{SITE}.auto.car.position_pct"]
        assert 0 <= v <= 100
        seen.add(round(v))
        time.sleep(0.02)
    assert len(seen) > 1


def test_derived_tags_reject_writes():
    a = _adapter()
    assert not a.write(f"{SITE}.auto.pump.flow_lpm", 5).ok
