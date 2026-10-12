"""Audit integrity gate (doc 18 §4): append-only + per-org hash chain."""

from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import APP_DSN, SUPER_DSN, SYSTEM_DSN, make_pools, run


def _append_n(pools, org, n):
    from app.db import audit
    from app.db.context import tenant_tx

    async def go():
        async with tenant_tx(pools.app, org) as tc:
            for i in range(n):
                await audit.append(tc, "user:test", "test.event", {"i": i}, {"note": "ü"})
    return go()


@pytest.mark.parametrize("dsn", [APP_DSN, SYSTEM_DSN], ids=["wds_app", "wds_system"])
def test_update_delete_truncate_denied(two_orgs, dsn):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            await _append_n(pools, a["org"], 1)
        finally:
            await pools.close()
        conn = await asyncpg.connect(dsn)
        try:
            for sql in ("UPDATE audit_log SET actor='x'", "DELETE FROM audit_log",
                        "TRUNCATE audit_log", "UPDATE command_events SET actor='x'"):
                async with conn.transaction():
                    await conn.execute("SELECT set_config('app.org_id', $1, true)", str(a["org"]))
                    with pytest.raises(asyncpg.InsufficientPrivilegeError):
                        await conn.execute(sql)
        finally:
            await conn.close()
    run(go())


def test_chain_is_linear_and_verifies(two_orgs):
    a, b = two_orgs
    from app.db import audit
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            await _append_n(pools, a["org"], 5)
            await _append_n(pools, b["org"], 3)
            async with tenant_tx(pools.app, a["org"]) as tc:
                rows = await tc.fetch("SELECT seq, prev_hash, hash FROM audit_log ORDER BY seq")
            assert [r["seq"] for r in rows] == list(range(1, len(rows) + 1))
            for prev, cur in zip(rows, rows[1:]):
                assert cur["prev_hash"] == prev["hash"]
            assert rows[0]["prev_hash"] is None
            assert [x for x in await audit.verify(pools.system)
                    if x.org_id in (a["org"], b["org"])] == []
        finally:
            await pools.close()
    run(go())


def test_app_cannot_forge_chain_fields(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                await tc.execute(
                    "INSERT INTO audit_log(org_id, actor, action, seq, hash, prev_hash)"
                    " VALUES ($1,'u','forge', 999, 'deadbeef', 'cafe')", a["org"])
                r = await tc.fetchrow(
                    "SELECT seq, hash, prev_hash FROM audit_log WHERE action='forge'")
            assert r["seq"] == 1 and r["hash"] != "deadbeef" and r["prev_hash"] is None
        finally:
            await pools.close()
    run(go())


def test_tamper_is_detected(two_orgs):
    """Simulates a superuser-level attacker editing history (trigger disabled)."""
    if not SUPER_DSN:
        pytest.skip("WDS_TEST_SUPER_DSN not set")
    a, _ = two_orgs
    from app.db import audit

    async def go():
        pools = await make_pools()
        try:
            await _append_n(pools, a["org"], 3)
            su = await asyncpg.connect(SUPER_DSN)
            try:
                async with su.transaction():
                    await su.execute("ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable")
                    await su.execute("UPDATE audit_log SET actor='attacker'"
                                     " WHERE org_id=$1 AND seq=2", a["org"])
                    await su.execute("ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable")
            finally:
                await su.close()
            breaks = [x for x in await audit.verify(pools.system) if x.org_id == a["org"]]
            assert [(x.seq, x.reason) for x in breaks] == [(2, "hash mismatch (row altered)")]
        finally:
            await pools.close()
    run(go())
