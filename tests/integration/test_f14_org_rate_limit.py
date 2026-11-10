"""F14: one tenant's ingest cannot starve another. Offline: the per-org ingest budget (_admit) and the
measured throttle counters the platform page reads; TieredRateLimiter capacity per plan."""

import asyncio
import contextlib
import uuid

import pytest

from app.core import observability
from app.core.ratelimit import TieredRateLimiter
from app.production import ingest


class _St:
    class pools:
        system = object()


def _setup(monkeypatch, caps):
    ingest._caps.clear()
    st = _St()
    st.ingest_rl = None

    @contextlib.asynccontextmanager
    async def fake_tx(pool, org_id, *a, **k):
        yield org_id

    async def org_plan(tc, org_id):
        return {"org": tc}

    monkeypatch.setattr(ingest, "tenant_tx", fake_tx)
    monkeypatch.setattr(ingest.plans, "org_plan", org_plan)
    monkeypatch.setattr(ingest.plans, "features", lambda row: {"ingest_msgs_per_min": caps[row["org"]]})
    return st


def test_org_over_its_budget_is_throttled_and_a_neighbour_is_not(monkeypatch):
    noisy, quiet = uuid.uuid4(), uuid.uuid4()
    st = _setup(monkeypatch, {noisy: 5, quiet: 1000})

    async def run():
        n = [await ingest._admit(st, noisy) for _ in range(12)]
        q = [await ingest._admit(st, quiet) for _ in range(12)]
        return n, q
    n, q = asyncio.run(run())
    assert sum(n) == 5 and n[:5] == [True] * 5 and not any(n[5:])
    assert all(q), "a noisy tenant must not eat the quiet tenant's budget"


def test_budget_comes_from_the_plan_and_falls_back_when_lookup_fails(monkeypatch):
    org = uuid.uuid4()
    st = _setup(monkeypatch, {org: 3})
    assert sum(asyncio.run(_many(st, org, 6))) == 3
    ingest._caps.clear()

    async def boom(tc, org_id):
        raise RuntimeError("db down")
    monkeypatch.setattr(ingest.plans, "org_plan", boom)
    st.ingest_rl = None
    assert all(asyncio.run(_many(st, org, 50)))              # default cap is large: ingest keeps flowing


async def _many(st, org, n):
    return [await ingest._admit(st, org) for _ in range(n)]


def test_throttled_samples_are_counted_per_org_for_the_health_page():
    org = uuid.uuid4()
    observability.note_ingest(org, 0.2)
    observability.note_ingest(org, 0.0, throttled=True)
    observability.note_ingest(org, 0.0, throttled=True)
    d = observability._ORG_INGEST[str(org)]
    assert d["n"] == 1 and d["throttled"] == 2 and d["lag_max"] == pytest.approx(0.2)


def test_tiered_limiter_gives_each_plan_its_own_capacity():
    rl = TieredRateLimiter(window_s=60.0)

    async def run():
        small = [await rl.allow("org-a", 2) for _ in range(4)]
        big = [await rl.allow("org-b", 200) for _ in range(4)]
        return small, big
    small, big = asyncio.run(run())
    assert small == [True, True, False, False] and all(big)


def test_api_key_budget_follows_the_org_plan_override():
    """iam/security.py reads plan_limits.api_rate_per_min first, then the plan's column."""
    import inspect
    from app.iam import security
    src = inspect.getsource(security)
    assert "plan_limits->>'api_rate_per_min'" in src and "apikey_limiter.allow" in src
