"""F20 safeguards (offline, fake DB handles):

- history is kept until an archive of it has been read back and verified (no verified archive, no partition drop)
- a tenant purge needs a finished export (or a staff waiver) and writes a deletion certificate first
- the lifecycle page API reports retention and verified archives
"""

import asyncio
import contextlib
import gzip
import hashlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.lifecycle import archive, offboarding
from app.tenancy import plans


# ---------------- archive files ----------------

ROWS = [("t1", "2026-08-01T00:00:00+00:00", "good", 1.0), ("t1", "2026-08-01T00:01:00+00:00", "good", 2.0)]


def test_archive_round_trip_verifies(tmp_path):
    p = tmp_path / "2026-08.csv.gz"
    n, sha = archive.write_gz_csv(p, ROWS)
    assert n == 2 and archive.verify(p, n, sha)


def test_verify_fails_on_wrong_row_count_wrong_hash_missing_or_corrupt(tmp_path):
    p = tmp_path / "a.csv.gz"
    n, sha = archive.write_gz_csv(p, ROWS)
    assert not archive.verify(p, n + 1, sha)
    assert not archive.verify(p, n, "0" * 64)
    assert not archive.verify(tmp_path / "missing.csv.gz", n, sha)
    p.write_bytes(p.read_bytes()[:-8])                    # truncated gzip
    assert not archive.verify(p, n, sha)


def test_months_before_lists_only_whole_months_that_ended():
    cutoff = datetime(2026, 10, 15, tzinfo=timezone.utc)
    earliest = datetime(2026, 7, 20, tzinfo=timezone.utc)
    assert archive.months_before(cutoff, earliest) == [date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1)]
    assert archive.months_before(cutoff, None) == []


class FakeTc:
    def __init__(self, history=ROWS, existing=None):
        self.history, self.existing, self.executed = history, existing, []

    async def fetchval(self, sql, *a):
        return self.existing

    async def fetch(self, sql, *a):
        return [{"tag_id": r[0], "ts": datetime.fromisoformat(r[1]), "q": r[2], "v": r[3]} for r in self.history]

    async def execute(self, sql, *a):
        self.executed.append((sql, a))


def test_month_is_manifested_only_after_a_verified_write(tmp_path, monkeypatch):
    monkeypatch.setattr(archive.config, "EXPORT_DIR", str(tmp_path), raising=False)
    tc = FakeTc()
    assert asyncio.run(archive.archive_org_month(tc, uuid.uuid4(), date(2026, 8, 1))) is True
    assert any("INSERT INTO archive_manifest" in s for s, _ in tc.executed)


def test_failed_verification_means_no_manifest_row_and_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr(archive.config, "EXPORT_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(archive, "verify", lambda *a, **k: False)
    tc = FakeTc()
    org = uuid.uuid4()
    assert asyncio.run(archive.archive_org_month(tc, org, date(2026, 8, 1))) is False
    assert not tc.executed
    assert not list(Path(tmp_path).rglob("*.csv.gz"))


def test_empty_month_needs_no_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(archive.config, "EXPORT_DIR", str(tmp_path), raising=False)
    assert asyncio.run(archive.archive_org_month(FakeTc(history=[]), uuid.uuid4(), date(2026, 8, 1))) is True


# ---------------- retention keeps data until archived ----------------

class _Conn:
    async def fetch(self, *a):
        return [{"id": uuid.uuid4()}]


class _Pool:
    @contextlib.asynccontextmanager
    async def acquire(self):
        yield _Conn()


class _Pools:
    system = _Pool()


def _prune(monkeypatch, archived):
    drops = []

    @contextlib.asynccontextmanager
    async def fake_tx(pool, org_id, *a, **k):
        yield object()

    async def org_plan(tc, org_id):
        return {"retention_days": 30}

    async def delete_history_batch(tc, cutoff, batch):
        return 0

    async def prune_rollups(*a, **k):
        return 0

    async def archive_before_drop(pools, cutoff):
        return archived

    async def drop(pools, days):
        drops.append(days)

    monkeypatch.setattr(plans, "tenant_tx", fake_tx)
    monkeypatch.setattr(plans, "org_plan", org_plan)
    monkeypatch.setattr(plans, "retention_days", lambda row: 30)
    monkeypatch.setattr(plans, "delete_history_batch", delete_history_batch)
    monkeypatch.setattr(plans.rollup, "prune_rollups", prune_rollups)
    monkeypatch.setattr(plans.archive, "archive_before_drop", archive_before_drop)
    monkeypatch.setattr(plans.rollup, "drop_expired_partitions", drop)
    asyncio.run(plans.retention_prune(_Pools(), batch=10))
    return drops


def test_partitions_are_not_dropped_when_an_archive_cannot_be_verified(monkeypatch):
    assert _prune(monkeypatch, archived=False) == []


def test_partitions_are_dropped_once_everything_is_archived(monkeypatch):
    assert _prune(monkeypatch, archived=True) == [30]


# ---------------- purge needs an export and writes a certificate ----------------

class PurgeTc:
    def __init__(self, *, has_data, has_export, waived=False, org=True):
        self.org = {"name": "Acme", "deleted_at": datetime(2026, 10, 1, tzinfo=timezone.utc),
                    "plan_limits": {"export_waived": True} if waived else {}} if org else None
        self.flags = {"export": has_export, "data": has_data}
        self.inserted = []

    async def fetchrow(self, sql, *a):
        return self.org

    async def fetchval(self, sql, *a):
        if "org_exports" in sql:
            return self.flags["export"]
        if "tag_history" in sql:
            return self.flags["data"]
        return "tip-hash"                                      # audit tip

    async def fetch(self, sql, *a):
        return []                                              # no tables -> empty counts

    async def execute(self, sql, *a):
        self.inserted.append((sql, a))


def _purge(monkeypatch, tc):
    @contextlib.asynccontextmanager
    async def fake_tx(pool, org_id, *a, **k):
        yield tc

    monkeypatch.setattr(offboarding, "tenant_tx", fake_tx)
    asyncio.run(offboarding.require_export_and_certify(_Pools(), uuid.uuid4()))


def test_purge_with_data_and_no_export_is_refused_and_writes_no_certificate(monkeypatch):
    tc = PurgeTc(has_data=True, has_export=False)
    with pytest.raises(RuntimeError, match="export_required"):
        _purge(monkeypatch, tc)
    assert tc.inserted == []


def test_purge_after_an_export_writes_a_certificate_with_a_checkable_hash(monkeypatch):
    tc = PurgeTc(has_data=True, has_export=True)
    _purge(monkeypatch, tc)
    assert len(tc.inserted) == 1 and "org_deletion_certificate" in tc.inserted[0][0]
    args = tc.inserted[0][1]
    org_id, name, counts, tip, note, digest = args[0], args[1], json.loads(args[3]), args[4], args[5], args[6]
    assert name == "Acme" and tip == "tip-hash" and "backups" in note.lower()
    assert digest == offboarding.certificate_hash(org_id, name, counts, tip)


def test_staff_waiver_lets_a_purge_proceed_without_an_export(monkeypatch):
    tc = PurgeTc(has_data=True, has_export=False, waived=True)
    _purge(monkeypatch, tc)
    assert len(tc.inserted) == 1


def test_org_with_no_telemetry_needs_no_export(monkeypatch):
    tc = PurgeTc(has_data=False, has_export=False)
    _purge(monkeypatch, tc)
    assert len(tc.inserted) == 1


def test_already_purged_org_is_a_no_op(monkeypatch):
    tc = PurgeTc(has_data=True, has_export=False, org=False)
    _purge(monkeypatch, tc)
    assert tc.inserted == []


def test_certificate_hash_changes_with_any_input():
    o = uuid.uuid4()
    base = offboarding.certificate_hash(o, "A", {"t": 1}, "tip")
    assert base == offboarding.certificate_hash(o, "A", {"t": 1}, "tip")
    assert base != offboarding.certificate_hash(o, "A", {"t": 2}, "tip")
    assert base != offboarding.certificate_hash(o, "A", {"t": 1}, "tip2")


# ---------------- live: the lifecycle API ----------------

@pytest.mark.integration
def test_lifecycle_api_reports_policy_and_gates_platform_certificates(base_url):
    httpx = pytest.importorskip("httpx")
    from conftest import ADMIN_TOKEN, ORG_ID, VIEWER_TOKEN
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as v:
        r = v.get(f"/api/v1/orgs/{ORG_ID}/lifecycle")
        assert r.status_code == 200
        b = r.json()
        assert set(b) == {"history_days", "policy", "archives"}
        assert {x["data_class"] for x in b["policy"]} >= {"alarms_cleared", "downtimes", "edge_logs", "outbox_sent", "vision_events"}
        assert all(isinstance(x["default_days"], int) and x["default_days"] > 0 for x in b["policy"])
        assert v.get("/api/v1/platform/deletion-certificates").status_code in (401, 403)
    with httpx.Client(base_url=base_url, timeout=10.0) as anon:
        assert anon.get(f"/api/v1/orgs/{ORG_ID}/lifecycle").status_code == 401
