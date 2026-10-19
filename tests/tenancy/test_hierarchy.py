"""ISA-95 hierarchy: areas/grants are tenant-isolated, lines always get an area,
and area_allowed() implements the grant rule (none = everywhere, some = only
those areas, owner/admin = always)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _user(tc, org, role: str) -> uuid.UUID:
    uid = await tc.fetchval(
        "INSERT INTO users(sub) VALUES ($1) RETURNING id", f"t:{uuid.uuid4()}")
    await tc.execute(
        "INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,$3)",
        org, uid, role)
    return uid


async def _equipment(tc, o, area_code: str, tag_path: str):
    """area > line > device > tag; returns (area_id, tag_id)."""
    area = await tc.fetchval(
        "INSERT INTO areas(org_id, site_id, name, code) VALUES ($1,$2,$3,$3)"
        " RETURNING id", o["org"], o["site"], area_code)
    line = await tc.fetchval(
        "INSERT INTO lines(org_id, site_id, area_id, name) VALUES ($1,$2,$3,$4)"
        " RETURNING id", o["org"], o["site"], area, f"l-{area_code}")
    dev = await tc.fetchval(
        "INSERT INTO devices(org_id, line_id, name) VALUES ($1,$2,'m1') RETURNING id",
        o["org"], line)
    tag = await tc.fetchval(
        "INSERT INTO tags(org_id, site_id, edge_id, device_id, path, name, type, writable)"
        " VALUES ($1,$2,$3,$4,$5,'x','bool',true) RETURNING id",
        o["org"], o["site"], o["edge"], dev, tag_path)
    return area, tag


def test_areas_and_grants_isolated(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                area, _ = await _equipment(tc, a, "mix", "sort/l1/m1/run")
                u = await _user(tc, a["org"], "operator")
                await tc.execute(
                    "INSERT INTO area_grants(org_id, user_id, area_id) VALUES ($1,$2,$3)",
                    a["org"], u, area)
            async with tenant_tx(pools.app, b["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM areas") == 0
                assert await tc.fetchval("SELECT count(*) FROM area_grants") == 0
                with pytest.raises(asyncpg.ForeignKeyViolationError):  # a's area, b's org
                    await tc.execute(
                        "INSERT INTO area_grants(org_id, user_id, area_id)"
                        " VALUES ($1,$2,$3)", b["org"], u, area)
        finally:
            await pools.close()
    run(go())


def test_line_without_area_lands_in_default(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                for name in ("l1", "l2"):
                    await tc.execute(
                        "INSERT INTO lines(org_id, site_id, name) VALUES ($1,$2,$3)",
                        a["org"], a["site"], name)
                rows = await tc.fetch(
                    "SELECT a.code FROM lines l JOIN areas a"
                    " ON a.org_id=l.org_id AND a.id=l.area_id")
                assert [r["code"] for r in rows] == ["default", "default"]
                assert await tc.fetchval(
                    "SELECT count(*) FROM areas WHERE code='default'") == 1
        finally:
            await pools.close()
    run(go())


def test_area_with_lines_cannot_be_deleted(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, a["org"]) as tc:
                    area, _ = await _equipment(tc, a, "mix", "sort/l1/m1/run")
                    await tc.execute("DELETE FROM areas WHERE id=$1", area)
        finally:
            await pools.close()
    run(go())


def test_area_allowed_rule(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx
    from app.plant.hierarchy import area_allowed

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                mix, t_mix = await _equipment(tc, a, "mix", "sort/l1/m1/run")
                _, t_pack = await _equipment(tc, a, "pack", "sort/l2/m1/run")
                free = await _user(tc, a["org"], "operator")
                scoped = await _user(tc, a["org"], "operator")
                admin = await _user(tc, a["org"], "admin")
                for u in (scoped, admin):  # admin's grant must not restrict it
                    await tc.execute(
                        "INSERT INTO area_grants(org_id, user_id, area_id)"
                        " VALUES ($1,$2,$3)", a["org"], u, mix)
                # no grants -> everywhere (also a tag in no equipment)
                loose = await tc.fetchval(
                    "INSERT INTO tags(org_id, site_id, edge_id, path, name, type)"
                    " VALUES ($1,$2,$3,'sort/l3/m1/run','x','bool') RETURNING id",
                    a["org"], a["site"], a["edge"])
                assert await area_allowed(tc, free, t_pack)
                assert await area_allowed(tc, free, loose)
                # granted -> only that area
                assert await area_allowed(tc, scoped, t_mix)
                assert not await area_allowed(tc, scoped, t_pack)
                assert not await area_allowed(tc, scoped, loose)
                # owner/admin ignore grants
                assert await area_allowed(tc, admin, t_pack)
        finally:
            await pools.close()
    run(go())
