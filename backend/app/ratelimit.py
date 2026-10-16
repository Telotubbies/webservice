"""In-process token-bucket rate limiting (v4 T4; doc 16 row 7).

Buckets live in this process's memory — correct for the single backend
replica the compose deployment runs. Horizontal scale-out needs a shared
limiter (Redis, or a gateway-side policy); with N replicas each would hold
its own buckets and effective limits would multiply by N.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

log = logging.getLogger("backend.ratelimit")


@dataclass
class _Bucket:
    tokens: float
    updated: float  # monotonic clock of last touch — refill + idle eviction


class RateLimiter:
    """Token bucket keyed by an arbitrary string (e.g. "user:tag").

    `allow(key, cost)` spends `cost` tokens if available. Buckets refill at
    capacity/window_s and are evicted after `idle_ttl_s` untouched — a quiet
    key costs no memory.
    """

    def __init__(self, capacity: int, window_s: float,
                 idle_ttl_s: float = 900.0, clock=time.monotonic):
        if capacity <= 0 or window_s <= 0:
            raise ValueError("capacity and window_s must be positive")
        self.capacity = float(capacity)
        self.refill_per_s = capacity / window_s
        self.idle_ttl_s = idle_ttl_s
        self._clock = clock
        self._buckets: dict[str, _Bucket] = {}
        self._lock = asyncio.Lock()
        self._last_prune = self._clock()

    async def allow(self, key: str, cost: float = 1.0) -> bool:
        async with self._lock:
            self._prune_locked()
            b = self._bucket_locked(key)
            if b.tokens >= cost:
                b.tokens -= cost
                return True
            return False

    async def refund(self, key: str, cost: float = 1.0) -> None:
        """Return `cost` tokens (capped at capacity) — used when a spend is
        followed by a rejection that must not count against the budget, e.g.
        a command POST that loses the in-flight unique-index race."""
        async with self._lock:
            b = self._bucket_locked(key)
            b.tokens = min(self.capacity, b.tokens + cost)

    async def retry_after(self, key: str, cost: float = 1.0) -> float:
        """Seconds until `cost` tokens are available again (for Retry-After)."""
        async with self._lock:
            b = self._bucket_locked(key)
            deficit = cost - b.tokens
            return max(0.0, deficit / self.refill_per_s)

    def _bucket_locked(self, key: str) -> _Bucket:
        now = self._clock()
        b = self._buckets.get(key)
        if b is None:
            b = _Bucket(tokens=self.capacity, updated=now)
            self._buckets[key] = b
        else:
            b.tokens = min(self.capacity,
                           b.tokens + (now - b.updated) * self.refill_per_s)
            b.updated = now
        return b

    def _prune_locked(self) -> None:
        now = self._clock()
        if now - self._last_prune < 60.0:
            return
        self._last_prune = now
        idle = [k for k, b in self._buckets.items()
                if now - b.updated > self.idle_ttl_s]
        for k in idle:
            del self._buckets[k]


class TieredRateLimiter:
    """Same bucket semantics as :class:`RateLimiter`, but the capacity is
    chosen per call — e.g. API-key request budgets differ by the owning
    org's plan (roadmap §9 5.5, plans.api_rate_per_min).

    One sub-limiter per distinct capacity value. A key always lands on the
    limiter matching the capacity it was called with, so a plan upgrade
    simply moves the key onto a fresh (full) bucket — generous on upgrade,
    never permissive on downgrade.
    """

    def __init__(self, window_s: float = 60.0,
                 default_capacity: int = 120, idle_ttl_s: float = 900.0):
        self.window_s = window_s
        self.default_capacity = default_capacity
        self.idle_ttl_s = idle_ttl_s
        self._tiers: dict[int, RateLimiter] = {}

    def _for(self, capacity: int | None) -> RateLimiter:
        cap = capacity or self.default_capacity
        lim = self._tiers.get(cap)
        if lim is None:
            lim = RateLimiter(cap, self.window_s, self.idle_ttl_s)
            self._tiers[cap] = lim
        return lim

    async def allow(self, key: str, capacity: int | None = None,
                    cost: float = 1.0) -> bool:
        return await self._for(capacity).allow(key, cost)

    async def retry_after(self, key: str, capacity: int | None = None,
                          cost: float = 1.0) -> float:
        return await self._for(capacity).retry_after(key, cost)
