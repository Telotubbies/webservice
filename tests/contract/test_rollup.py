"""Historian helpers (spec 2026-10-19 §6): numeric column, bucket alignment,
rollup source choice. DB behaviour is covered in tests/tenancy/test_historian.py."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.production.rollup import RETAIN_1M_DAYS, floor_to, numeric_value, pick_source

NOW = datetime(2026, 10, 19, 12, 30, 45, tzinfo=timezone.utc)
VERSIONS = Path(__file__).resolve().parents[2] / "backend" / "migrations" / "versions"


@pytest.mark.parametrize("v,want", [
    (3, 3.0), (2.5, 2.5), (-1, -1.0), (True, 1.0), (False, 0.0),
    ("on", None), (None, None), ([1], None), ({"a": 1}, None),
    (float("nan"), None), (float("inf"), None), (float("-inf"), None),
])
def test_numeric_value(v, want):
    assert numeric_value(v) == want


def test_floor_to_is_utc_aligned():
    assert floor_to(NOW, 60) == datetime(2026, 10, 19, 12, 30, tzinfo=timezone.utc)
    assert floor_to(NOW, 3600) == datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
    assert floor_to(floor_to(NOW, 3600), 3600) == floor_to(NOW, 3600)


@pytest.mark.parametrize("bucket,age_days,want", [
    (1, 1, "raw"), (30, 1, "raw"), (60, 1, "1m"), (300, 30, "1m"),
    (90, 1, "raw"),                       # not a whole number of minutes
    (3600, 1, "1h"), (7200, 400, "1h"),
    (1800, 1, "1m"),                      # half hours are whole minutes
    (300, RETAIN_1M_DAYS + 1, "raw"),     # 1m rows are gone, raw is all there is
    (3600 + 60, 5, "1m"),                 # 61 min: not an hour multiple, 1m divides it
])
def test_pick_source(bucket, age_days, want):
    assert pick_source(bucket, NOW - timedelta(days=age_days), NOW) == want


def test_migration_keeps_rls_and_keeps_partitions_off_limits():
    sql = (VERSIONS / "0052_history_partitions.sql").read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in sql and "FORCE ROW LEVEL SECURITY" in sql
    assert "tenant_isolation ON tag_history" in sql
    # rollups: app role reads only
    assert "GRANT SELECT ON %I TO wds_app" in sql
    # partition DDL is behind SECURITY DEFINER functions, not granted to the app
    assert "REVOKE ALL ON FUNCTION wds_history_drop_before(timestamptz) FROM PUBLIC" in sql
    assert "GRANT EXECUTE ON FUNCTION wds_history_drop_before(timestamptz) TO wds_system;" in sql
