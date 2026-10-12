"""Simulated process adapter — no hardware required.

Implements exactly the tag set and behaviors from CONTRACT.md §Sim tags
(sorting-line scenario):

    motor1.running    writable bool — start/stop the conveyor
    motor1.speed_sp   writable num  — setpoint Hz, 0..60 else denied/out_of_range
    conv1.speed_mps   read-only     — first-order follow of motor1, 0 when stopped, + noise
    conv1.temp_c      read-only     — drifts up while running (>80 = alarm territory)
    bin1.level_pct    read-only     — ramps 0->100 while running, decays when stopped
    cam1.gravel_ratio read-only     — slow random walk 0..1 (vision stub)

The tag *registry* (names, writable flag, ranges, units) may be overridden
via the `sim.tags` section of tags.yaml; the *dynamics* below are the
contract and stay in code.
"""

from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from .base import Quality, TagAdapter, TagValue, WriteResult

# Contract tag table — used when tags.yaml has no sim section. Keys are the
# tag tail after "{site}.sort."/"{site}.sort."; values describe writability
# and how the value evolves each poll.
_DEFAULT_TAGS: dict[str, dict] = {
    "sort.line1.motor1.running": {
        "writable": True, "initial": False, "behavior": "state",
    },
    "sort.line1.motor1.speed_sp": {
        "writable": True, "initial": 45.0, "min": 0.0, "max": 60.0,
        "unit": "Hz", "behavior": "state",
    },
    "sort.line1.conv1.speed_mps": {
        "writable": False, "initial": 0.0, "unit": "m/s", "behavior": "conv_speed",
    },
    "sort.line1.conv1.temp_c": {
        "writable": False, "initial": 28.0, "unit": "degC", "behavior": "conv_temp",
    },
    "sort.line1.bin1.level_pct": {
        "writable": False, "initial": 20.0, "unit": "%", "behavior": "bin_level",
    },
    "sort.vision.cam1.gravel_ratio": {
        "writable": False, "initial": 0.3, "behavior": "random_walk",
    },
}

# Simple conveyor physics — tuned so ~30 s of running at 45 Hz pushes
# temp_c past the seeded 80 degC alarm rule.
_BELT_MAX_MPS = 2.5        # belt speed at 60 Hz setpoint
_SPEED_LAG_S = 1.5         # first-order lag toward target speed
_TEMP_AMBIENT = 28.0
_TEMP_FULL_SPEED = 112.0   # steady-state at 60 Hz; default 45 Hz -> ~91 C, past the 80 C rule
_TEMP_LAG_S = 20.0
_LEVEL_FILL_RATE = 4.0     # %/s at full speed (~25 s 0->100)
_LEVEL_DRAIN_RATE = 1.5    # %/s when stopped
_GRAVEL_STEP = 0.02        # random-walk step per poll


class SimAdapter(TagAdapter):
    name = "sim"

    def __init__(self, site: str, tags_cfg: dict | None = None,
                 now: Callable[[], datetime] | None = None):
        self._site = site
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._last_tick = time.monotonic()

        spec = tags_cfg or _DEFAULT_TAGS
        self._tags: dict[str, dict] = {}
        self._values: dict[str, float | bool] = {}
        for tail, meta in spec.items():
            full = tail if tail.startswith(f"{site}.") else f"{site}.{tail}"
            self._tags[full] = dict(meta)
            self._values[full] = meta.get("initial", 0.0)

    # -- command path ----------------------------------------------------

    def write(self, tag: str, value: object) -> WriteResult:
        with self._lock:
            meta = self._tags.get(tag)
            # Contract: unknown tag and read-only tag both -> denied/not_writable
            if meta is None or not meta.get("writable", False):
                return WriteResult.denied("not_writable")

            if meta["behavior"] == "state":
                if isinstance(meta.get("initial"), bool):
                    coerced = self._coerce_bool(value)
                    if coerced is None:
                        return WriteResult.denied("invalid_value")
                    self._values[tag] = coerced
                    return WriteResult.done()

                num = self._coerce_float(value)
                if num is None:
                    return WriteResult.denied("invalid_value")
                lo, hi = meta.get("min"), meta.get("max")
                if (lo is not None and num < lo) or (hi is not None and num > hi):
                    return WriteResult.denied("out_of_range")
                self._values[tag] = num
                return WriteResult.done()

            return WriteResult.denied("not_writable")

    @staticmethod
    def _coerce_float(value: object) -> float | None:
        # bool is an int subclass — reject it explicitly so True doesn't
        # silently become a 1.0 Hz setpoint on a numeric tag.
        if isinstance(value, bool):
            return None
        try:
            num = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if num != num or num in (float("inf"), float("-inf")):
            return None
        return num

    @staticmethod
    def _coerce_bool(value: object) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)
        if isinstance(value, str) and value.lower() in ("true", "false", "0", "1"):
            return value.lower() in ("true", "1")
        return None

    # -- poll path --------------------------------------------------------

    def read_all(self) -> list[TagValue]:
        with self._lock:
            now = time.monotonic()
            dt = min(now - self._last_tick, 10.0)  # cap: a stall ≠ time warp
            self._last_tick = now
            self._tick(dt)
            ts = self._now()
            return [
                TagValue(name=t, v=self._values[t], q=Quality.GOOD, ts=ts)
                for t in self._tags
            ]

    def _tag(self, tail: str) -> str:
        return f"{self._site}.{tail}"

    def _tick(self, dt: float) -> None:
        running = bool(self._values[self._tag("sort.line1.motor1.running")])
        sp = float(self._values[self._tag("sort.line1.motor1.speed_sp")])
        load = sp / 60.0  # 0..1 fraction of full speed

        speed_t = self._tag("sort.line1.conv1.speed_mps")
        temp_t = self._tag("sort.line1.conv1.temp_c")
        level_t = self._tag("sort.line1.bin1.level_pct")
        gravel_t = self._tag("sort.vision.cam1.gravel_ratio")

        # Conveyor speed: first-order approach to target, small noise, >=0.
        target = _BELT_MAX_MPS * load if running else 0.0
        speed = float(self._values[speed_t])
        speed += (target - speed) * min(dt / _SPEED_LAG_S, 1.0)
        speed += random.uniform(-0.02, 0.02)
        self._values[speed_t] = round(max(speed, 0.0), 3)

        # Motor/gearbox temperature: drifts toward a running setpoint that
        # crosses the 80 degC alarm rule at high setpoints, decays to ambient.
        temp_target = _TEMP_AMBIENT + (_TEMP_FULL_SPEED - _TEMP_AMBIENT) * load \
            if running else _TEMP_AMBIENT
        temp = float(self._values[temp_t])
        temp += (temp_target - temp) * min(dt / _TEMP_LAG_S, 1.0)
        self._values[temp_t] = round(temp + random.uniform(-0.05, 0.05), 2)

        # Bin level: fills proportional to belt speed, drains when stopped.
        level = float(self._values[level_t])
        if running:
            level += _LEVEL_FILL_RATE * load * dt
        else:
            level -= _LEVEL_DRAIN_RATE * dt
        self._values[level_t] = round(min(max(level, 0.0), 100.0), 2)

        # Vision stub: slow random walk in [0, 1].
        gravel = float(self._values[gravel_t])
        gravel += random.uniform(-_GRAVEL_STEP, _GRAVEL_STEP)
        self._values[gravel_t] = round(min(max(gravel, 0.0), 1.0), 4)

    def tag_map(self) -> dict[str, dict]:
        return {t: dict(m) for t, m in self._tags.items()}
