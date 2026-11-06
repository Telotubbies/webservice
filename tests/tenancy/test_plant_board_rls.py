"""plant_boards / plant_board_captures (migration 0058): tenant isolation,
one draft per model, status/version CHECK, unique published versions."""

from __future__ import annotations


import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run

LAYOUT = {"v": 1, "w": 100, "h": 100, "items": {}}
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 8


async def _board(tc, o, status="draft", version=None, sha="demo-sha"):
    return await tc.fetchval(
        "INSERT INTO plant_boards(org_id, site_id, model_sha, status, version, layout)"
        " VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id", o["org"], o["site"], sha, status, version, LAYOUT)


def test_boards_and_captures_isolated_between_orgs(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                await _board(tc, b)
                await tc.execute(
                    "INSERT INTO plant_board_captures(org_id, site_id, model_sha, part_key, w, h, view, png, box)"
                    " VALUES ($1,$2,'demo-sha','1',10,10,'side',$3,'{}'::jsonb)", b["org"], b["site"], PNG)
            async with tenant_tx(pools.app, a["org"]) as tc:
                for t in ("plant_boards", "plant_board_captures"):
                    assert await tc.fetchval(f"SELECT count(*) FROM {t}") == 0, t
                with pytest.raises(asyncpg.PostgresError):               # b's org id under a's context
                    async with tc.conn.transaction():
                        await _board(tc, b)
                with pytest.raises(asyncpg.ForeignKeyViolationError):    # b's site under a's org
                    async with tc.conn.transaction():
                        await _board(tc, {**a, "site": b["site"]})
        finally:
            await pools.close()
    run(go())


def test_one_draft_and_unique_versions_and_status_check(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                await _board(tc, a)
                with pytest.raises(asyncpg.UniqueViolationError):        # second draft
                    async with tc.conn.transaction():
                        await _board(tc, a)
                await _board(tc, a, "published", 1)
                with pytest.raises(asyncpg.UniqueViolationError):        # same version twice
                    async with tc.conn.transaction():
                        await _board(tc, a, "published", 1)
                await _board(tc, a, "published", 2)
                for status, version in (("draft", 3), ("published", None), ("archived", 1)):
                    with pytest.raises(asyncpg.CheckViolationError):
                        async with tc.conn.transaction():
                            await _board(tc, a, status, version, sha="other-sha")
        finally:
            await pools.close()
    run(go())


def test_draft_upsert_keeps_one_row(two_orgs):
    """The draft upsert the API uses (ON CONFLICT on the partial unique index)."""
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                for w in (100, 200):
                    await tc.fetchrow(
                        "INSERT INTO plant_boards(org_id, site_id, model_id, model_sha, status, layout)"
                        " VALUES ($1,$2,NULL,'demo-sha','draft',$3::jsonb)"
                        " ON CONFLICT (org_id, site_id, model_sha) WHERE status = 'draft'"
                        " DO UPDATE SET layout=EXCLUDED.layout RETURNING *",
                        a["org"], a["site"], {**LAYOUT, "w": w})
                rows = await tc.fetch("SELECT layout FROM plant_boards WHERE status='draft'")
                assert len(rows) == 1 and rows[0]["layout"]["w"] == 200
        finally:
            await pools.close()
    run(go())
