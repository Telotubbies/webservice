"""Material (gravel / sand) decision for a dump point, one answer per truck.

The detector is judged on what it does for the *visit*, not on per-frame mask
quality, so a frame is only evidence:

  presence gate   k_enter occupied frames open a visit, k_leave empty frames
                  close it (debounce + hysteresis, as for any PLC input);
  evidence        per frame, per class: sum(score * mask_area) over detections
                  that pass conf / area_min  (confidence-weighted, so one
                  tiny noisy mask cannot outvote a pile);
  decision        mass_vote (sum over the visit) or frame_majority;
  confidence      margin = |sand_frac - 0.5| * 2; below min_margin the answer
                  is flagged `uncertain` for human review;
  rejection       a visit shorter than min_frames is not a truck: no event.

Settings arrive in the camera cfg (untrusted): `parse_cfg` clamps every value.
`preprocess` runs BEFORE inference (ROI mask, CLAHE, gamma, brightness) so the
operator can condition the picture without retraining.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

SCHEMA = "wds.material.v1"

_DEF = {
    "enabled": True, "dry_run": True, "gravel_class": "gravel", "sand_class": "sand",
    "conf": 0.25, "area_min": 0.005, "coverage_gate": 0.02, "k_enter": 3, "k_leave": 5,
    "min_margin": 0.30, "min_frames": 15, "max_event_s": 180, "rule": "mass_vote",
}
_RANGE = {"conf": (0.05, 0.95), "area_min": (0.0, 0.5), "coverage_gate": (0.001, 0.9),
          "k_enter": (1, 30), "k_leave": (1, 120), "min_margin": (0.0, 1.0),
          "min_frames": (1, 1000), "max_event_s": (10, 3600)}


def _clamp(v, lo, hi, default):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return default
    return min(max(v, lo), hi)


def parse_cfg(raw) -> dict | None:
    """Clamped settings, or None when the decision is off / malformed."""
    if not isinstance(raw, dict) or raw.get("enabled") is not True:
        return None
    c = dict(_DEF)
    for k, (lo, hi) in _RANGE.items():
        v = _clamp(raw.get(k), lo, hi, _DEF[k])
        c[k] = int(v) if isinstance(_DEF[k], int) else float(v)
    for k in ("gravel_class", "sand_class"):
        v = raw.get(k)
        c[k] = v[:80] if isinstance(v, str) and v else _DEF[k]
    c["rule"] = raw.get("rule") if raw.get("rule") in ("mass_vote", "frame_majority") else "mass_vote"
    c["dry_run"] = raw.get("dry_run") is not False        # anything but an explicit false stays safe
    pp = raw.get("preprocess") if isinstance(raw.get("preprocess"), dict) else {}
    roi = pp.get("roi")
    if not (isinstance(roi, list) and len(roi) == 4 and all(
            isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 1 for x in roi)
            and roi[2] - roi[0] >= 0.05 and roi[3] - roi[1] >= 0.05):
        roi = None
    c["preprocess"] = {
        "clahe": pp.get("clahe") is True, "clahe_clip": float(_clamp(pp.get("clahe_clip"), 1.0, 8.0, 2.0)),
        "gamma": float(_clamp(pp.get("gamma"), 0.4, 2.5, 1.0)),
        "brightness": int(_clamp(pp.get("brightness"), -60, 60, 0)), "roi": roi}
    out = raw.get("outputs") if isinstance(raw.get("outputs"), dict) else {}
    c["outputs"] = {k: (out[k] if isinstance(out.get(k), str) and 1 <= len(out[k]) <= 200 else None)
                    for k in ("code", "margin_pct", "uncertain", "trigger")}
    for k, d, hi in (("gravel_value", 1, 65535), ("sand_value", 2, 65535), ("none_value", 0, 65535)):
        c["outputs"][k] = int(_clamp(out.get(k), 0, hi, d))
    c["outputs"]["pulse_ms"] = int(_clamp(out.get("pulse_ms"), 50, 10_000, 500))
    return c


# -------------------------------------------------------------- preprocessing
def preprocess(frame, pp: dict):
    """ROI -> brightness/gamma -> CLAHE, only the steps that are switched on."""
    if not pp or (pp["roi"] is None and not pp["clahe"] and pp["gamma"] == 1.0 and pp["brightness"] == 0):
        return frame
    img = frame
    if pp["gamma"] != 1.0 or pp["brightness"]:
        lut = np.clip(((np.arange(256) / 255.0) ** (1.0 / pp["gamma"])) * 255.0 + pp["brightness"], 0, 255)
        img = cv2.LUT(img, lut.astype(np.uint8))
    if pp["clahe"]:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = cv2.createCLAHE(clipLimit=pp["clahe_clip"], tileGridSize=(8, 8)).apply(lab[:, :, 0])
        img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    if pp["roi"] is not None:
        h, w = img.shape[:2]
        x0, y0, x1, y1 = (int(pp["roi"][0] * w), int(pp["roi"][1] * h), int(pp["roi"][2] * w), int(pp["roi"][3] * h))
        masked = np.zeros_like(img)
        masked[y0:y1, x0:x1] = img[y0:y1, x0:x1]
        img = masked
    return img


# --------------------------------------------------------------------- decider
def _poly_area(poly) -> float:
    """Shoelace area of a normalized polygon (fraction of the frame)."""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return abs(sum(xs[i] * ys[(i + 1) % len(xs)] - xs[(i + 1) % len(xs)] * ys[i] for i in range(len(xs)))) / 2.0


def _det_area(d: dict) -> float:
    poly = d.get("polygon")
    if poly and len(poly) >= 3:
        return _poly_area(poly)
    b = d.get("bbox") or [0, 0, 0, 0]
    return max(0.0, (b[2] - b[0]) * (b[3] - b[1])) * 0.7      # no mask: a box over-states the pile


class MaterialDecider:
    def __init__(self):
        self.cfg: dict | None = None
        self.state = "empty"
        self._enter = self._leave = 0
        self._votes: list[tuple[float, float]] = []
        self._cover: list[float] = []
        self._t0 = 0.0
        self.frames = 0                  # inferences judged
        self.decisions = 0
        self.dropped = 0                 # visits too short to be a truck
        self.last: dict | None = None
        self.sand_frac: float | None = None
        self.coverage = 0.0
        self._cfg_raw = None

    def configure(self, raw) -> bool:
        """Apply a cfg block; returns whether the decision is on."""
        if raw != self._cfg_raw:
            self._cfg_raw = raw
            self.cfg = parse_cfg(raw)
            if self.cfg is None:
                self.state, self._votes, self._cover = "empty", [], []
        return self.cfg is not None

    # perception: dets -> (gravel mass, sand mass, coverage)
    def _observe(self, dets: list) -> tuple[float, float, float]:
        c = self.cfg
        roi = c["preprocess"]["roi"]
        denom = (roi[2] - roi[0]) * (roi[3] - roi[1]) if roi else 1.0
        g = s = cover = 0.0
        for d in dets:
            if d.get("score", 0) < c["conf"]:
                continue
            a = _det_area(d) / denom
            if a < c["area_min"]:
                continue
            if d.get("class") == c["gravel_class"]:
                g += d["score"] * a
            elif d.get("class") == c["sand_class"]:
                s += d["score"] * a
            else:
                continue
            cover += a
        return g, s, min(cover, 1.0)

    def feed(self, dets: list, t: float | None = None) -> dict | None:
        """One sampled frame. Returns a decision package when a visit closes."""
        c = self.cfg
        if c is None:
            return None
        t = time.monotonic() if t is None else t
        g, s, cover = self._observe(dets)
        self.frames += 1
        self.coverage = cover
        occupied = cover > c["coverage_gate"]
        ev = None
        if self.state == "empty":
            self._enter = self._enter + 1 if occupied else 0
            if self._enter >= c["k_enter"]:
                self.state, self._votes, self._cover, self._t0, self._leave = "present", [], [], t, 0
        else:
            self._votes.append((g, s))
            self._cover.append(cover)
            self._leave = self._leave + 1 if not occupied else 0
            tot = sum(a + b for a, b in self._votes)
            self.sand_frac = (sum(b for _, b in self._votes) / tot) if tot else None
            if self._leave >= c["k_leave"] or t - self._t0 >= c["max_event_s"]:
                ev = self._emit(t)
                self.state, self._enter = "empty", 0
        return ev

    def _emit(self, t_end: float) -> dict | None:
        c = self.cfg
        votes = self._votes[: len(self._votes) - self._leave] or self._votes     # trailing empty frames are not evidence
        if len(votes) < c["min_frames"]:
            self.dropped += 1
            self.sand_frac = None
            return None
        gw = sum(a for a, _ in votes)
        sw = sum(b for _, b in votes)
        if c["rule"] == "frame_majority":
            sf = sum(1 for a, b in votes if b > a)
            gf = sum(1 for a, b in votes if a > b)
            frac = sf / (sf + gf) if sf + gf else None
        else:
            frac = sw / (gw + sw) if gw + sw else None
        if frac is None:
            decision, margin = "no-material", 0.0
        else:
            decision = "sand" if frac > 0.5 else "gravel"
            margin = abs(frac - 0.5) * 2
        self.decisions += 1
        self.sand_frac = None
        pkg = {
            "schema": SCHEMA, "decision": decision, "sand_frac": round(frac, 4) if frac is not None else None,
            "gravel_w": round(gw, 4), "sand_w": round(sw, 4), "margin": round(margin, 4),
            "uncertain": margin < c["min_margin"], "frames": len(votes),
            "coverage_mean": round(float(np.mean(self._cover)), 4) if self._cover else 0.0,
            "duration_s": round(max(0.0, t_end - self._t0), 1), "rule": c["rule"],
            "params": {k: c[k] for k in ("conf", "area_min", "coverage_gate", "k_enter", "k_leave", "min_margin",
                                         "min_frames")},
        }
        self.last = {"decision": decision, "margin": pkg["margin"], "uncertain": pkg["uncertain"]}
        return pkg

    def status(self) -> dict:
        d = {"gate": "present" if self.state == "present" else "empty", "coverage": round(self.coverage, 4),
             "frames": self.frames, "decisions": self.decisions}
        if self.sand_frac is not None:
            d["sand_frac"] = round(self.sand_frac, 4)
        if self.last:
            d["last"] = self.last
        return d


# ------------------------------------------------------------------------- HUD
def draw_hud(img, status: dict, dry_run: bool):
    """Gate + running answer, top-left; English only (cv2 fonts)."""
    gate = status.get("gate", "empty")
    frac = status.get("sand_frac")
    last = status.get("last")
    lines = [("TRUCK: PRESENT" if gate == "present" else "TRUCK: WAITING", (60, 200, 90) if gate == "present" else (200, 200, 200))]
    if gate == "present" and frac is not None:
        lines.append((f"SAND {frac * 100:.0f}%  GRAVEL {(1 - frac) * 100:.0f}%", (255, 220, 120)))
    if last:
        lines.append((f"LAST: {last['decision'].upper()} ({last['margin'] * 100:.0f}%)"
                      + (" ?" if last["uncertain"] else ""), (120, 200, 255)))
    if dry_run:
        lines.append(("DRY-RUN (no PLC write)", (120, 160, 255)))
    h, w = img.shape[:2]
    scale = max(0.7, min(w, h) / 700.0)
    pad, y = int(8 * scale), int(8 * scale)
    bw = int(max(cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, 1)[0][0] for t, _ in lines) + 2 * pad)
    lh = int(24 * scale)
    overlay = img.copy()
    cv2.rectangle(overlay, (pad, y), (pad + bw, y + lh * len(lines) + pad), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.6, img, 0.4, 0, img)
    for i, (t, col) in enumerate(lines):
        cv2.putText(img, t, (2 * pad, y + lh * (i + 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, col, 1, cv2.LINE_AA)
    return img


class Window:
    """Counts since the last stat period (inferences, detections) — reset by take()."""

    def __init__(self):
        self.infer = self.det = 0

    def add(self, n_dets: int) -> None:
        self.infer += 1
        self.det += n_dets

    def take(self) -> tuple[int, int]:
        r = (self.infer, self.det)
        self.infer = self.det = 0
        return r
