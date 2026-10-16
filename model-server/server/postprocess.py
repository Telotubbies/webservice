"""YOLO26 end-to-end output decoding and the untrusted-output guard (roadmap 9.10).

YOLO26 heads are NMS-free: detect output is [1, N, 6] rows `x1, y1, x2, y2, score, class` in letterboxed
input pixels; segment adds `nm` mask coefficients per row plus a prototype tensor [1, nm, H/4, W/4].
"""

from __future__ import annotations

import math

import cv2
import numpy as np

MAX_DETECTIONS = 300
MAX_NAME = 80
MAX_POLYGON = 64
PAD_VALUE = 114


def letterbox(img_bgr, imgsz: int):
    """Resize keeping aspect, centre on a grey square. -> (NCHW float32 0..1, scale, pad_x, pad_y)."""
    h, w = img_bgr.shape[:2]
    r = min(imgsz / h, imgsz / w)
    nh, nw = max(1, round(h * r)), max(1, round(w * r))
    resized = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((imgsz, imgsz, 3), PAD_VALUE, np.uint8)
    px, py = (imgsz - nw) // 2, (imgsz - nh) // 2
    canvas[py:py + nh, px:px + nw] = resized
    tensor = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    return np.ascontiguousarray(tensor), r, px, py


def _norm_box(x1, y1, x2, y2, scale, px, py, ow, oh):
    x1, x2 = (x1 - px) / scale, (x2 - px) / scale
    y1, y2 = (y1 - py) / scale, (y2 - py) / scale
    x1, x2 = min(max(x1 / ow, 0.0), 1.0), min(max(x2 / ow, 0.0), 1.0)
    y1, y2 = min(max(y1 / oh, 0.0), 1.0), min(max(y2 / oh, 0.0), 1.0)
    return [x1, y1, max(x2 - x1, 0.0), max(y2 - y1, 0.0)]


def _keep(row, classes, class_filter, conf):
    score, cid = float(row[4]), row[5]
    if not (math.isfinite(score) and math.isfinite(float(cid))):
        return None
    cid = int(cid)
    if score < conf or not 0 <= cid < len(classes) or (class_filter is not None and cid not in class_filter):
        return None
    return cid, score


def decode_detect(out, scale, px, py, ow, oh, classes, class_filter, conf):
    dets = []
    for row in out[0]:
        k = _keep(row, classes, class_filter, conf)
        if k is None:
            continue
        dets.append({"class_id": k[0], "class": classes[k[0]], "score": k[1],
                     "bbox": _norm_box(row[0], row[1], row[2], row[3], scale, px, py, ow, oh)})
    return clean(dets)


def _polygon(mask_u8, box_in_mask, imgsz, mask_size, scale, px, py, ow, oh):
    x1, y1, x2, y2 = box_in_mask
    region = np.zeros_like(mask_u8)
    region[y1:y2, x1:x2] = mask_u8[y1:y2, x1:x2]
    cs, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    eps = 0.002 * cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, eps, True)
    while len(approx) > MAX_POLYGON:                      # coarsen until it fits the cap
        eps *= 1.5
        approx = cv2.approxPolyDP(c, eps, True)
    k = imgsz / mask_size
    pts = []
    for (mx, my) in approx[:, 0, :]:
        x = ((mx * k) - px) / scale / ow
        y = ((my * k) - py) / scale / oh
        pts.append([min(max(float(x), 0.0), 1.0), min(max(float(y), 0.0), 1.0)])
    return pts if len(pts) >= 3 else None


def decode_segment(out, proto, scale, px, py, ow, oh, imgsz, classes, class_filter, conf):
    nm = proto.shape[1]
    mh, mw = proto.shape[2], proto.shape[3]
    protos = proto[0].reshape(nm, -1)
    dets = []
    for row in out[0]:
        k = _keep(row, classes, class_filter, conf)
        if k is None:
            continue
        coeffs = np.asarray(row[6:6 + nm], np.float32)
        mask = (1.0 / (1.0 + np.exp(-(coeffs @ protos)))).reshape(mh, mw)
        mask_u8 = (mask > 0.5).astype(np.uint8)
        f = mw / imgsz
        bx = [int(max(0, min(mw, round(v * f)))) for v in (row[0], row[1], row[2], row[3])]
        d = {"class_id": k[0], "class": classes[k[0]], "score": k[1],
             "bbox": _norm_box(row[0], row[1], row[2], row[3], scale, px, py, ow, oh)}
        poly = _polygon(mask_u8, bx, imgsz, mw, scale, px, py, ow, oh)
        if poly:
            d["polygon"] = poly
        dets.append(d)
    return clean(dets)


def _finite(v) -> bool:
    return isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, bool) and math.isfinite(v)


def clean(dets: list) -> list:
    """The model output is untrusted: cap, clamp, drop non-finite boxes, truncate strings."""
    out = []
    for d in dets[:MAX_DETECTIONS]:
        try:
            box = d["bbox"]
            if len(box) != 4 or not all(_finite(v) for v in box):
                continue
            score = d["score"]
            score = min(max(float(score), 0.0), 1.0) if _finite(score) else 0.0
            item = {"class_id": int(d["class_id"]), "class": str(d["class"])[:MAX_NAME], "score": score,
                    "bbox": [min(max(float(v), 0.0), 1.0) for v in box]}
            poly = d.get("polygon")
            if poly:
                pts = [[min(max(float(x), 0.0), 1.0), min(max(float(y), 0.0), 1.0)]
                       for x, y in poly[:MAX_POLYGON] if _finite(x) and _finite(y)]
                if len(pts) >= 3:
                    item["polygon"] = pts
            out.append(item)
        except (KeyError, TypeError, ValueError):
            continue
    return out
