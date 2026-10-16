"""Trust boundary for model-server output returned through the model_test op
(plan M1-05 Task 4; roadmap 9.10: "the output is untrusted — caps on count and
string length, clamped scores, polygons simplified to at most 64 points").

Class names are never taken from the edge: `class_id` indexes into the
version's classes the BACKEND loaded from its own tables.
"""

from __future__ import annotations

import math

MAX_DETECTIONS = 300
MAX_POLYGON_POINTS = 64
MIN_SCORE = 0.05


def _num(v, lo: float, hi: float):
    """Finite non-bool number clamped to [lo, hi], else None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:                     # absurdly large ints
        return None
    if not math.isfinite(f):
        return None
    return max(lo, min(hi, f))


def _clean_detection(d, classes: list) -> dict | None:
    if not isinstance(d, dict):
        return None
    cid = d.get("class_id")
    if isinstance(cid, bool) or not isinstance(cid, int) or not 0 <= cid < len(classes):
        return None
    score = _num(d.get("score"), 0.0, 1.0)
    if score is None or score < MIN_SCORE:
        return None
    bbox = d.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    box = [_num(v, 0.0, 1.0) for v in bbox]
    if any(v is None for v in box):
        return None
    x, y, w, h = box
    w = min(w, 1.0 - x)                                  # extent clipped to the image
    h = min(h, 1.0 - y)
    out = {"class_id": cid, "class": str(classes[cid])[:80], "score": score,
           "bbox": [x, y, w, h]}
    poly = d.get("polygon")
    if isinstance(poly, (list, tuple)) and len(poly) >= 3:
        n = len(poly)
        # index into the original list — never materialize an oversized polygon
        idx = range(n) if n <= MAX_POLYGON_POINTS else (
            int(i * n / MAX_POLYGON_POINTS) for i in range(MAX_POLYGON_POINTS))
        clean = []
        for i in idx:
            p = poly[i]
            if not isinstance(p, (list, tuple)) or len(p) != 2:
                clean = None
                break
            px, py = _num(p[0], 0.0, 1.0), _num(p[1], 0.0, 1.0)
            if px is None or py is None:
                clean = None
                break
            clean.append([px, py])
        if clean and len(clean) >= 3:                    # need at least a triangle
            out["polygon"] = clean
    return out


def clean_test_result(result: dict, classes: list) -> dict:
    """Sanitize the edge's model_test result: {ms, engine, detections}."""
    if not isinstance(result, dict):
        result = {}
    ms = _num(result.get("ms"), 0.0, 3_600_000.0)
    engine = result.get("engine")
    engine = engine[:80] if isinstance(engine, str) else None
    raw_dets = result.get("detections")
    dets = []
    for d in (raw_dets[:MAX_DETECTIONS] if isinstance(raw_dets, list) else []):
        c = _clean_detection(d, classes)
        if c is not None:
            dets.append(c)
    return {"ms": ms if ms is not None else 0.0, "engine": engine, "detections": dets}
