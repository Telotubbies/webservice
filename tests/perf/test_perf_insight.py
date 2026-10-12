"""Insight engine eval-pass timing (v4 T13).

SLO: one evaluation pass over every numeric tag of every org completes
in < 15 s (the INSIGHT_PERIOD_S cadence — a pass slower than the period
would fall permanently behind). The measured duration is exported as
the wds_insight_eval_last_seconds gauge (added for this suite).
"""

from __future__ import annotations

import time

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

BUDGET_S = 15.0


def _scrape_eval_seconds(client) -> float | None:
    r = client.get("/metrics")
    assert r.status_code == 200
    for line in r.text.splitlines():
        if line.startswith("wds_insight_eval_last_seconds"):
            return float(line.rsplit(" ", 1)[-1])
    return None


def test_insight_eval_pass_under_15s(api):
    value = None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        value = _scrape_eval_seconds(api)
        if value and value > 0:
            break
        time.sleep(2)
    assert value is not None and value > 0, \
        "no completed insight eval pass observed in 45s"
    print(f"\nPERF insight.eval_pass: {value:.3f}s (budget {BUDGET_S}s)")
    assert value < BUDGET_S, \
        f"insight eval pass {value:.2f}s exceeds {BUDGET_S}s SLO"
