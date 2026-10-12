"""Insight-engine detector unit tests — doc 19 §4.1 (no services needed).

Exercises the pure decision logic (drift OLS, flatline predicate, anomaly
streak bookkeeping) by feeding synthetic samples into TagStats/_score_sample
— deterministic, unlike the integration suite which must wait real time for
INSIGHT_FLAT_S / drift windows.
"""

import asyncio
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

pytest.importorskip("asyncpg")  # app.insights imports the db layer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from app import config  # noqa: E402
from app.insights import (  # noqa: E402
    _MIN_BASE_N,
    InsightEngine,
    TagStats,
    drift_detect,
    flatline_on,
)

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _engine() -> InsightEngine:
    return InsightEngine(None, None, None)


def _primed(mu=100.0, var=4.0, n=_MIN_BASE_N) -> TagStats:
    st = TagStats()
    st.mu, st.var, st.n = mu, var, n
    st.seeded = True
    return st


# ------------------------------------------------------------------- drift

def test_drift_detects_clean_ramp():
    # +0.1/s over 700 s, zero residual — a textbook sensor drift
    pts = [(T0 + timedelta(seconds=10 * i), 100.0 + i) for i in range(71)]
    on, score, slope, resid = drift_detect(pts, sigma_b=1.0, deadband_min=0.0)
    assert on
    assert slope == pytest.approx(0.1)
    assert resid == pytest.approx(0.0, abs=1e-9)
    assert score == pytest.approx(70.0)      # slope * span / sigma_b


def test_drift_rejects_noisy_flatline():
    # oscillating +/-3 around a flat mean: slope ~0 AND residual >> 0.5*sigma
    pts = [(T0 + timedelta(seconds=10 * i), 50.0 + (3.0 if i % 2 else -3.0))
           for i in range(71)]
    on, *_ = drift_detect(pts, sigma_b=1.0, deadband_min=0.0)
    assert not on


def test_drift_requires_min_span():
    # same clean ramp but only 100 s of data — too early to call a trend
    pts = [(T0 + timedelta(seconds=10 * i), 100.0 + i) for i in range(31)]
    on, *_ = drift_detect(pts, sigma_b=1.0, deadband_min=0.0)
    assert not on


def test_drift_respects_deadband_min():
    # real trend but slower than the tag's configured deadband rate
    pts = [(T0 + timedelta(seconds=10 * i), 100.0 + 0.001 * i) for i in range(71)]
    on, *_ = drift_detect(pts, sigma_b=1.0, deadband_min=10.0)
    assert not on                                # 0.0001/s < 10/600 s


# ---------------------------------------------------------------- flatline

def test_flatline_predicate():
    now = T0 + timedelta(seconds=400)
    good_ts = T0 + timedelta(seconds=399)          # fresh
    change_ts = T0                                  # 400 s ago >= FLAT_S
    assert flatline_on(now, good_ts, change_ts, flat_n=10, peer_moved=True)
    assert not flatline_on(now, good_ts, change_ts, flat_n=10, peer_moved=False)
    assert not flatline_on(now, good_ts, T0 + timedelta(seconds=200),
                           flat_n=10, peer_moved=True)      # moved too recently
    stale = T0 + timedelta(seconds=350)
    assert not flatline_on(now, stale, change_ts, flat_n=10,
                           peer_moved=True)                 # tag stopped sampling
    assert not flatline_on(now, good_ts, change_ts, flat_n=1, peer_moved=True)


# ------------------------------------------------------- anomaly bookkeeping

def test_collapsed_sub_open_n_streak_resets_episode_score():
    """Review fix: a streak that dies before OPEN_N must not leak its z into
    a later episode's score/severity."""
    eng = _engine()
    st = _primed()                                # sigma_eff = 2.0
    eng._score_sample(st, T0, 120.0)              # z = 10, streak = 1
    eng._score_sample(st, T0 + timedelta(seconds=1), 120.0)  # streak = 2
    assert st.ep_zmax == 10.0
    eng._score_sample(st, T0 + timedelta(seconds=2), 101.0)  # in-band -> collapse
    assert st.streak == 0
    assert st.ep_zmax == 0.0                      # the leak being tested
    assert st.ep_last_offense is None
    # a later milder episode scores its own z, not the leaked 10
    for i in range(config.INSIGHT_OPEN_N):
        eng._score_sample(st, T0 + timedelta(seconds=3 + i), 108.0)  # z ~ 4
    assert st.pending is not None
    assert 3.0 < st.pending[2] < 4.0          # its own z, not the leaked 10
    assert st.pending[0] == T0 + timedelta(seconds=3)


def test_ep_zmax_survives_while_episode_open():
    eng = _engine()
    st = _primed()
    st.open_anomaly = True                        # open row exists this pass
    eng._score_sample(st, T0, 120.0)
    eng._score_sample(st, T0 + timedelta(seconds=1), 101.0)
    assert st.ep_zmax == 10.0                     # episode max kept while open


def test_pending_arms_at_open_n_consecutive():
    eng = _engine()
    st = _primed()
    for i in range(2):
        eng._score_sample(st, T0 + timedelta(seconds=i), 120.0)
    assert st.pending is None                     # 2 < OPEN_N
    eng._score_sample(st, T0 + timedelta(seconds=2), 120.0)
    assert st.pending is not None
    assert st.pending[0] == T0
    assert st.pending[1] == T0 + timedelta(seconds=2)
    assert st.pending[2] > 9.0                # winsorized mu-shift trims each z


def test_pending_extends_while_offense_continues():
    eng = _engine()
    st = _primed()
    for i in range(config.INSIGHT_OPEN_N + 2):
        eng._score_sample(st, T0 + timedelta(seconds=i), 120.0)
    assert st.pending[1] == T0 + timedelta(seconds=config.INSIGHT_OPEN_N + 1)


def test_bad_quality_samples_are_invisible():
    eng = _engine()
    st = _primed()
    eng._process_sample(st, T0, 999.0, "good")    # prime prev_q (+ streak=1)
    n0, mu0, inband0 = st.n, st.mu, st.inband
    eng._process_sample(st, T0 + timedelta(seconds=1), 999.0, "bad")
    eng._process_sample(st, T0 + timedelta(seconds=2), 999.0, "uncertain")
    assert (st.n, st.mu) == (n0, mu0)             # stats untouched
    assert st.streak == 1                         # invisible, not a streak break
    assert st.inband == inband0                   # nor a close-streak sample
    assert st.pending is None
    assert len(st.transitions) == 1               # good -> bad counts once
    eng._process_sample(st, T0 + timedelta(seconds=3), 999.0, "bad")
    assert len(st.transitions) == 1               # bad -> bad is no transition


def test_evaluate_once_is_serialized():
    assert isinstance(_engine()._lock, asyncio.Lock)


# ------------------------------------------------------- write-path fixes
# _open/_update/_close take a TenantConn; these tests substitute a recorder —
# they assert on the emitted SQL/args, not on a live DB.

class _FakeTC:
    """Records execute() calls; audit.append works against it unchanged."""
    org_id = uuid4()

    def __init__(self):
        self.calls = []                      # [(sql, args)]

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return "UPDATE 1"


def _tag():
    return types.SimpleNamespace(id=uuid4(), v1_name="plant1.sort.line1.x.sig")


@pytest.fixture
def _serialize_stub(monkeypatch):
    """_serialize hits the DB + tag registry — stub it for write-path tests."""
    async def fake(self, tc, iid):
        return {"id": str(iid)}
    monkeypatch.setattr(InsightEngine, "_serialize", fake)


def test_sigma_floor_has_absolute_minimum():
    """|mu|~0 tags (a ratio hovering at zero) used to floor at ~1e-9, turning
    sub-unit noise into astronomical z-scores — the floor is now bounded."""
    st = TagStats()
    st.mu = 0.0
    assert InsightEngine._sigma_floor(st) >= 1e-3
    st.mu = 100.0
    assert InsightEngine._sigma_floor(st) == 2.0     # 0.02*|mu| still wins


def test_close_never_writes_null_ts_end(_serialize_stub):
    """Post-restart ep_last_offense may be None — the close must still write a
    real timestamp (a NULL ts_end reads as still-open in every overlap query)."""
    eng = _engine()
    tc = _FakeTC()
    events = []
    asyncio.run(eng._close(tc, uuid4(), _tag(), None, events))
    sql, args = tc.calls[0]
    assert "state='closed'" in sql
    assert isinstance(args[1], datetime)             # not None
    assert len(events) == 1                          # queued for post-commit broadcast


def test_open_row_reseeds_episode_state():
    """An open row surviving a restart must repopulate the empty episode
    accumulators (ep_zmax/ep_last_offense) from its stored score/ts_end so
    the score can't regress and a later close has a real ts_end."""
    eng = _engine()
    st = _primed()
    st.ep_zmax, st.ep_last_offense = 0.0, None       # fresh post-restart state
    last = T0 + timedelta(seconds=30)
    opens = {"anomaly": {"id": uuid4(), "kind": "anomaly",
                         "ts_end": last, "score": 7.5}}
    asyncio.run(eng._eval_anomaly(_FakeTC(), _tag(), st, opens,
                                T0 + timedelta(minutes=1), []))
    assert st.ep_zmax == 7.5
    assert st.ep_last_offense == last


def test_restart_close_uses_seeded_ts_end(_serialize_stub):
    """Close on the very first pass after a restart (no new offenses): the
    seeded ts_end reaches the UPDATE — not NULL."""
    eng = _engine()
    st = _primed()
    st.inband = config.INSIGHT_CLOSE_N
    st.ep_zmax, st.ep_last_offense = 0.0, None
    last = T0 + timedelta(seconds=30)
    opens = {"anomaly": {"id": uuid4(), "kind": "anomaly",
                         "ts_end": last, "score": 7.5}}
    tc = _FakeTC()
    asyncio.run(eng._eval_anomaly(tc, _tag(), st, opens,
                                T0 + timedelta(minutes=1), []))
    closes = [c for c in tc.calls if "state='closed'" in c[0]]
    assert closes, "open row was not closed after CLOSE_N in-band samples"
    assert closes[0][1][1] == last                   # seeded ts_end, not NULL


def test_anomaly_update_escalates_severity(_serialize_stub):
    """An episode opening at z~4 (info) that peaks at z~9 must escalate the
    open row to warning — severity is recomputed from ep_zmax on _update."""
    eng = _engine()
    st = _primed()
    st.ep_zmax, st.ep_last_offense = 9.0, T0 + timedelta(seconds=40)
    opens = {"anomaly": {"id": uuid4(), "kind": "anomaly",
                         "ts_end": T0, "score": 4.0}}   # opened at z~4 -> info
    tc = _FakeTC()
    events = []
    asyncio.run(eng._eval_anomaly(tc, _tag(), st, opens,
                                T0 + timedelta(minutes=1), events))
    upds = [c for c in tc.calls if "severity=$5" in c[0]]
    assert upds, "open row was not updated"
    assert upds[0][1][-1] == "warning"
    assert len(events) == 1


def test_writes_enqueue_events_not_broadcast(_serialize_stub):
    """WS events are collected during the pass and broadcast post-commit by
    the caller — _open/_update/_close never touch self.ws."""
    eng = _engine()
    assert eng.ws is None                            # would raise if broadcast fired
    tc = _FakeTC()
    events = []
    asyncio.run(eng._close(tc, uuid4(), _tag(), T0, events))
    assert len(events) == 1                          # no exception, event queued
