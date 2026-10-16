"""RLS coverage: every public table with an org_id column is held to the same bar.

New tables (every later phase) are picked up automatically from pg_catalog, so a
migration that forgets RLS fails here instead of leaking across tenants.
"""

from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import SYSTEM_DSN, make_pools, run

_TENANT_TABLES_SQL = """
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
ORDER BY 1
"""


def _catalog(sql: str, *args):
    async def go():
        conn = await asyncpg.connect(SYSTEM_DSN)
        try:
            return await conn.fetch(sql, *args)
        finally:
            await conn.close()
    return run(go())


def _tables() -> list[str]:
    return [r["relname"] for r in _catalog(_TENANT_TABLES_SQL)]


def test_there_are_tenant_tables():
    assert len(_tables()) >= 20


def test_every_org_id_table_has_forced_rls():
    bad = [r["relname"] for r in _catalog(_TENANT_TABLES_SQL)
           if not (r["relrowsecurity"] and r["relforcerowsecurity"])]
    assert not bad, f"RLS not enabled+forced: {bad}"


def test_every_org_id_table_checks_writes_and_reads():
    rows = _catalog("""
        SELECT c.relname, p.polcmd::text AS polcmd, p.polqual IS NOT NULL AS has_using,
               p.polwithcheck IS NOT NULL AS has_check
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relnamespace = 'public'::regnamespace""")
    read, write = set(), set()
    for r in rows:
        if r["polcmd"] in ("r", "*") and r["has_using"]:
            read.add(r["relname"])
        if r["polcmd"] in ("a", "w", "*") and (r["has_check"] or r["has_using"] and r["polcmd"] == "w"):
            write.add(r["relname"])
    t = set(_tables())
    assert not (t - read), f"no read (USING) policy: {sorted(t - read)}"
    assert not (t - write), f"no write (WITH CHECK) policy: {sorted(t - write)}"


def test_cross_org_read_and_write_blocked_on_every_table(two_orgs):
    a, b = two_orgs
    tables = _tables()
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                for t in tables:
                    if t == "organizations":
                        continue
                    try:  # system-only tables (e.g. webhook_cursor) have no app grant
                        async with tc.conn.transaction():
                            seen = await tc.fetchval(
                                f"SELECT count(*) FROM {t} WHERE org_id = $1", a["org"])
                    except asyncpg.InsufficientPrivilegeError:
                        seen = 0
                    assert seen == 0, f"{t}: org B read org A rows"
                    # A cross-org UPDATE must touch nothing (policy USING hides the rows).
                    for verb, sql in (("UPDATE", f"UPDATE {t} SET org_id = org_id WHERE org_id = $1"),
                                      ("DELETE", f"DELETE FROM {t} WHERE org_id = $1")):
                        try:  # a missing grant is as good as RLS: nothing is touched either way
                            async with tc.conn.transaction():
                                tag = await tc.execute(sql, a["org"])
                        except asyncpg.InsufficientPrivilegeError:
                            continue
                        assert tag == f"{verb} 0", f"{t}: org B changed org A rows ({tag})"
        finally:
            await pools.close()
    run(go())
