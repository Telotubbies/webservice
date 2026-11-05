"""organizations.slug / timezone / language constraints (migration 0014)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _insert(tc, **cols):
    org = tc.org_id
    names = ["id", "name", *cols]
    vals = [org, "x", *cols.values()]
    ph = ",".join(f"${i + 1}" for i in range(len(vals)))
    await tc.execute(f"INSERT INTO organizations({','.join(names)}) VALUES ({ph})", *vals)


def _expect(exc, **cols):
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(exc):
                async with tenant_tx(pools.app, uuid.uuid4()) as tc:
                    await _insert(tc, **cols)
        finally:
            await pools.close()
    run(go())


def test_slug_unique_across_orgs():
    from app.db.context import tenant_tx
    slug = "uniq-" + uuid.uuid4().hex[:8]

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, uuid.uuid4()) as tc:
                await _insert(tc, slug=slug)
            with pytest.raises(asyncpg.UniqueViolationError):
                async with tenant_tx(pools.app, uuid.uuid4()) as tc:
                    await _insert(tc, slug=slug)
        finally:
            await pools.close()
    run(go())


@pytest.mark.parametrize("bad", ["Bad Slug", "ab", "a" * 41, "-lead", "trail-", "dou--ble"])
def test_slug_format_check(bad):
    _expect(asyncpg.CheckViolationError, slug=bad)


def test_language_check():
    _expect(asyncpg.CheckViolationError, language="fr")


def test_default_slug_is_valid_and_unique():
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            slugs = []
            for _ in range(2):
                o = uuid.uuid4()
                async with tenant_tx(pools.app, o) as tc:
                    await tc.execute("INSERT INTO organizations(id, name) VALUES ($1,'x')", o)
                    slugs.append(await tc.fetchval("SELECT slug FROM organizations WHERE id=$1", o))
            assert len(set(slugs)) == 2 and all(len(s) >= 3 for s in slugs)
        finally:
            await pools.close()
    run(go())
