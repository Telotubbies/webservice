"""REST latency SLOs (v4 T13).

- GET /api/v1/orgs/{o}/sites/{s}/tags/{t}/history over a 15-minute
  window: p95 <= 300 ms over 200 requests (doc 20 perf budget), modest
  concurrency (8 in flight — an ops wall with a few clients).
- GET .../tags/latest round-trip: p95 <= 300 ms over 100 requests.

Pure asyncio + httpx — no load-tool dependency (k6 absent on this box).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

from conftest import (  # noqa: E402
    OPERATOR_TOKEN, ORG_ID as V1_ORG, SITE_ID as V1_SITE,
)
from perf.conftest import report  # noqa: E402

N_HISTORY = 200
N_LATEST = 100
CONCURRENCY = 8
P95_BUDGET_S = 0.300


@pytest.fixture(scope="module")
def history_tag(base_url):
    """tag_id of a high-rate numeric tag on the shim site."""
    httpx = pytest.importorskip("httpx")
    r = httpx.get(
        f"{base_url}/api/v1/orgs/{V1_ORG}/sites/{V1_SITE}/tags",
        headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"},
        params={"search": "temp_c"}, timeout=10.0)
    assert r.status_code == 200, r.text
    tag = next(t for t in r.json()["items"]
               if t["path"].endswith("temp_c"))
    return tag["id"]


async def _bounded_get(client, sem, url, params):
    async with sem:
        r = await client.get(url, params=params)
    return r


def test_history_15m_window_p95(base_url, history_tag):
    httpx = pytest.importorskip("httpx")
    t_from = (datetime.now(timezone.utc) - timedelta(minutes=15)) \
        .isoformat().replace("+00:00", "Z")
    url = (f"/api/v1/orgs/{V1_ORG}/sites/{V1_SITE}"
           f"/tags/{history_tag}/history")

    async def run():
        async with httpx.AsyncClient(
                base_url=base_url, timeout=15.0,
                headers={"Authorization":
                         f"Bearer {OPERATOR_TOKEN}"}) as client:
            sem = asyncio.Semaphore(CONCURRENCY)
            resps = await asyncio.gather(*(
                _bounded_get(client, sem, url,
                             {"from": t_from, "limit": 5000})
                for _ in range(N_HISTORY)))
        return resps

    resps = asyncio.run(run())
    statuses = [r.status_code for r in resps]
    assert all(s == 200 for s in statuses), \
        f"non-200 responses: {sorted(set(statuses))}"
    lat_ms = [r.elapsed.total_seconds() * 1000 for r in resps]
    stats = report("rest.history_15m", lat_ms)
    assert stats["p95"] <= P95_BUDGET_S * 1000, \
        f"history p95 {stats['p95']:.0f}ms > 300ms budget"


def test_tags_latest_round_trip(base_url):
    httpx = pytest.importorskip("httpx")

    async def run():
        async with httpx.AsyncClient(
                base_url=base_url, timeout=10.0,
                headers={"Authorization":
                         f"Bearer {OPERATOR_TOKEN}"}) as client:
            lat = []
            for _ in range(N_LATEST):
                r = await client.get(
                    f"/api/v1/orgs/{V1_ORG}/sites/{V1_SITE}/tags/latest")
                assert r.status_code == 200
                lat.append(r.elapsed.total_seconds() * 1000)
        return lat

    lat_ms = asyncio.run(run())
    stats = report("rest.tags_latest", lat_ms)
    assert stats["p95"] <= P95_BUDGET_S * 1000, \
        f"tags/latest p95 {stats['p95']:.0f}ms > 300ms"
