"""Draw detections onto a frame: box or mask polygon, class colour, English label.

Labels are English because OpenCV's built-in fonts cannot render Thai; the console draws localized
names itself from the detection metadata in later plans.
"""

from __future__ import annotations

import cv2
import numpy as np


def _bgr(hex_colour: str) -> tuple[int, int, int]:
    h = (hex_colour or "#ffffff").lstrip("#")
    try:
        return int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)
    except ValueError:
        return 255, 255, 255


def draw_overlay(frame, dets: list[dict], class_config: dict):
    """A new frame; the input is not modified."""
    out = frame.copy()
    h, w = out.shape[:2]
    for d in dets:
        entry = (class_config or {}).get(str(d.get("class_id")), {})
        colour = _bgr(entry.get("colour", "#ffffff"))
        x, y, bw, bh = d["bbox"]
        p1, p2 = (int(x * w), int(y * h)), (int((x + bw) * w), int((y + bh) * h))
        poly = d.get("polygon")
        if poly and len(poly) >= 3:
            pts = np.array([[int(px * w), int(py * h)] for px, py in poly], np.int32)
            layer = out.copy()
            cv2.fillPoly(layer, [pts], colour)
            out = cv2.addWeighted(layer, 0.35, out, 0.65, 0)
            cv2.polylines(out, [pts], True, colour, 2)
        else:
            cv2.rectangle(out, p1, p2, colour, 2)
        label = f"{(entry.get('names') or {}).get('en') or d.get('class', '')} {d.get('score', 0):.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        top = max(p1[1] - th - 4, 0)
        cv2.rectangle(out, (p1[0], top), (p1[0] + tw + 4, top + th + 4), colour, -1)
        cv2.putText(out, label, (p1[0] + 2, top + th + 1), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return out
