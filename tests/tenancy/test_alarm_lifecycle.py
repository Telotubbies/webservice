"""Alarm lifecycle (F02): return-to-normal keeps an unacknowledged alarm
(`rtn_unack`), late (back-filled) samples still raise and are marked late, and
deleting a rule keeps its alarm history. Runs the real engine SQL as the
runtime roles."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


class _WS:
    def __init__(self):
        self.sent = []

    def broadcast(self, msg, org_id=None):
        self.sent.append(msg)


class _Registry:
    def by_id(self, _):
        return None


async def _setup(pools, o, kind="hi"):
    from app.alarming.alarms import AlarmEngine, Rule
    from app.db.context import tenant_tx
    name = f"r-{uuid.uuid4().hex[:6]}"
    async with tenant_tx(pools.app, o["org"]) as tc:
        rid = await tc.fetchval(
            "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
            " VALUES ($1,$2,$3,$4,1,'warning') RETURNING id",
            o["org"], o["tag"], name, kind)
    rule = Rule(id=rid, org_id=o["org"], tag_id=o["tag"], name=name, kind=kind,
                threshold=1.0, stale_s=None, deadband=0.0, severity="warning")
    eng = AlarmEngine(pools, _WS(), _Registry())
    eng._rules = {o["tag"]: [rule]}
    return eng, rule


async def _feed(pools, eng, o, v, ts=None):
    from app.db.context import tenant_tx
    async with tenant_tx(pools.system, o["org"]) as tc:
        await eng.evaluate(tc, o["tag"], v, "good", ts or datetime.now(timezone.utc))


async def _rows(pools, o, rule):
    from app.db.context import tenant_tx
    async with tenant_tx(pools.app, o["org"]) as tc:
        return await tc.fetch(
            "SELECT id, state, late, raised_at, cleared_at, acked_at FROM alarms"
            " WHERE rule_id=$1 ORDER BY raised_at", rule.id)


async def _user(pools, o):
    from app.db.context import tenant_tx
    async with tenant_tx(pools.app, o["org"]) as tc:
        return await tc.fetchval(
            "INSERT INTO users(sub, display_name) VALUES ($1,'op') RETURNING id",
            f"t:{uuid.uuid4()}")


async def _ack(pools, eng, o, alarm_id, uid):
    from app.db.context import tenant_tx
    async with tenant_tx(pools.app, o["org"], uid) as tc:
        return await eng.ack(tc, alarm_id, uid, f"user:{uid}")


def test_return_to_normal_keeps_alarm_until_acked(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "active" and al["late"] is False
            t_rtn = datetime.now(timezone.utc).replace(microsecond=0)
            await _feed(pools, eng, a, 0.0, t_rtn)
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "rtn_unack"
            assert al["cleared_at"] == t_rtn          # event time, not wall time
            out = await _ack(pools, eng, a, al["id"], await _user(pools, a))
            assert out["state"] == "cleared"
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "cleared" and al["acked_at"] is not None
        finally:
            await pools.close()
    run(go())


def test_acked_alarm_closes_on_return_to_normal(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            (al,) = await _rows(pools, a, rule)
            assert (await _ack(pools, eng, a, al["id"], await _user(pools, a)))["state"] == "acked"
            await _feed(pools, eng, a, 0.0)
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "cleared"
        finally:
            await pools.close()
    run(go())


def test_rtn_unack_realarms_the_same_episode(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            await _feed(pools, eng, a, 0.0)
            await _feed(pools, eng, a, 5.0)
            rows = await _rows(pools, a, rule)
            assert len(rows) == 1
            assert rows[0]["state"] == "active" and rows[0]["cleared_at"] is None
        finally:
            await pools.close()
    run(go())


def test_rtn_unack_counts_as_open_for_the_one_open_per_rule_index(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            await _feed(pools, eng, a, 0.0)
            async with tenant_tx(pools.system, a["org"]) as tc:
                with pytest.raises(asyncpg.UniqueViolationError):
                    await tc.execute(
                        "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state, raised_at)"
                        " VALUES ($1,$2,$3,'warning','active',now())", a["org"], a["tag"], rule.id)
        finally:
            await pools.close()
    run(go())


def test_late_sample_raises_alarm_marked_late_at_event_time(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            t_late = (datetime.now(timezone.utc) - timedelta(minutes=10)).replace(microsecond=0)
            await _feed(pools, eng, a, 5.0, t_late)
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "active" and al["late"] is True
            assert al["raised_at"] == t_late
            # a late normal sample still cannot resolve it (I1/I2: not "now")
            await _feed(pools, eng, a, 0.0, t_late + timedelta(seconds=1))
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "active"
            # the next fresh normal sample does
            await _feed(pools, eng, a, 0.0)
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "rtn_unack"
            assert eng.ws.sent[0]["late"] is True
        finally:
            await pools.close()
    run(go())


def test_late_sample_does_not_reopen_rtn_unack(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            await _feed(pools, eng, a, 0.0)
            await _feed(pools, eng, a, 5.0, datetime.now(timezone.utc) - timedelta(minutes=5))
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "rtn_unack"
        finally:
            await pools.close()
    run(go())


def test_disabling_rule_closes_open_alarms_including_rtn_unack(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            await _feed(pools, eng, a, 0.0)
            async with tenant_tx(pools.app, a["org"]) as tc:
                assert await eng.close_for_rule(tc, rule) == 1
            (al,) = await _rows(pools, a, rule)
            assert al["state"] == "cleared"
        finally:
            await pools.close()
    run(go())


def test_deleting_rule_keeps_alarm_history(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            await _feed(pools, eng, a, 5.0)
            (al,) = await _rows(pools, a, rule)
            async with tenant_tx(pools.app, a["org"]) as tc:
                name = await tc.fetchval("SELECT name FROM alarm_rules WHERE id=$1", rule.id)
                await eng.close_for_rule(tc, rule)
                await tc.execute("DELETE FROM alarm_rules WHERE id=$1", rule.id)
            async with tenant_tx(pools.app, a["org"]) as tc:
                row = await tc.fetchrow("SELECT rule_id, state FROM alarms WHERE id=$1", al["id"])
                assert row is not None and row["rule_id"] is None
                assert row["state"] == "cleared"
                listed = [x for x in await eng.list_alarms(tc, None, None, 100)
                          if x["id"] == str(al["id"])]
                assert listed and listed[0]["rule"] == name
        finally:
            await pools.close()
    run(go())


def test_replayed_late_samples_are_idempotent(two_orgs):
    """F03 replays spooled telemetry: the same late trip twice, or after the
    episode was already recorded and closed, must not duplicate the alarm."""
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            eng, rule = await _setup(pools, a)
            t_late = (datetime.now(timezone.utc) - timedelta(minutes=10)).replace(microsecond=0)
            await _feed(pools, eng, a, 5.0, t_late)
            await _feed(pools, eng, a, 5.0, t_late)
            assert len(await _rows(pools, a, rule)) == 1
            await _feed(pools, eng, a, 0.0)                   # fresh normal -> rtn_unack
            (al,) = await _rows(pools, a, rule)
            await _ack(pools, eng, a, al["id"], await _user(pools, a))   # -> cleared
            await _feed(pools, eng, a, 5.0, t_late + timedelta(seconds=30))  # replay inside episode
            rows = await _rows(pools, a, rule)
            assert len(rows) == 1 and rows[0]["state"] == "cleared"
        finally:
            await pools.close()
    run(go())
