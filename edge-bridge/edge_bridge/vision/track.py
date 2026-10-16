"""Minimal ByteTrack-style IoU tracker (roadmap 9.8): one object crossing the
camera produces ONE detection event, not one per frame.

Greedy IoU matching per class; unmatched detections start tracks; tracks older
than max_age_s are retired. Deliberately small — no Kalman filter, no second
(low-score) stage: cameras sample at <=15 fps and boxes are already filtered.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field


def _iou(a: list, b: list) -> float:
    """bbox [x,y,w,h] normalized -> intersection over union."""
    ax1, ay1, ax2, ay2 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    ix, iy = max(0.0, min(ax2, bx2) - max(ax1, bx1)), max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    if inter <= 0.0:
        return 0.0
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    class_id: int
    bbox: list
    score: float
    first_seen: float
    last_seen: float
    hits: int = 1
    lost: int = 0                     # consecutive frames without a match
    announced: bool = False           # the object's one-shot event already fired
    extra: dict = field(default_factory=dict)


class IoUTracker:
    """update(detections) -> (all tracks, newly announced tracks).

    A track is "announced" once, the first frame it is confidently matched
    (min_hits consecutive hits); downstream code uses it for one-per-object
    events. The same track object is mutated across frames so rule state can
    ride along in `extra`.
    """

    def __init__(self, iou: float = 0.3, max_lost: int = 5, min_hits: int = 1,
                 now=time.monotonic):
        self.iou = iou
        self.max_lost = max_lost
        self.min_hits = min_hits
        self._now = now
        self._ids = itertools.count(1)
        self._tracks: list[Track] = []

    def update(self, detections: list[dict]) -> tuple[list[Track], list[Track]]:
        now = self._now()
        dets = [d for d in detections
                if isinstance(d, dict) and isinstance(d.get("bbox"), (list, tuple))
                and len(d["bbox"]) == 4 and isinstance(d.get("class_id"), int)]
        used: set[int] = set()
        # greedy best-IoU assignment, same class only
        pairs = []
        for ti, t in enumerate(self._tracks):
            for di, d in enumerate(dets):
                if d["class_id"] != t.class_id or di in used:
                    continue
                ov = _iou(t.bbox, list(d["bbox"]))
                if ov >= self.iou:
                    pairs.append((ov, ti, di))
        pairs.sort(reverse=True)
        taken: set[int] = set()
        for ov, ti, di in pairs:
            if ti in taken or di in used:
                continue
            taken.add(ti)
            used.add(di)
            t = self._tracks[ti]
            t.bbox, t.score = list(dets[di]["bbox"]), float(dets[di].get("score") or 0)
            t.last_seen, t.lost, t.hits = now, 0, t.hits + 1
        for ti, t in enumerate(self._tracks):
            if ti not in taken:
                t.lost += 1
        for di, d in enumerate(dets):
            if di in used:
                continue
            self._tracks.append(Track(
                id=next(self._ids), class_id=d["class_id"], bbox=list(d["bbox"]),
                score=float(d.get("score") or 0), first_seen=now, last_seen=now,
                hits=1))
        self._tracks = [t for t in self._tracks if t.lost <= self.max_lost]
        new = []
        for t in self._tracks:
            if not t.announced and t.hits >= self.min_hits:
                t.announced = True
                new.append(t)
        return self._tracks, new

    def reset(self) -> None:
        self._tracks.clear()
