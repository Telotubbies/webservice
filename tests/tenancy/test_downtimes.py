"""Downtimes: RLS isolation, cross-org rule FK, and the alarm engine's mute check."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run

H = timedelta(hours=1)


async def _rule(tc, o) -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
        " VALUES ($1,$2,'hi','hi',1,'warning') RETURNING id", o["org"], o["tag"])


async def _dt(tc, o, rule, start, end, recurring=False):
    await tc.execute(
        "INSERT INTO downtimes(org_id, rule_id, starts_at, ends_at, recurring, created_by)"
        " VALUES ($1,$2,$3,$4,$5,$6)", o["org"], rule, start, end, recurring, uuid.uuid4())


def test_downtimes_isolated_and_fk_scoped(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx
    now = datetime.now(timezone.utc)

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                await _dt(tc, a, None, now, now + H)
            async with tenant_tx(pools.app, b["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM downtimes") == 0
                rule_b = await _rule(tc, b)
            async with tenant_tx(pools.app, a["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM downtimes") == 1
                with pytest.raises(asyncpg.ForeignKeyViolationError):  # b's rule, a's org
                    await _dt(tc, a, rule_b, now, now + H)
        finally:
            await pools.close()
    run(go())


def test_engine_mute_window(two_orgs):
    a, _ = two_orgs
    from app.alarms import AlarmEngine
    from app.db.context import tenant_tx
    now = datetime.now(timezone.utc)

    async def go():
        pools = await make_pools()
        try:
            eng = AlarmEngine(pools, None, None)
            async with tenant_tx(pools.app, a["org"]) as tc:
                rule = await _rule(tc, a)
                other = await _rule_named(tc, a, "other")
                await _dt(tc, a, rule, now - H, now + H)                       # active, this rule
                await _dt(tc, a, other, now - 3 * H, now - 2 * H)              # ended
                await _dt(tc, a, other, now - 14 * 24 * H, now - 14 * 24 * H + H, True)  # weekly: hit 2 weeks ago
            async with tenant_tx(pools.system, a["org"]) as tc:
                r, o = SimpleNamespace(id=rule), SimpleNamespace(id=other)
                assert await eng._muted(tc, r, now)
                assert not await eng._muted(tc, r, now + 2 * H)                # window over
                assert not await eng._muted(tc, o, now + 3 * H)                # between windows
                assert await eng._muted(tc, o, now - 14 * 24 * H + H // 2)     # inside recurring
                assert await eng._muted(tc, o, now - 7 * 24 * H + H // 2)      # next week's repeat
                assert not await eng._muted(tc, o, now - 7 * 24 * H + 2 * H)   # past the repeat's end
        finally:
            await pools.close()
    run(go())


async def _rule_named(tc, o, name):
    return await tc.fetchval(
        "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
        " VALUES ($1,$2,$3,'lo',1,'warning') RETURNING id", o["org"], o["tag"], name)
