"""Trend alarm rule maths (roc / anomaly / forecast) - pure, no services."""

import os
import sys
from uuid import uuid4

import pytest

pytest.importorskip("asyncpg")  # app.alarms imports the db layer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from app.alarms import (  # noqa: E402
    TREND_MIN_SAMPLES,
    Rule,
    trend_cleared,
    trend_score,
    trend_triggered,
)


def _rule(kind, threshold, deadband=0.0, window_s=60):
    return Rule(id=uuid4(), org_id=uuid4(), tag_id=uuid4(), name="r", kind=kind,
                threshold=threshold, stale_s=None, deadband=deadband,
                severity="warning", window_s=window_s)


def _ramp(n, step, start=10.0, dt=1.0):
    return [(i * dt, start + i * step) for i in range(n)]


def test_too_few_samples_never_scores():
    pts = _ramp(TREND_MIN_SAMPLES - 1, 1.0)
    for kind in ("roc", "anomaly", "forecast"):
        assert trend_score(kind, pts, pts[-1][0], 60) is None


def test_roc_is_absolute_change_either_direction():
    up = _ramp(10, 2.0)
    down = _ramp(10, -2.0, start=50.0)
    assert trend_score("roc", up, 9.0, 60) == pytest.approx(18.0)
    assert trend_score("roc", down, 9.0, 60) == pytest.approx(18.0)


def test_anomaly_flat_baseline_is_undefined_not_infinite():
    pts = [(float(i), 5.0) for i in range(10)]
    pts[-1] = (9.0, 500.0)
    assert trend_score("anomaly", pts, 9.0, 60) is None


def test_anomaly_scores_outlier_in_sigma():
    pts = [(float(i), 10.0 + (1.0 if i % 2 else -1.0)) for i in range(20)]  # mean 10, sd 1
    pts.append((20.0, 15.0))
    assert trend_score("anomaly", pts, 20.0, 60) == pytest.approx(5.0, rel=0.05)


def test_forecast_projects_linear_trend_window_ahead():
    pts = _ramp(10, 1.0, start=0.0)  # +1/s, last value 9 at t=9
    # window 60 s ahead of t=9 -> 9 + 60
    assert trend_score("forecast", pts, 9.0, 60) == pytest.approx(69.0)


def test_forecast_flat_series_projects_flat():
    pts = [(float(i), 7.0) for i in range(10)]
    assert trend_score("forecast", pts, 9.0, 120) == pytest.approx(7.0)


def test_trip_and_clear_use_deadband():
    r = _rule("roc", threshold=10.0, deadband=2.0)
    assert trend_triggered(r, 10.5)
    assert not trend_triggered(r, 10.0)
    assert not trend_cleared(r, 9.0)   # inside the deadband: stay raised
    assert trend_cleared(r, 8.0)
