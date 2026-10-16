"""Material decision: gate, evidence, rejection, clamping, preprocessing."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from edge_bridge.vision.material import MaterialDecider, parse_cfg, preprocess  # noqa: E402


def det(cls, score=0.9, a=0.2):
    s = a ** 0.5
    return {"class": cls, "score": score, "bbox": [0, 0, s, s],
            "polygon": [[0, 0], [s, 0], [s, s], [0, s]]}


def decider(**over):
    d = MaterialDecider()
    assert d.configure({"enabled": True, "min_frames": 3, **over})
    return d


def visit(d, per_frame, n=8, gap=6):
    out = None
    for _ in range(n):
        d.feed(per_frame)
    for _ in range(gap):
        out = d.feed([]) or out
    return out


def test_gravel_visit_one_decision():
    d = decider()
    ev = visit(d, [det("gravel"), det("sand", 0.3, 0.01)])
    assert ev["decision"] == "gravel" and ev["margin"] > 0.9 and not ev["uncertain"]
    assert d.decisions == 1 and d.state == "empty"


def test_sand_visit():
    ev = visit(decider(), [det("sand")])
    assert ev["decision"] == "sand" and ev["sand_frac"] == 1.0


def test_mixed_is_uncertain():
    ev = visit(decider(), [det("sand", 0.8, 0.1), det("gravel", 0.8, 0.1)])
    assert ev["uncertain"] and ev["margin"] < 0.3


def test_short_flash_is_not_a_truck():
    d = decider(min_frames=5, k_enter=1)
    assert visit(d, [det("sand")], n=2, gap=6) is None and d.dropped == 1


def test_low_confidence_and_small_masks_ignored():
    d = decider(conf=0.5, area_min=0.05)
    assert visit(d, [det("sand", 0.4, 0.3), det("gravel", 0.9, 0.001)]) is None


def test_hysteresis_one_empty_frame_does_not_split():
    d = decider(k_leave=5)
    for _ in range(6):
        d.feed([det("sand")])
    d.feed([])
    for _ in range(4):
        d.feed([det("sand")])
    assert d.decisions == 0 and d.state == "present"


def test_frame_majority_rule():
    ev = visit(decider(rule="frame_majority"), [det("sand", 0.9, 0.05)] * 1 + [det("gravel", 0.4, 0.02)])
    assert ev["rule"] == "frame_majority" and ev["decision"] == "sand"


def test_cfg_clamped_and_safe_defaults():
    c = parse_cfg({"enabled": True, "conf": 9, "k_enter": -4, "dry_run": "false", "rule": "x",
                   "preprocess": {"gamma": 99, "roi": [0, 0, 0.01, 1]}, "outputs": {"code": "a/b/c", "sand_value": 1e9}})
    assert c["conf"] == 0.95 and c["k_enter"] == 1 and c["dry_run"] is True and c["rule"] == "mass_vote"
    assert c["preprocess"]["gamma"] == 2.5 and c["preprocess"]["roi"] is None
    assert c["outputs"]["sand_value"] == 65535 and parse_cfg({"enabled": False}) is None and parse_cfg(None) is None


def test_preprocess_roi_and_noop():
    img = np.full((100, 200, 3), 120, np.uint8)
    pp = parse_cfg({"enabled": True})["preprocess"]
    assert preprocess(img, pp) is img
    pp = parse_cfg({"enabled": True, "preprocess": {"roi": [0.5, 0, 1, 1], "clahe": True, "gamma": 1.5}})["preprocess"]
    out = preprocess(img, pp)
    assert out[:, :90].sum() == 0 and out[:, 110:].sum() > 0
