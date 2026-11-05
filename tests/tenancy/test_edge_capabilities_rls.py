"""RLS for edge_capabilities (migration 0020, plan M1-05 Task 4).

Runs only when WDS_TEST_APP_DSN / WDS_TEST_SYSTEM_DSN are set (see
tenancy/conftest.py) — skipped offline. wds_app may SELECT only; wds_system
writes happen inside tenant_tx so tenant_isolation's WITH CHECK gates them.
"""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

from tenancy.conftest import make_pools

from app.db.context import global_tx, tenant_tx

pytestmark = pytest.mark.db


def run(coro):
    return asyncio.run(coro)


CAPS = {"cpu_cores": 8, "ram_mb": 32768, "device": "cpu",
        "providers": ["CPUExecutionProvider"], "loaded": []}


async def _upsert(pools, org, edge, cpu_cores=CAPS["cpu_cores"]):
    """The shape handle_caps uses: system pool inside tenant_tx."""
    async with tenant_tx(pools.system, org) as tc:
        await tc.execute(
            "INSERT INTO edge_capabilities(org_id, edge_id, reported_at, cpu_cores, ram_mb,"
            " device, providers, loaded) VALUES ($1,$2,now(),$3,$4,$5,$6,$7)"
            " ON CONFLICT (edge_id) DO UPDATE SET reported_at=now(), cpu_cores=EXCLUDED.cpu_cores,"
            " ram_mb=EXCLUDED.ram_mb, device=EXCLUDED.device, providers=EXCLUDED.providers,"
            " loaded=EXCLUDED.loaded",
            org, edge, cpu_cores, CAPS["ram_mb"], CAPS["device"],
            CAPS["providers"], CAPS["loaded"])


def test_system_upsert_insert_then_update(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            await _upsert(pools, a["org"], a["edge"], cpu_cores=8)
            await _upsert(pools, a["org"], a["edge"], cpu_cores=16)   # upsert updates same row
            async with global_tx(pools.system) as c:
                n = await c.fetchval(
                    "SELECT count(*) FROM edge_capabilities WHERE edge_id=$1", a["edge"])
                cpu = await c.fetchval(
                    "SELECT cpu_cores FROM edge_capabilities WHERE edge_id=$1", a["edge"])
            return n, cpu
        finally:
            await pools.close()
    n, cpu = run(go())
    assert n == 1 and cpu == 16


def test_app_reads_own_row_only(two_orgs):
    a, b = two_orgs

    async def go():
        pools = await make_pools()
        try:
            await _upsert(pools, a["org"], a["edge"])
            await _upsert(pools, b["org"], b["edge"])
            async with tenant_tx(pools.app, a["org"]) as tc:
                rows = await tc.fetch("SELECT edge_id FROM edge_capabilities")
            return {r["edge_id"] for r in rows}
        finally:
            await pools.close()
    rows = run(go())
    assert rows == {a["edge"]}                               # org B's row invisible


def test_app_cannot_write(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await tc.execute(
                        "INSERT INTO edge_capabilities(org_id, edge_id, cpu_cores)"
                        " VALUES ($1,$2,4)", a["org"], a["edge"])
        finally:
            await pools.close()
    run(go())


def test_app_cannot_update(two_orgs):
    a, _ = two_orgs

    async def go():
        pools = await make_pools()
        try:
            await _upsert(pools, a["org"], a["edge"])          # system creates the row
            async with tenant_tx(pools.app, a["org"]) as tc:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await tc.execute(
                        "UPDATE edge_capabilities SET cpu_cores=99 WHERE edge_id=$1",
                        a["edge"])
        finally:
            await pools.close()
    run(go())


def test_system_insert_under_wrong_org_context_fails(two_orgs):
    a, b = two_orgs

    async def go():
        pools = await make_pools()
        try:
            # row claims org A but the tenant context is B -> WITH CHECK fails closed
            async with tenant_tx(pools.system, b["org"]) as tc:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await tc.execute(
                        "INSERT INTO edge_capabilities(org_id, edge_id, cpu_cores)"
                        " VALUES ($1,$2,4)", a["org"], a["edge"])
        finally:
            await pools.close()
    run(go())
