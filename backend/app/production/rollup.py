"""Historian maintenance: numeric sample value, rollup refresh, partitions.

tag_history is range-partitioned by month (migration 0052). Long-range trends
read `tag_rollup_1m` / `tag_rollup_1h` instead of scanning raw samples. The
rollups are plain RLS tables refreshed from here as wds_system inside a tenant
tx per org — the same trust shape as ingest.

  1m  <- raw tag_history over the refresh window
  1h  <- the 1m rollup over the same window (exact: sums, counts, min, max)

Late samples (QoS1 replay after an edge outage, accepted up to
HISTORY_MAX_AGE_S) are re-aggregated by a deeper pass once an hour.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from ..core import config
from ..db.context import active_org_ids, tenant_tx

log = logging.getLogger("wds.rollup")

ROLLUP_LOCK = 0x57445352  # "WDSR": one refresher across replicas
FRESH_WINDOW = timedelta(hours=2)
DEEP_WINDOW = timedelta(seconds=config.HISTORY_MAX_AGE_S) + timedelta(hours=1)
DEEP_EVERY_S = 3600.0
BACKFILL_STEP = timedelta(days=1)
RETAIN_1M_DAYS = 90
_EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)

_last_deep = 0.0


def numeric_value(v) -> float | None:
    """The `vn` column: numbers as-is, bool as 0/1, anything else NULL
    (NaN/inf would poison every aggregate, so they are NULL too)."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)) and v == v and v not in (float("inf"), float("-inf")):
        return float(v)
    return None


def floor_to(ts: datetime, seconds: int) -> datetime:
    n = int((ts - _EPOCH).total_seconds()) // seconds * seconds
    return _EPOCH + timedelta(seconds=n)


_SQL_1M = """
INSERT INTO tag_rollup_1m (org_id, tag_id, bucket, mn, mx, sm, nn, n, lv, lts)
SELECT org_id, tag_id, date_bin('1 minute', ts, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS b,
       min(vn), max(vn), sum(vn), count(vn)::int, count(*)::int,
       (array_agg(vn ORDER BY ts DESC) FILTER (WHERE vn IS NOT NULL))[1],
       max(ts) FILTER (WHERE vn IS NOT NULL)
  FROM tag_history WHERE ts >= $1 AND ts < $2
 GROUP BY org_id, tag_id, b
ON CONFLICT (tag_id, bucket) DO UPDATE
   SET mn = EXCLUDED.mn, mx = EXCLUDED.mx, sm = EXCLUDED.sm, nn = EXCLUDED.nn,
       n = EXCLUDED.n, lv = EXCLUDED.lv, lts = EXCLUDED.lts
"""

_SQL_1H = """
INSERT INTO tag_rollup_1h (org_id, tag_id, bucket, mn, mx, sm, nn, n, lv, lts)
SELECT org_id, tag_id, date_bin('1 hour', bucket, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS b,
       min(mn), max(mx), sum(sm), sum(nn)::int, sum(n)::int,
       (array_agg(lv ORDER BY lts DESC) FILTER (WHERE lv IS NOT NULL))[1],
       max(lts)
  FROM tag_rollup_1m WHERE bucket >= $1 AND bucket < $2
 GROUP BY org_id, tag_id, b
ON CONFLICT (tag_id, bucket) DO UPDATE
   SET mn = EXCLUDED.mn, mx = EXCLUDED.mx, sm = EXCLUDED.sm, nn = EXCLUDED.nn,
       n = EXCLUDED.n, lv = EXCLUDED.lv, lts = EXCLUDED.lts
"""


async def refresh_org(tc, now: datetime, window: timedelta) -> int:
    """Re-aggregate [now - window, now] for the tenant in `tc`. When the org
    has raw samples but no rollup yet (first run, or a restored database) the
    window starts at its oldest raw sample and is walked a day at a time."""
    start = floor_to(now - window, 3600)
    if not await tc.fetchval("SELECT 1 FROM tag_rollup_1m LIMIT 1"):
        first = await tc.fetchval("SELECT min(ts) FROM tag_history")
        if first is not None:
            start = min(start, floor_to(first, 3600))
    end = floor_to(now, 60) + timedelta(minutes=1)
    rows = 0
    cur = start
    while cur < end:
        nxt = min(cur + BACKFILL_STEP, end)
        await tc.execute(_SQL_1M, cur, nxt)
        await tc.execute(_SQL_1H, cur, nxt)
        rows += 1
        cur = nxt
    return rows


async def refresh_all(pools) -> int:
    """One refresher at a time across replicas; skip silently if another holds
    the lock. Returns the number of org windows refreshed."""
    global _last_deep
    now = datetime.now(timezone.utc)
    deep = time.monotonic() - _last_deep >= DEEP_EVERY_S
    window = DEEP_WINDOW if deep else FRESH_WINDOW
    async with pools.system.acquire() as conn:
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", ROLLUP_LOCK):
            return 0
        try:
            done = 0
            for org_id in await active_org_ids(pools.system):
                try:
                    async with tenant_tx(pools.system, org_id) as tc:
                        await refresh_org(tc, now, window)
                    done += 1
                except Exception:  # noqa: BLE001 — one org must not stall the rest
                    log.exception("rollup refresh failed", extra={"org": str(org_id)})
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", ROLLUP_LOCK)
    if deep:
        _last_deep = time.monotonic()
    return done


async def ensure_partitions(pools, months_ahead: int = 3) -> int:
    """Pre-create current-1 .. +months_ahead monthly partitions of tag_history."""
    today = datetime.now(timezone.utc).date()
    async with pools.system.acquire() as conn:
        return await conn.fetchval(
            "SELECT wds_history_ensure_partitions($1, $2)",
            today - timedelta(days=31), today + timedelta(days=31 * months_ahead))


async def drop_expired_partitions(pools, max_retention_days: int) -> int:
    """Whole months older than the longest plan retention are dropped outright
    (instant, no vacuum). Shorter per-org retention stays a row DELETE."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_retention_days)
    async with pools.system.acquire() as conn:
        return await conn.fetchval("SELECT wds_history_drop_before($1)", cutoff)


async def prune_rollups(tc, retention_days: int, now: datetime) -> None:
    """1m keeps min(plan, 90 days); 1h keeps the plan's retention."""
    await tc.execute("DELETE FROM tag_rollup_1m WHERE bucket < $1",
                     now - timedelta(days=min(retention_days, RETAIN_1M_DAYS)))
    await tc.execute("DELETE FROM tag_rollup_1h WHERE bucket < $1",
                     now - timedelta(days=retention_days))


def pick_source(bucket_s: int, t_from: datetime, now: datetime) -> str:
    """Which table answers a bucketed query: the coarsest rollup whose bucket
    divides the requested one, else raw. 1m rows only exist for 90 days."""
    if bucket_s >= 3600 and bucket_s % 3600 == 0:
        return "1h"
    if bucket_s >= 60 and bucket_s % 60 == 0 and t_from >= now - timedelta(days=RETAIN_1M_DAYS):
        return "1m"
    return "raw"
