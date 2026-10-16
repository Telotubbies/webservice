"""Offline contract for backend/app/plans.py — cap resolution + the 402
plan_limit refusal (roadmap §10 6.2). Fake-conn pattern; no HTTP needed —
check_limit raises HTTPException directly.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

import pytest

pytest.importorskip("fastapi")
from fastapi import HTTPException  # noqa: E402

from app import plans  # noqa: E402

ORG = uuid.uuid4()

PLAN_ROW = {
    "plan": "trial", "trial_ends_at": None, "suspended_at": None,
    "suspended_reason": None, "plan_limits": {},
    "trial_days": 14, "max_sites": 1, "max_edges": 1, "max_tags": 100,
    "max_users": 5, "max_cameras": 1, "max_vision_models": 1,
    "retention_days": 7, "gpu_hours_monthly": 2, "sso": False,
    "audit_export": False, "sms": False, "assistant": False,
    "api_rate_per_min": 60,
}


class FakeConn:
    """plan row on fetchrow; per-query usage count on fetchval."""

    def __init__(self, row=PLAN_ROW, usage=0):
        self.row = dict(row) if row else None
        self.usage = usage
        self.deleted = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def fetchrow(self, sql, *args):
        if "FROM organizations" in sql:
            return self.row
        return None

    async def fetchval(self, sql, *args):
        return self.usage

    async def fetch(self, sql, *args):
        return []

    async def execute(self, sql, *args):
        return "DELETE 3"


# ------------------------------------------------------------------ resolution
def test_caps_use_plan_columns():
    c = plans.caps(PLAN_ROW)
    assert c["max_sites"] == 1 and c["max_tags"] == 100 and c["max_users"] == 5


def test_caps_plan_limits_override_wins():
    row = {**PLAN_ROW, "plan_limits": {"max_sites": 3, "max_edges": 0}}
    c = plans.caps(row)
    assert c["max_sites"] == 3 and c["max_edges"] == 0
    assert c["max_tags"] == 100                      # untouched -> plan column


def test_caps_null_means_unlimited():
    row = {**PLAN_ROW, "max_sites": None}
    assert plans.caps(row)["max_sites"] is None


def test_caps_null_override_falls_back_to_plan():
    # a null override is "no override" — the platform PATCH pops null keys
    # out of plan_limits for exactly this reason
    row = {**PLAN_ROW, "plan_limits": {"max_sites": None}}
    assert plans.caps(row)["max_sites"] == 1


def test_features_defaults_and_overrides():
    f = plans.features(PLAN_ROW)
    assert f["retention_days"] == 7 and f["api_rate_per_min"] == 60
    row = {**PLAN_ROW, "plan_limits": {"retention_days": 30}}
    assert plans.features(row)["retention_days"] == 30


# ------------------------------------------------------------------ check_limit
@pytest.mark.asyncio
async def test_check_limit_under_cap_passes():
    conn = FakeConn(usage=0)                         # 0 sites, cap 1
    await plans.check_limit(conn, ORG, "max_sites")  # no raise


@pytest.mark.asyncio
async def test_check_limit_at_cap_raises_402():
    conn = FakeConn(usage=1)                         # 1 site, cap 1
    with pytest.raises(HTTPException) as ei:
        await plans.check_limit(conn, ORG, "max_sites")
    assert ei.value.status_code == 402
    d = ei.value.detail
    assert d["error"] == "plan_limit" and d["limit"] == "max_sites"
    assert d["usage"] == 1 and d["cap"] == 1 and d["requested"] == 1


@pytest.mark.asyncio
async def test_check_limit_bulk_extra_counted():
    conn = FakeConn(usage=90)                        # 90 tags, cap 100
    with pytest.raises(HTTPException) as ei:
        await plans.check_limit(conn, ORG, "max_tags", extra=20)
    assert ei.value.status_code == 402
    assert ei.value.detail["requested"] == 20
    await plans.check_limit(conn, ORG, "max_tags", extra=10)  # exactly fits


@pytest.mark.asyncio
async def test_check_limit_unlimited_never_raises():
    row = {**PLAN_ROW, "max_edges": None}
    conn = FakeConn(row=row, usage=999)
    await plans.check_limit(conn, ORG, "max_edges")  # unlimited


@pytest.mark.asyncio
async def test_check_limit_enterprise_null_caps():
    row = {k: (None if k.startswith("max_") else v) for k, v in PLAN_ROW.items()}
    row["plan"] = "enterprise"
    conn = FakeConn(row=row, usage=10**6)
    for key in plans.CAP_KEYS:
        await plans.check_limit(conn, ORG, key)


# ------------------------------------------------------------------ usage summary
@pytest.mark.asyncio
async def test_usage_summary_shape():
    conn = FakeConn(usage=2)
    out = await plans.usage_summary(conn, ORG)
    assert out["plan"] == "trial"
    assert set(plans.CAP_KEYS) | {"gpu_hours_monthly"} == set(out["usage"])
    for key in plans.CAP_KEYS:
        assert out["usage"][key]["usage"] == 2
        assert out["usage"][key]["cap"] == PLAN_ROW[key]
