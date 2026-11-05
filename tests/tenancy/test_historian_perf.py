"""Spec §6.2 target: one tag x one year answers in p95 < 500 ms. A year of
hourly rollup rows is written inside a transaction that is rolled back, so the
shared database is left as it was."""

from __future__ import annotations

import statistics
import time
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run

YEAR_H = 365 * 24


class _Rollback(Exception):
    pass


def test_one_tag_one_year_from_the_hourly_rollup(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx
    from app.production.rollup import pick_source

    async def go():
        pools = await make_pools()
        try:
            end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
            start = end - timedelta(hours=YEAR_H)
            times = []
            with pytest.raises(_Rollback):
                async with tenant_tx(pools.system, a["org"]) as tc:
                    await tc.execute(
                        "INSERT INTO tag_rollup_1h (org_id, tag_id, bucket, mn, mx, sm, nn, n, lv, lts)"
                        " SELECT $1, $2, g, 1, 9, 5*3600, 3600, 3600, 5, g"
                        " FROM generate_series($3::timestamptz, $4::timestamptz,"
                        "                      interval '1 hour') g",
                        a["org"], a["tag"], start, end)
                    q = ("SELECT to_timestamp(floor(extract(epoch from bucket)/$4)*$4) AS bucket,"
                         " min(mn) AS mn, max(mx) AS mx, sum(sm)/NULLIF(sum(nn),0) AS av,"
                         " sum(n)::int AS n FROM tag_rollup_1h"
                         " WHERE tag_id=$1 AND bucket >= $2 AND bucket <= $3 GROUP BY 1 ORDER BY 1")
                    assert pick_source(54000, start, end) == "1h"
                    for _ in range(20):
                        t0 = time.perf_counter()
                        rows = await tc.fetch(q, a["tag"], start, end, 54000)
                        times.append(time.perf_counter() - t0)
                    assert 500 < len(rows) < 700  # ~ 8760 h / 15 h
                    raise _Rollback
            p95 = sorted(times)[int(len(times) * 0.95) - 1]
            assert p95 < 0.5, f"p95 {p95 * 1000:.0f} ms (median {statistics.median(times) * 1000:.0f} ms)"
        finally:
            await pools.close()
    run(go())
