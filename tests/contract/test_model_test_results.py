"""Sanitizing boundary for the edge's model_test result (vision/results.py)."""

from __future__ import annotations

import pytest

from app.vision.results import MAX_DETECTIONS, MAX_POLYGON_POINTS, clean_test_result

CLASSES = ["person", "bus"]


def _det(cid=0, score=0.9, bbox=(0.1, 0.1, 0.3, 0.3), poly=None, cls="x"):
    d = {"class_id": cid, "class": cls, "score": score,
         "bbox": list(bbox) if bbox is not None else None}
    if poly is not None:
        d["polygon"] = poly
    return d


def test_result_shape_and_engine():
    out = clean_test_result({"ms": 7.5, "engine": "CPUExecutionProvider",
                             "detections": [_det()]}, CLASSES)
    assert out == {"ms": 7.5, "engine": "CPUExecutionProvider",
                   "detections": [{"class_id": 0, "class": "person", "score": 0.9,
                                   "bbox": [0.1, 0.1, 0.3, 0.3]}]}


def test_untrusted_shapes_never_raise():
    out = clean_test_result({"ms": "x", "engine": {"bad": 1}, "detections": "nope"}, CLASSES)
    assert out == {"ms": 0.0, "engine": None, "detections": []}
    assert clean_test_result(None, CLASSES)["detections"] == []
    assert out["detections"] == []


def test_detections_bounded_and_class_scoped():
    many = [_det() for _ in range(MAX_DETECTIONS + 50)]
    out = clean_test_result({"detections": many}, CLASSES)
    assert len(out["detections"]) == MAX_DETECTIONS
    # class_id out of range / non-int / bool are dropped; server name is never trusted
    bad = [_det(cid=-1), _det(cid=2), _det(cid=True), _det(cid="0")]
    out = clean_test_result({"detections": bad}, CLASSES)
    assert out["detections"] == []
    d = clean_test_result({"detections": [_det(cls="server-sent " + "n" * 200)]}, CLASSES)["detections"][0]
    assert d["class"] == "person"                      # name comes from OUR class list


def test_score_floor_and_clamp():
    dets = [_det(score=0.04), _det(score=0.05), _det(score=1.7), _det(score=float("nan"))]
    out = clean_test_result({"detections": dets}, CLASSES)["detections"]
    assert [d["score"] for d in out] == [0.05, 1.0]    # <0.05 dropped, >1 clamped


def test_bbox_validated_and_clipped():
    bad = [_det(bbox=(0.1, 0.2, 0.3)), _det(bbox=(0.1, 0.2, 0.3, float("inf"))),
           _det(bbox=("a", 0, 0.1, 0.1)), _det(bbox=None)]
    assert clean_test_result({"detections": bad}, CLASSES)["detections"] == []
    d = clean_test_result({"detections": [_det(bbox=(0.8, 0.9, 0.5, 0.5))]}, CLASSES)["detections"][0]
    assert d["bbox"] == [0.8, 0.9, 0.19999999999999996, 0.09999999999999998]  # clipped to image


def test_huge_polygon_sampled_before_validation():
    poly = [[0.0, 0.0]] + [[i / 1e6, (i * 7 % 100) / 100] for i in range(10_000)]
    out = clean_test_result({"detections": [_det(poly=poly)]}, CLASSES)["detections"][0]
    assert len(out["polygon"]) == MAX_POLYGON_POINTS   # sampled to 64, never fully iterated
    # a polygon that degenerates below a triangle is omitted
    d = clean_test_result({"detections": [_det(poly=[[0.1, 0.1], [0.2, 0.2]])]}, CLASSES)["detections"][0]
    assert "polygon" not in d
    d = clean_test_result({"detections": [_det(poly=[[0.1, 0.1], ["x", 0.2], [0.3, 0.3]])]},
                          CLASSES)["detections"][0]
    assert "polygon" not in d


def test_ms_bounded():
    assert clean_test_result({"ms": -1}, CLASSES)["ms"] == 0.0
    assert clean_test_result({"ms": 10 ** 400}, CLASSES)["ms"] == 0.0   # int too big for float()
    assert clean_test_result({"ms": 9e9}, CLASSES)["ms"] == 3_600_000.0
    assert clean_test_result({"ms": float("nan")}, CLASSES)["ms"] == 0.0
