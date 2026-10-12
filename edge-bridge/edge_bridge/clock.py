"""Edge clock model (SDLC 04 §6.6 clock discipline).

`EDGE_CLOCK_SKEW_MS` simulates an offset between this edge's clock and true
UTC. Every edge-generated timestamp goes through `now()`, and command TTL
checks run against it — so a test that sets the env var exercises the same
code path a real skewed clock would.

If |offset| > 500 ms the clock is untrusted: heartbeat reports
clock_ok=false and commands are denied before the TTL math, because a TTL
computed on an untrusted clock proves nothing.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


class EdgeClock:
    def __init__(self, skew_ms: float = 0.0, threshold_ms: float = 500.0):
        self.offset = timedelta(milliseconds=skew_ms)
        self.threshold_ms = threshold_ms
        self.skew_ms = skew_ms

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + self.offset

    @property
    def clock_ok(self) -> bool:
        return abs(self.skew_ms) <= self.threshold_ms
