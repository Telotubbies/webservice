"""Historian (migration 0052): partitioned tag_history keeps tenant isolation,
dedup and the vn column; rollups are RLS tables whose numbers match raw."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run

NOW = datetime.now(timezone.utc).replace(microsecond=0)


async def _put(tc, o, ts, v, q="good"):
    from app.production.rollup import numeric_value
    await tc.execute(
        "INSERT INTO tag_history(tag_id, ts, org_id, v, q, vn) VALUES ($1,$2,$3,$4,$5,$6)"
        " ON CONFLICT (tag_id, ts) DO NOTHING", o["tag"], ts, o["org"], v, q, numeric_value(v))


def test_history_isolated_and_deduped(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.system, a["org"]) as tc:
                await _put(tc, a, NOW, 1.5)
                await _put(tc, a, NOW, 9.9)  # replay of the same (tag, ts): ignored
            async with tenant_tx(pools.app, a["org"]) as tc:
                rows = await tc.fetch("SELECT v, vn FROM tag_history")
                assert [(r["v"], r["vn"]) for r in rows] == [(1.5, 1.5)]
            async with tenant_tx(pools.app, b["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM tag_history") == 0
            async with tenant_tx(pools.system, b["org"]) as tc:
                with pytest.raises(asyncpg.PostgresError):  # a's tag, b's context
                    await _put(tc, a, NOW + timedelta(seconds=1), 2.0)
        finally:
            await pools.close()
    run(go())


def test_old_samples_land_in_a_partition_or_default(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            old = NOW - timedelta(days=400)  # no month partition for it
            async with tenant_tx(pools.system, a["org"]) as tc:
                await _put(tc, a, old, 3.0)
            async with tenant_tx(pools.app, a["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM tag_history WHERE ts=$1", old) == 1
        finally:
            await pools.close()
    run(go())


class _Rollback(Exception):
    """Raised inside a tenant_tx so DDL and rows leave no trace in the shared DB."""


def test_ensure_moves_default_rows_and_drop_removes_months(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            far = datetime(2032, 5, 10, tzinfo=timezone.utc)
            with pytest.raises(_Rollback):
                async with tenant_tx(pools.system, a["org"]) as tc:
                    await _put(tc, a, far, 7.0)  # no partition for 2032 yet
                    where = "SELECT tableoid::regclass::text FROM tag_history WHERE ts=$1"
                    assert await tc.fetchval(where, far) == "tag_history_default"
                    q = "SELECT wds_history_ensure_partitions($1,$2)"
                    assert await tc.fetchval(q, far.date(), far.date()) == 1
                    assert await tc.fetchval(q, far.date(), far.date()) == 0
                    # the row that sat in the default partition moved with it
                    assert await tc.fetchval(where, far) == "tag_history_y2032m05"
                    cutoff = datetime(2032, 6, 1, tzinfo=timezone.utc)
                    assert await tc.fetchval("SELECT wds_history_drop_before($1)", cutoff) >= 1
                    assert await tc.fetchval("SELECT to_regclass('public.tag_history_y2032m05')") is None
                    raise _Rollback
            # the app role may not drop partitions
            async with pools.app.acquire() as conn:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await conn.fetchval("SELECT wds_history_drop_before(now())")
        finally:
            await pools.close()
    run(go())


def test_rollup_matches_raw_and_is_isolated(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx
    from app.production import rollup

    async def go():
        pools = await make_pools()
        try:
            base = NOW.replace(second=0, minute=0) - timedelta(hours=1)
            vals = [(base + timedelta(seconds=10 * i), float(i)) for i in range(120)]  # 20 min
            async with tenant_tx(pools.system, a["org"]) as tc:
                for ts, v in vals:
                    await _put(tc, a, ts, v)
                await _put(tc, a, base + timedelta(seconds=5), True)    # bool -> 1
                await _put(tc, a, base + timedelta(seconds=7), "text")  # no vn
                await rollup.refresh_org(tc, NOW, timedelta(hours=3))
            async with tenant_tx(pools.app, a["org"]) as tc:
                raw = await tc.fetchrow(
                    "SELECT min(vn) mn, max(vn) mx, sum(vn) sm, count(vn)::int nn, count(*)::int n"
                    " FROM tag_history WHERE ts >= $1 AND ts < $2",
                    base, base + timedelta(hours=1))
                for tbl in ("tag_rollup_1m", "tag_rollup_1h"):
                    r = await tc.fetchrow(
                        f"SELECT min(mn) mn, max(mx) mx, sum(sm) sm, sum(nn)::int nn, sum(n)::int n"
                        f" FROM {tbl} WHERE bucket >= $1 AND bucket < $2",
                        base, base + timedelta(hours=1))
                    assert dict(r) == dict(raw), tbl
                assert raw["n"] == raw["nn"] + 1  # the text sample counts in n only
                # the app role reads rollups but cannot write them
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await tc.execute("DELETE FROM tag_rollup_1m")
            async with tenant_tx(pools.app, b["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM tag_rollup_1m") == 0
                assert await tc.fetchval("SELECT count(*) FROM tag_rollup_1h") == 0
        finally:
            await pools.close()
    run(go())


def test_prune_batch_deletes_exactly_the_old_rows(two_orgs):
    """Keyed on the PK, so rows in different partitions are all reached and
    nothing newer than the cutoff is touched (a ctid key would not be)."""
    a, b = two_orgs
    from app.db.context import tenant_tx
    from app.tenancy import plans

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.system, a["org"]) as tc:
                for d in (400, 60, 45, 3, 2):  # 400d old lives in the default partition
                    await _put(tc, a, NOW - timedelta(days=d), float(d))
            async with tenant_tx(pools.system, b["org"]) as tc:
                await _put(tc, {**b}, NOW - timedelta(days=60), 1.0)
            cutoff = NOW - timedelta(days=10)
            async with tenant_tx(pools.system, a["org"]) as tc:
                assert await plans.delete_history_batch(tc, cutoff, 2) == 2
                assert await plans.delete_history_batch(tc, cutoff, 2) == 1
                assert await plans.delete_history_batch(tc, cutoff, 2) == 0
                assert await tc.fetchval("SELECT count(*) FROM tag_history") == 2
            async with tenant_tx(pools.system, b["org"]) as tc:  # other org untouched
                assert await tc.fetchval("SELECT count(*) FROM tag_history") == 1
        finally:
            await pools.close()
    run(go())
