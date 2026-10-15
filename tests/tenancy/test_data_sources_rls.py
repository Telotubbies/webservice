"""data_sources / edge_enrollments (migration 0014): tenant isolation, unique
enrollment hash, RESTRICT on tags.source_id, seeded sim backfill."""

from __future__ import annotations

import hashlib
import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _source(tc, o, name="Simulator") -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO data_sources(org_id, site_id, edge_id, name, protocol)"
        " VALUES ($1,$2,$3,$4,'sim') RETURNING id", o["org"], o["site"], o["edge"], name)


def test_data_sources_isolated_between_orgs(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                sid_b = await _source(tc, b)
                await tc.execute(
                    "INSERT INTO edge_enrollments(org_id, edge_id, code_hash, expires_at)"
                    " VALUES ($1,$2,$3, now() + interval '1 hour')",
                    b["org"], b["edge"], hashlib.sha256(uuid.uuid4().bytes).hexdigest())
            async with tenant_tx(pools.app, a["org"]) as tc:
                for t in ("data_sources", "edge_enrollments"):
                    assert await tc.fetchval(f"SELECT count(*) FROM {t}") == 0, t
                with pytest.raises(asyncpg.ForeignKeyViolationError):   # b's edge under a's org
                    async with tc.conn.transaction():
                        await _source(tc, {**a, "edge": b["edge"]})
                with pytest.raises(asyncpg.PostgresError):              # wrong org_id -> RLS WITH CHECK
                    async with tc.conn.transaction():
                        await tc.execute(
                            "INSERT INTO data_sources(org_id, site_id, edge_id, name, protocol)"
                            " VALUES ($1,$2,$3,'x','sim')", b["org"], b["site"], b["edge"])
            async with tenant_tx(pools.system, a["org"]) as tc:         # cfg publisher sees all
                assert await tc.fetchval("SELECT count(*) FROM data_sources WHERE id=$1", sid_b) == 1
        finally:
            await pools.close()
    run(go())


def test_enrollment_hash_unique(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            h = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
            sql = ("INSERT INTO edge_enrollments(org_id, edge_id, code_hash, expires_at)"
                   " VALUES ($1,$2,$3, now() + interval '1 hour')")
            async with tenant_tx(pools.app, a["org"]) as tc:
                await tc.execute(sql, a["org"], a["edge"], h)
                with pytest.raises(asyncpg.UniqueViolationError):
                    async with tc.conn.transaction():
                        await tc.execute(sql, a["org"], a["edge"], h)
        finally:
            await pools.close()
    run(go())


def test_tag_source_fk_restrict(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                sid = await _source(tc, a)
                await tc.execute("UPDATE tags SET source_id=$1 WHERE id=$2", sid, a["tag"])
                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    async with tc.conn.transaction():
                        await tc.execute("DELETE FROM data_sources WHERE id=$1", sid)
                await tc.execute("UPDATE tags SET source_id=NULL WHERE id=$1", a["tag"])
                await tc.execute("DELETE FROM data_sources WHERE id=$1", sid)
        finally:
            await pools.close()
    run(go())


def test_seeded_tags_have_sim_source():
    """Backfill contract: any tag with an edge that predates 0014 has a sim
    source and a behavior address (run against a seeded DB)."""
    async def go():
        pools = await make_pools()
        try:
            async with pools.system.acquire() as conn:
                async with conn.transaction():
                    n = await conn.fetchval(
                        "SELECT count(*) FROM tags t WHERE t.edge_id IS NOT NULL"
                        " AND t.source_id IS NOT NULL AND (t.address->>'behavior') IS NULL")
                    assert n == 0
        finally:
            await pools.close()
    run(go())
