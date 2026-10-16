"""Teams + incidents schema: tenant isolation, composite-FK scoping, state
integrity CHECKs, immutable timeline, and referential cleanup."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _user_in_org(tc, org) -> uuid.UUID:
    uid = await tc.fetchval("INSERT INTO users(sub) VALUES ($1) RETURNING id", f"t-{uuid.uuid4()}")
    await tc.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,'operator')", org, uid)
    return uid


async def _incident(tc, org, **kw) -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO incidents(org_id, title, severity, created_by, alarm_id, owner_team_id)"
        " VALUES ($1,'belt jam','critical',$2,$3,$4) RETURNING id",
        org, uuid.uuid4(), kw.get("alarm"), kw.get("team"))


async def _alarm(tc, o) -> uuid.UUID:
    rule = await tc.fetchval(
        "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
        " VALUES ($1,$2,'r','hi',1,'warning') RETURNING id", o["org"], o["tag"])
    return await tc.fetchval(
        "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state, raised_at)"
        " VALUES ($1,$2,$3,'warning','active',now()) RETURNING id", o["org"], o["tag"], rule)


def test_isolation_and_cross_org_links_rejected(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                alarm_b = await _alarm(tc, b)
                team_b = await tc.fetchval("INSERT INTO teams(org_id, name) VALUES ($1,'ops') RETURNING id", b["org"])
                await _incident(tc, b["org"])
            async with tenant_tx(pools.app, a["org"]) as tc:
                for t in ("teams", "team_members", "incidents", "incident_events"):
                    assert await tc.fetchval(f"SELECT count(*) FROM {t}") == 0, t
                with pytest.raises(asyncpg.ForeignKeyViolationError):   # b's alarm, a's incident
                    async with tc.conn.transaction():
                        await _incident(tc, a["org"], alarm=alarm_b)
                with pytest.raises(asyncpg.ForeignKeyViolationError):   # b's team as a's owner
                    async with tc.conn.transaction():
                        await _incident(tc, a["org"], team=team_b)
        finally:
            await pools.close()
    run(go())


def test_status_timestamps_must_agree(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                iid = await _incident(tc, a["org"])
                for bad in ("UPDATE incidents SET status='resolved' WHERE id=$1",              # no resolved_at
                            "UPDATE incidents SET resolved_at=now() WHERE id=$1",              # open + resolved_at
                            "UPDATE incidents SET status='acknowledged' WHERE id=$1",          # no acked_at
                            "UPDATE incidents SET status='bogus' WHERE id=$1"):
                    with pytest.raises(asyncpg.CheckViolationError):
                        async with tc.conn.transaction():
                            await tc.execute(bad, iid)
                await tc.execute("UPDATE incidents SET status='resolved', acked_at=now(), resolved_at=now() WHERE id=$1", iid)
        finally:
            await pools.close()
    run(go())


def test_timeline_is_append_only(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                iid = await _incident(tc, a["org"])
                eid = await tc.fetchval(
                    "INSERT INTO incident_events(org_id, incident_id, kind, author_id, body)"
                    " VALUES ($1,$2,'note',$3,'checked belt') RETURNING id", a["org"], iid, uuid.uuid4())
                for stmt in ("UPDATE incident_events SET body='edited' WHERE id=$1",
                             "DELETE FROM incident_events WHERE id=$1"):
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        async with tc.conn.transaction():
                            await tc.execute(stmt, eid)
        finally:
            await pools.close()
    run(go())


def test_cleanup_cascades_and_set_null(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                uid = await _user_in_org(tc, a["org"])
                team = await tc.fetchval("INSERT INTO teams(org_id, name) VALUES ($1,'Maint') RETURNING id", a["org"])
                await tc.execute("INSERT INTO team_members(org_id, team_id, user_id) VALUES ($1,$2,$3)", a["org"], team, uid)
                with pytest.raises(asyncpg.UniqueViolationError):                      # case-insensitive name
                    async with tc.conn.transaction():
                        await tc.execute("INSERT INTO teams(org_id, name) VALUES ($1,'maint')", a["org"])
                with pytest.raises(asyncpg.ForeignKeyViolationError):                  # not an org member
                    async with tc.conn.transaction():
                        await tc.execute("INSERT INTO team_members(org_id, team_id, user_id) VALUES ($1,$2,$3)",
                                         a["org"], team, uuid.uuid4())
                iid = await _incident(tc, a["org"], team=team, alarm=await _alarm(tc, a))
                # removing the org membership drops the team membership
                await tc.execute("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", a["org"], uid)
                assert await tc.fetchval("SELECT count(*) FROM team_members") == 0
                # deleting the team keeps the incident, just unowned (org_id must stay set)
                await tc.execute("DELETE FROM teams WHERE id=$1", team)
                row = await tc.fetchrow("SELECT org_id, owner_team_id, alarm_id FROM incidents WHERE id=$1", iid)
                assert row["org_id"] == a["org"] and row["owner_team_id"] is None and row["alarm_id"] is not None
        finally:
            await pools.close()
    run(go())
