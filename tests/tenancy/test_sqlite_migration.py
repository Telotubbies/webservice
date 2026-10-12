"""scripts/migrate_sqlite_to_pg.py gate (doc 18 §3): dry-run, real import into a
scratch org, idempotent re-run, audit genesis + chain intact. Runs as wds_app —
the script gets no privileges the API doesn't have.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import APP_DSN, SYSTEM_DSN, make_pools, run

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "migrate_sqlite_to_pg.py"


def _fixture_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript("""
    CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      description TEXT, unit TEXT, writable INTEGER DEFAULT 0,
      adapter TEXT, stale_after_s INTEGER DEFAULT 15, created_at TEXT);
    CREATE TABLE alarm_rules(id INTEGER PRIMARY KEY, tag_id INTEGER,
      name TEXT NOT NULL, condition TEXT NOT NULL, severity TEXT NOT NULL,
      enabled INTEGER DEFAULT 1);
    CREATE TABLE alarms(id INTEGER PRIMARY KEY, rule_id INTEGER, tag_id INTEGER,
      raised_at TEXT, acked_at TEXT, acked_by TEXT, cleared_at TEXT,
      snapshot_url TEXT, status TEXT);
    CREATE TABLE commands(id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE,
      user_id TEXT, tag TEXT, value TEXT, status TEXT, issued_at TEXT,
      completed_at TEXT, result TEXT);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY, ts TEXT, user_id TEXT,
      action TEXT, detail TEXT, ip TEXT);
    CREATE TABLE tags_latest(tag TEXT PRIMARY KEY, v REAL, q TEXT, ts TEXT, src TEXT);
    CREATE TABLE tags_history(tag TEXT NOT NULL, ts TEXT NOT NULL, v REAL, q TEXT, src TEXT);
    """)
    conn.executemany(
        "INSERT INTO tags(id,name,unit,writable,adapter) VALUES (?,?,?,?,?)", [
            (1, "plant1.sort.line1.motor1.running", "bool", 1, "sim"),
            (2, "plant1.sort.line1.conv1.temp_c", "degC", 0, "sim"),
        ])
    conn.execute("INSERT INTO alarm_rules VALUES (1,2,'overtemp','value > 80','critical',1)")
    conn.execute("INSERT INTO alarms VALUES (1,1,2,'2026-01-01T00:00:00Z',"
                 "NULL,NULL,NULL,NULL,'active')")
    conn.execute("INSERT INTO alarms VALUES (2,1,2,'2026-01-01T00:05:00Z',"
                 "'2026-01-01T00:06:00Z','demo-operator','2026-01-01T00:10:00Z',"
                 "NULL,'cleared')")
    conn.execute(
        "INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), "k1", "demo-operator",
         "plant1.sort.line1.motor1.running", "true", "done",
         "2026-01-01T00:01:00Z", "2026-01-01T00:01:01Z", '{"status":"done"}'))
    conn.executemany("INSERT INTO tags_latest VALUES (?,?,?,?,?)", [
        ("plant1.sort.line1.motor1.running", 1.0, "good", "2026-01-01T00:00:00Z", "sim"),
        ("plant1.sort.line1.conv1.temp_c", 81.2, "good", "2026-01-01T00:00:00Z", "sim")])
    conn.execute("INSERT INTO tags_history VALUES"
                 " ('plant1.sort.line1.conv1.temp_c','2026-01-01T00:00:00Z',81.2,'good','sim')")
    conn.execute("INSERT INTO audit_log VALUES (1,'2026-01-01T00:00:00Z',"
                 "'demo-operator','command.issue','{}','127.0.0.1')")
    conn.commit()
    conn.close()


def _run_script(db: Path, org: uuid.UUID, *extra: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env.pop("WDS_APP_DSN", None)
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--sqlite", str(db),
         "--dsn", APP_DSN, "--org-id", str(org), *extra],
        env=env, capture_output=True, text=True, timeout=60)


def test_sqlite_migration_dry_run_and_idempotent_import(tmp_path):
    db = tmp_path / "app.db"
    _fixture_db(db)
    org = uuid.uuid4()

    r = _run_script(db, org, "--dry-run")
    assert r.returncode == 0, r.stderr
    assert "tags=2" in r.stdout and "dry-run" in r.stdout

    r = _run_script(db, org)
    assert r.returncode == 0, r.stderr

    async def check():
        pools = await make_pools()
        try:
            from app.db.context import tenant_tx
            async with tenant_tx(pools.app, org) as tc:
                assert await tc.fetchval(
                    "SELECT name FROM organizations WHERE id=$1", org) == "Demo"
                assert await tc.fetchval(
                    "SELECT status FROM edges WHERE org_id=$1 AND name='edge1'",
                    org) == "pending"
                assert await tc.fetchval(
                    "SELECT count(*) FROM tags WHERE org_id=$1", org) == 2
                assert await tc.fetchval(
                    "SELECT count(*) FROM tag_history WHERE org_id=$1", org) == 1
                assert await tc.fetchval(
                    "SELECT count(*) FROM tag_latest WHERE org_id=$1", org) == 2
                # doc 16 §3 status mapping: v1 'done' -> 'acknowledged'
                row = await tc.fetchrow(
                    "SELECT status, reason FROM commands WHERE org_id=$1", org)
                assert row["status"] == "acknowledged"
                # cleared alarm carries its v1 acked_by mapped to a users row
                arow = await tc.fetchrow(
                    "SELECT acked_by, state FROM alarms WHERE org_id=$1"
                    " AND state='cleared'", org)
                assert arow is not None and arow["acked_by"] is not None
                assert await tc.fetchval(
                    "SELECT count(*) FROM audit_log WHERE org_id=$1", org) == 2
                gen = await tc.fetchrow(
                    "SELECT detail FROM audit_log WHERE org_id=$1"
                    " AND action='migration.import'", org)
                assert gen["detail"]["sqlite_sha256"]
        finally:
            await pools.close()
    run(check())

    # idempotent: second import inserts nothing
    r = _run_script(db, org)
    assert r.returncode == 0, r.stderr
    assert "+0" in r.stdout and "genesis exists" in r.stdout

    async def check_unchanged():
        pools = await make_pools()
        try:
            from app.db.context import tenant_tx
            async with tenant_tx(pools.app, org) as tc:
                assert await tc.fetchval(
                    "SELECT count(*) FROM edges WHERE org_id=$1", org) == 1
                assert await tc.fetchval(
                    "SELECT count(*) FROM audit_log WHERE org_id=$1", org) == 2
        finally:
            await pools.close()
    run(check_unchanged())

    # audit chain still verifies for the migrated org
    async def verify():
        from app.db import audit
        pools = await make_pools()
        try:
            breaks = await audit.verify(pools.system)
        finally:
            await pools.close()
        assert not any(b.org_id == org for b in breaks), breaks
    run(verify())
