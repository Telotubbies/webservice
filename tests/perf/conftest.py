"""Shared fixtures for the performance harness (v4 T13).

Marked `integration` (live stack — `make up-test`) + `perf` so
`make test-perf` can select it. Numbers are printed as `PERF name=value`
lines and asserted in the tests — the printed line is what the
verification log quotes.
"""

from __future__ import annotations

import os
import statistics

import pytest

from conftest import OPERATOR_TOKEN  # noqa: E402 — root tests/conftest.py

WEB_URL = os.environ.get("WEB_URL", "http://localhost:5173").rstrip("/")


@pytest.fixture(scope="session")
def web_url() -> str:
    return WEB_URL


@pytest.fixture(scope="session")
def operator_headers() -> dict:
    return {"Authorization": f"Bearer {OPERATOR_TOKEN}"}


def p95(samples: list[float]) -> float:
    """Nearest-rank p95 in the same units as `samples`."""
    if not samples:
        return float("nan")
    s = sorted(samples)
    k = max(1, round(0.95 * len(s)))
    return s[min(k, len(s)) - 1]


def report(name: str, samples: list[float], unit: str = "ms") -> dict:
    """Print the PERF line the verification log quotes; returns stats."""
    s = sorted(samples)
    stats = {
        "n": len(s),
        "min": s[0] if s else float("nan"),
        "p50": statistics.median(s) if s else float("nan"),
        "p95": p95(s),
        "max": s[-1] if s else float("nan"),
    }
    print(f"\nPERF {name}: n={stats['n']} min={stats['min']:.1f}{unit} "
          f"p50={stats['p50']:.1f}{unit} p95={stats['p95']:.1f}{unit} "
          f"max={stats['max']:.1f}{unit}")
    return stats
