"""Shared fixtures for the security verification suite (v4 T13).

Conventions match tests/integration: everything here is marked
`integration` (needs the live compose stack — `make up-test`), and the
`security` marker lets `make test-security` select it.

Safety boundary (ICS doctrine): the suite exercises ONLY the SaaS surface
— org A/B REST + WS + the test-profile `tester` MQTT identity — and the
command path only through the normal guarded REST lifecycle. Nothing
fuzzes the edge/PLC-facing side.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from conftest import (  # noqa: E402 — root tests/conftest.py
    ADMIN_TOKEN, OPERATOR_TOKEN, VIEWER_TOKEN,
)

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")
WEB_URL = os.environ.get("WEB_URL", "http://localhost:5173").rstrip("/")

# dev-token user ids (backend/app/ops/seed.py DEMO_USERS)
ADMIN_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d003")
VIEWER_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d002")
OPERATOR_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d001")


@pytest.fixture(scope="session")
def web_url() -> str:
    return WEB_URL


@pytest.fixture(scope="session")
def app_dsn() -> str:
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set — run under `make test-security`")
    return APP_DSN


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        yield c


async def _tenant_conn(dsn, org_id):
    """wds_app connection inside a tenant context — same RLS the app uses."""
    import asyncpg
    conn = await asyncpg.connect(dsn)
    await conn.execute("BEGIN")
    await conn.execute("SELECT set_config('app.org_id', $1, true)", str(org_id))
    return conn


@pytest.fixture(scope="module")
def org_b(base_url, app_dsn):
    """Org B: site + active edge + writable tag + rule + active alarm +
    insight, with demo-admin (admin) and demo-viewer (viewer) as members.
    demo-operator deliberately stays shim-org-only — it is the BOLA probe
    identity. Same construction as tests/integration/test_tenancy.py."""
    import asyncpg  # noqa: F401 — checked here so the skip is clean

    async def go():
        org, site, edge = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        conn = await _tenant_conn(app_dsn, org)
        try:
            await conn.execute(
                "INSERT INTO organizations(id, name) VALUES ($1, $2)",
                org, f"sec-org-b-{uuid.uuid4().hex[:8]}")
            await conn.execute(
                "INSERT INTO sites(id, org_id, name, code)"
                " VALUES ($1,$2,'Site B','b_site')", site, org)
            await conn.execute(
                "INSERT INTO edges(id, org_id, site_id, name, status)"
                " VALUES ($1,$2,$3,'edge-b','active')", edge, org, site)
            tag = await conn.fetchval(
                "INSERT INTO tags(org_id, site_id, edge_id, path, name, type,"
                " writable) VALUES ($1,$2,$3,'b/line1/motor1/run',"
                " 'b-motor-run','bool',true) RETURNING id", org, site, edge)
            rule = await conn.fetchval(
                "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold,"
                " severity) VALUES ($1,$2,'b-hi','hi',0.5,'warning')"
                " RETURNING id", org, tag)
            alarm = await conn.fetchval(
                "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state,"
                " raised_at) VALUES ($1,$2,$3,'warning','active',now())"
                " RETURNING id", org, tag, rule)
            insight = await conn.fetchval(
                "INSERT INTO insights(org_id, tag_id, kind, severity, score,"
                " ts_start) VALUES ($1,$2,'anomaly','warning',0.9,now())"
                " RETURNING id", org, tag)
            for uid, role in ((ADMIN_UID, "admin"), (VIEWER_UID, "viewer")):
                await conn.execute(
                    "INSERT INTO memberships(org_id, user_id, role)"
                    " VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id)"
                    " DO NOTHING", org, uid, role)
            await conn.execute("COMMIT")
        except Exception:
            await conn.execute("ROLLBACK")
            raise
        finally:
            await conn.close()
        return {"org": str(org), "site": str(site), "edge": str(edge),
                "tag": str(tag), "rule": str(rule), "alarm": str(alarm),
                "insight": str(insight)}

    return asyncio.run(go())
