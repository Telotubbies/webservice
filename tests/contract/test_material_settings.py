"""Operator-facing material settings: bounded, safe by default, stat block sanitised."""
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.vision.material import MaterialCfg, clean_material_stat, schema  # noqa: E402


def test_defaults_are_safe():
    c = MaterialCfg()
    assert c.dry_run is True and c.rule == "mass_vote" and c.min_frames >= 10 and c.outputs.code is None


@pytest.mark.parametrize("bad", [
    {"conf": 0.0}, {"conf": 1.5}, {"k_enter": 0}, {"k_leave": 9999}, {"min_margin": 2}, {"area_min": -1},
    {"rule": "magic"}, {"gravel_class": "x", "sand_class": "x"},
    {"preprocess": {"gamma": 9}}, {"preprocess": {"roi": [0, 0, 0.01, 1]}}, {"preprocess": {"roi": [0, 0, 1]}},
    {"outputs": {"code": "../etc/passwd"}}, {"outputs": {"code": "Upper/Case/x"}}, {"outputs": {"pulse_ms": 5}},
])
def test_out_of_range_or_malformed_is_refused(bad):
    with pytest.raises(ValidationError):
        MaterialCfg(**bad)


def test_schema_exposes_ranges_for_the_form():
    s = schema()
    assert s["ranges"]["conf"] == {"min": 0.05, "max": 0.95} and s["defaults"]["k_enter"] == 3
    assert s["ranges"]["preprocess.gamma"]["max"] == 2.5


def test_stat_block_is_bounded():
    ok = clean_material_stat({"gate": "present", "sand_frac": 0.4, "coverage": 0.1, "frames": 5,
                              "last": {"decision": "sand", "margin": 0.8, "uncertain": False}})
    assert ok["gate"] == "present" and ok["last"]["decision"] == "sand"
    bad = clean_material_stat({"gate": "<script>", "sand_frac": 7, "frames": -1, "last": {"decision": "rm -rf"}})
    assert bad is None
    assert clean_material_stat("x") is None
