"""DB-level isolation fixtures (ADR-13 §7).

Connects as the REAL runtime roles — never superuser/owner — because RLS
tests run as a privileged role prove nothing.

Env (skips when WDS_TEST_APP_DSN is unset):
  WDS_TEST_APP_DSN     postgresql://wds_app:…@127.0.0.1:5433/wds
  WDS_TEST_SYSTEM_DSN  postgresql://wds_system:…@127.0.0.1:5433/wds
  WDS_TEST_SUPER_DSN   optional — only for the tamper-detection test, which must
                       bypass the immutability trigger to simulate an attacker
                       with superuser access.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")
SYSTEM_DSN = os.environ.get("WDS_TEST_SYSTEM_DSN", "")
SUPER_DSN = os.environ.get("WDS_TEST_SUPER_DSN", "")




def run(coro):
    return asyncio.run(coro)


@pytest.fixture(scope="session", autouse=True)
def _require_db():
    if not APP_DSN or not SYSTEM_DSN:
        pytest.skip("WDS_TEST_APP_DSN / WDS_TEST_SYSTEM_DSN not set — skipping DB tests")


async def make_pools(max_size: int = 4):
    from app.db.pool import create_pools
    return await create_pools(APP_DSN, SYSTEM_DSN, min_size=1, max_size=max_size)


async def make_org(pool, name: str = "org") -> dict:
    """Create org + site + edge + tag + one open insight via the real app role."""
    from app.db.context import tenant_tx
    org = uuid.uuid4()
    async with tenant_tx(pool, org) as tc:
        await tc.execute("INSERT INTO organizations(id, name) VALUES ($1, $2)", org, name)
        site = await tc.fetchval(
            "INSERT INTO sites(org_id, name, code) VALUES ($1, 's', 'plant1') RETURNING id", org)
        edge = await tc.fetchval(
            "INSERT INTO edges(org_id, site_id, name, status) VALUES ($1,$2,'e','active') RETURNING id",
            org, site)
        tag = await tc.fetchval(
            "INSERT INTO tags(org_id, site_id, edge_id, path, name, type, writable)"
            " VALUES ($1,$2,$3,'sort/line1/motor1/running','running','bool',true) RETURNING id",
            org, site, edge)
        insight = await tc.fetchval(
            "INSERT INTO insights(org_id, tag_id, kind, severity, score, ts_start)"
            " VALUES ($1,$2,'anomaly','warning',0.87,now()) RETURNING id",
            org, tag)
    return {"org": org, "site": site, "edge": edge, "tag": tag, "insight": insight}


@pytest.fixture()
def two_orgs():
    async def go():
        pools = await make_pools()
        try:
            return await make_org(pools.app, "A"), await make_org(pools.app, "B")
        finally:
            await pools.close()
    return run(go())
