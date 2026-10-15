"""RLS / role / schema-integrity gate (ADR-13 §7). Runs as wds_app / wds_system."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import APP_DSN, SYSTEM_DSN, make_org, make_pools, run

REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------- context

def test_no_context_no_rows(two_orgs):
    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            for t in ("organizations", "sites", "edges", "tags", "commands",
                      "insights", "audit_log", "dashboards"):
                assert await conn.fetchval(f"SELECT count(*) FROM {t}") == 0, t
            with pytest.raises(asyncpg.InsufficientPrivilegeError):  # RLS WITH CHECK
                await conn.execute("INSERT INTO organizations(id, name) VALUES ($1,'x')",
                                   uuid.uuid4())
        finally:
            await conn.close()
    run(go())


def test_empty_context_no_rows(two_orgs):
    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            async with conn.transaction():
                await conn.execute("SELECT set_config('app.org_id', '', true)")
                assert await conn.fetchval("SELECT count(*) FROM sites") == 0
        finally:
            await conn.close()
    run(go())


def test_context_sees_only_own_org(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                sites = {r["id"] for r in await tc.fetch("SELECT id FROM sites")}
                assert a["site"] in sites and b["site"] not in sites
                assert await tc.fetchrow("SELECT 1 FROM tags WHERE id=$1", b["tag"]) is None
                assert await tc.fetchrow(
                    "SELECT 1 FROM insights WHERE id=$1", b["insight"]) is None
                # update of a foreign row is a silent no-op, not a write
                assert await tc.execute(
                    "UPDATE tags SET name='pwn' WHERE id=$1", b["tag"]) == "UPDATE 0"
        finally:
            await pools.close()
    run(go())


def test_pool_reuse_no_leak(two_orgs):
    """max_size=1 → the same physical connection serves A's tx then a bare query."""
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools(max_size=1)
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                assert await tc.fetchval("SELECT count(*) FROM sites") >= 1
            async with pools.app.acquire() as conn:  # no context
                assert await conn.fetchval(
                    "SELECT current_setting('app.org_id', true)") in (None, "")
                assert await conn.fetchval("SELECT count(*) FROM sites") == 0
            async with tenant_tx(pools.app, b["org"]) as tc:
                assert await tc.fetchrow("SELECT 1 FROM sites WHERE id=$1", a["site"]) is None
        finally:
            await pools.close()
    run(go())


def test_context_ends_with_failed_transaction(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools(max_size=1)
        try:
            with pytest.raises(RuntimeError):
                async with tenant_tx(pools.app, a["org"]):
                    raise RuntimeError("boom")
            async with pools.app.acquire() as conn:
                assert await conn.fetchval("SELECT count(*) FROM sites") == 0
        finally:
            await pools.close()
    run(go())


def test_tenant_tx_rejects_non_uuid():
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            for bad in ("", None, "11111111-1111-1111-1111-111111111111"):
                with pytest.raises(TypeError):
                    async with tenant_tx(pools.app, bad):  # type: ignore[arg-type]
                        pass
        finally:
            await pools.close()
    run(go())


def test_single_call_site():
    """Only backend/app/db/context.py may set app.* context (ADR-13 §2)."""
    pattern = re.compile(r"set_config\(\s*'app\.")
    hits = [p for p in (REPO / "backend" / "app").rglob("*.py")
            if pattern.search(p.read_text())]
    assert [p.relative_to(REPO).as_posix() for p in hits] == ["backend/app/db/context.py"]


# ---------------------------------------------------------------- catalog

def test_force_rls_on_every_tenant_table():
    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            rows = await conn.fetch("""
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
                  AND a.attname = 'org_id' AND NOT a.attisdropped""")
            names = {r["relname"] for r in rows}
            assert {"sites", "tags", "commands", "insights", "audit_log",
                    "memberships"} <= names
            bad = [r["relname"] for r in rows
                   if not (r["relrowsecurity"] and r["relforcerowsecurity"])]
            assert bad == []
            org = await conn.fetchrow(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class"
                " WHERE oid = 'public.organizations'::regclass")
            assert org["relrowsecurity"] and org["relforcerowsecurity"]
        finally:
            await conn.close()
    run(go())


def test_runtime_roles_not_privileged():
    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            for role in ("wds_app", "wds_system"):
                r = await conn.fetchrow(
                    "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb"
                    " FROM pg_roles WHERE rolname=$1", role)
                assert not any(r.values()), role
                owned = await conn.fetchval(
                    "SELECT count(*) FROM pg_class WHERE relowner ="
                    " (SELECT oid FROM pg_roles WHERE rolname=$1)", role)
                assert owned == 0, f"{role} owns relations"
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conn.execute("CREATE TABLE evil(x int)")
        finally:
            await conn.close()
    run(go())


# ------------------------------------------------------- schema integrity

def test_composite_fk_rejects_cross_tenant_link(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, b["org"]) as tc:  # B's row, A's site
                    await tc.execute(
                        "INSERT INTO tags(org_id, site_id, path, name, type)"
                        " VALUES ($1,$2,'x/y','x','number')", b["org"], a["site"])
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, b["org"]) as tc:  # B's tag, A's edge
                    await tc.execute(
                        "INSERT INTO tags(org_id, site_id, edge_id, path, name, type)"
                        " VALUES ($1,$2,$3,'x/z','x','number')", b["org"], b["site"], a["edge"])
        finally:
            await pools.close()
    run(go())


def test_edge_must_be_in_same_site_as_tag(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, a["org"]) as tc:
                    other = await tc.fetchval(
                        "INSERT INTO sites(org_id, name, code) VALUES ($1,'s2','plant2')"
                        " RETURNING id", a["org"])
                    await tc.execute(
                        "INSERT INTO tags(org_id, site_id, edge_id, path, name, type)"
                        " VALUES ($1,$2,$3,'a/b','x','number')", a["org"], other, a["edge"])
        finally:
            await pools.close()
    run(go())


def test_alarm_rule_must_match_alarm_tag(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, a["org"]) as tc:
                    t2 = await tc.fetchval(
                        "INSERT INTO tags(org_id, site_id, path, name, type)"
                        " VALUES ($1,$2,'c/d','t2','number') RETURNING id", a["org"], a["site"])
                    rule = await tc.fetchval(
                        "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
                        " VALUES ($1,$2,'r','hi',1,'critical') RETURNING id", a["org"], t2)
                    await tc.execute(
                        "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state, raised_at)"
                        " VALUES ($1,$2,$3,'critical','active',now())", a["org"], a["tag"], rule)
        finally:
            await pools.close()
    run(go())


# ------------------------------------------------------------- insights

def test_insights_fail_closed_then_own_org_only(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            assert await conn.fetchval("SELECT count(*) FROM insights") == 0
        finally:
            await conn.close()
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                ids = {r["id"] for r in await tc.fetch("SELECT id FROM insights")}
                assert a["insight"] in ids and b["insight"] not in ids
                # cross-org update is a silent no-op under RLS
                assert await tc.execute(
                    "UPDATE insights SET severity='critical' WHERE id=$1",
                    b["insight"]) == "UPDATE 0"
        finally:
            await pools.close()
    run(go())


def test_insights_cross_tenant_write_rejected(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with tenant_tx(pools.app, b["org"]) as tc:  # B's org, A's tag
                    await tc.execute(
                        "INSERT INTO insights(org_id, tag_id, kind, severity, ts_start)"
                        " VALUES ($1,$2,'drift','info',now())", b["org"], a["tag"])
            with pytest.raises(asyncpg.InsufficientPrivilegeError):  # RLS WITH CHECK
                async with tenant_tx(pools.app, b["org"]) as tc:  # A's org in B's ctx
                    await tc.execute(
                        "INSERT INTO insights(org_id, tag_id, kind, severity, ts_start)"
                        " VALUES ($1,$2,'drift','info',now())", a["org"], a["tag"])
        finally:
            await pools.close()
    run(go())


def test_insights_one_open_per_tag_kind(two_orgs):
    """insights_open_uq: a second OPEN (org, tag, kind) is rejected; closed is fine."""
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:  # fixture's anomaly is open
                await tc.execute(
                    "INSERT INTO insights(org_id, tag_id, kind, severity, state, ts_start)"
                    " VALUES ($1,$2,'anomaly','info','closed',now())", a["org"], a["tag"])
            with pytest.raises(asyncpg.UniqueViolationError):
                async with tenant_tx(pools.app, a["org"]) as tc:
                    await tc.execute(
                        "INSERT INTO insights(org_id, tag_id, kind, severity, ts_start)"
                        " VALUES ($1,$2,'anomaly','info',now())", a["org"], a["tag"])
        finally:
            await pools.close()
    run(go())


def test_system_role_has_full_insights_access(two_orgs):
    """The engine role reads/writes insights across orgs via system_insights."""
    a, b = two_orgs

    async def go():
        conn = await asyncpg.connect(SYSTEM_DSN)
        try:
            ids = {r["id"] for r in await conn.fetch("SELECT id FROM insights")}
            assert {a["insight"], b["insight"]} <= ids
            await conn.execute(
                "INSERT INTO insights(org_id, tag_id, kind, severity, ts_start)"
                " VALUES ($1,$2,'flatline','info',now())", a["org"], a["tag"])
            assert await conn.execute(
                "UPDATE insights SET state='closed', ts_end=now() WHERE id=$1",
                a["insight"]) == "UPDATE 1"
        finally:
            await conn.close()
    run(go())


# --------------------------------------------------------- system role

def test_system_role_edge_lookup_is_column_limited(two_orgs):
    a, b = two_orgs

    async def go():
        conn = await asyncpg.connect(SYSTEM_DSN)
        try:
            ids = {r["id"] for r in await conn.fetch("SELECT id, org_id, site_id FROM edges")}
            assert {a["edge"], b["edge"]} <= ids          # pre-context identity lookup
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conn.fetch("SELECT name FROM edges")  # not a granted column
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conn.fetch("SELECT name FROM organizations")
            assert await conn.fetchval("SELECT count(*) FROM sites") == 0
            assert await conn.fetchval("SELECT count(*) FROM tags") == 0
        finally:
            await conn.close()
    run(go())


def test_app_role_has_no_system_lookup(two_orgs):
    async def go():
        conn = await asyncpg.connect(APP_DSN)
        try:
            assert await conn.fetchval("SELECT count(*) FROM edges") == 0
        finally:
            await conn.close()
    run(go())


# ------------------------------------------------------- user / invite

def test_user_context_sees_only_member_orgs(two_orgs):
    a, b = two_orgs
    from app.db.context import global_tx, tenant_tx, user_tx

    async def go():
        pools = await make_pools()
        try:
            async with global_tx(pools.app) as conn:
                uid = await conn.fetchval(
                    "INSERT INTO users(sub) VALUES ($1) RETURNING id", f"t-{uuid.uuid4()}")
            async with tenant_tx(pools.app, a["org"]) as tc:
                await tc.execute("INSERT INTO memberships(org_id,user_id,role)"
                                 " VALUES ($1,$2,'viewer')", a["org"], uid)
            async with user_tx(pools.app, uid) as conn:
                orgs = {r["id"] for r in await conn.fetch("SELECT id FROM organizations")}
                assert orgs == {a["org"]}
                assert await conn.fetchval("SELECT count(*) FROM sites") == 0
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await conn.execute("INSERT INTO memberships(org_id,user_id,role)"
                                       " VALUES ($1,$2,'owner')", b["org"], uid)
        finally:
            await pools.close()
    run(go())


def test_invite_context_reads_only_matching_invite(two_orgs):
    import hashlib
    a, b = two_orgs
    from app.db.context import invite_tx, tenant_tx

    async def go():
        pools = await make_pools()
        try:
            hashes = {}
            for o in (a, b):
                h = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
                hashes[o["org"]] = h
                async with tenant_tx(pools.app, o["org"]) as tc:
                    await tc.execute(
                        "INSERT INTO invites(org_id,email,role,token_hash,expires_at)"
                        " VALUES ($1,'x@y','viewer',$2, now() + interval '7 days')",
                        o["org"], h)
            async with invite_tx(pools.app, hashes[a["org"]]) as conn:
                rows = await conn.fetch("SELECT org_id FROM invites")
                assert [r["org_id"] for r in rows] == [a["org"]]
        finally:
            await pools.close()
    run(go())
