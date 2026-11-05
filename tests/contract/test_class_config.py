"""Per-camera class configuration helpers (plan M1-04 Task 5)."""

import uuid

import pytest

from app.vision.classes import (
    PALETTE,
    carry_over,
    class_diff,
    default_class_config,
    model_sig,
    validate_class_config,
)

CLASSES = ["person", "bicycle", "car"]


def test_default_config_covers_all_classes():
    cfg = default_class_config(CLASSES)
    assert sorted(cfg) == ["0", "1", "2"]
    c = cfg["1"]
    assert c == {"enabled": True, "names": {"en": "bicycle", "th": "bicycle"}, "min_score": 0.25,
                 "colour": PALETTE[1], "alert": False}
    big = default_class_config([f"c{i}" for i in range(80)])
    assert len(big) == 80 and big["12"]["colour"] == PALETTE[0]       # palette cycles


def test_validate_fills_missing_and_accepts_valid():
    out = validate_class_config({"1": {"enabled": False, "min_score": 0.5}}, CLASSES)
    assert out["1"]["enabled"] is False and out["1"]["min_score"] == 0.5
    assert out["0"] == default_class_config(CLASSES)["0"] and out["1"]["names"]["en"] == "bicycle"
    assert out["2"]["colour"] == PALETTE[2]


@pytest.mark.parametrize("bad", [
    {"3": {}},                                    # id out of range
    {"x": {}},                                    # not an id
    {"0": {"min_score": 0.04}}, {"0": {"min_score": 0.96}}, {"0": {"min_score": "high"}},
    {"0": {"colour": "red"}}, {"0": {"colour": "#12345"}},
    {"0": {"enabled": "yes"}}, {"0": {"alert": 1}},
    {"0": {"names": {"en": ""}}}, {"0": {"names": {"en": "x" * 81}}}, {"0": {"names": "x"}},
    {"0": "nope"}, {"0": {"unknown_key": 1}},
])
def test_validate_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_class_config(bad, CLASSES)


def test_class_diff_added_removed_renamed():
    assert class_diff(["a", "b", "c"], ["a", "x", "c", "d"]) == {"added": [3], "removed": [], "renamed": [1]}
    assert class_diff(["a", "b", "c"], ["a"]) == {"added": [], "removed": [1, 2], "renamed": []}
    assert class_diff(["a"], ["a"]) == {"added": [], "removed": [], "renamed": []}


def test_carry_over_keeps_settings_only_for_unchanged_ids():
    old_classes, new_classes = ["a", "b", "c"], ["a", "B", "c", "d"]
    old = validate_class_config({"0": {"min_score": 0.7, "alert": True}, "1": {"min_score": 0.6}}, old_classes)
    new = carry_over(old, old_classes, new_classes)
    assert new["0"]["min_score"] == 0.7 and new["0"]["alert"] is True       # same name: kept
    assert new["1"]["min_score"] == 0.25 and new["1"]["names"]["en"] == "B"  # renamed: reset
    assert sorted(new) == ["0", "1", "2", "3"] and new["3"]["names"]["en"] == "d"


def test_model_sig_bound_to_edge_version_and_hash():
    e, v = uuid.uuid4(), uuid.uuid4()
    s = model_sig(e, v, "a" * 64)
    assert s == model_sig(e, v, "a" * 64)
    assert s not in (model_sig(uuid.uuid4(), v, "a" * 64), model_sig(e, uuid.uuid4(), "a" * 64), model_sig(e, v, "b" * 64))
