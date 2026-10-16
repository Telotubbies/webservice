"""Detector seam. Plan M1-03 ships only the null detector; the ONNX-backed
one arrives with the model plans (M1-04/05)."""

from __future__ import annotations

from typing import Protocol


class Detector(Protocol):
    def detect(self, frame_bgr) -> list[dict]:
        """Detections in the model-server schema (spec 9.10); may be empty."""
        ...


class NullDetector:
    def detect(self, frame_bgr) -> list[dict]:
        return []
