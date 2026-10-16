"""Contract tests for the OEE/shift/downtime pure functions (roadmap 5.1–5.3).

Acceptance: OEE from synthetic history equals a hand calculation within 0.5%.
No DB — every function under test takes plain rows/datetimes.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.oee import (
    break_seconds, compute_oee, counter_delta, current_shift, durations_in_windows,
    map_state, pareto, shift_instances, shift_window, state_durations,
    state_intervals, sweep_decision, to_time,
)

BKK = ZoneInfo("Asia/Bangkok")
UTC = timezone.utc
S1 = uuid.uuid4()


def _shift(**kw):
    return {"id": kw.pop("id", S1), "name": kw.pop("name", "Day"),
            "start_time": kw.pop("start_time", "08:00"),
            "end_time": kw.pop("end_time", "16:00"),
            "days_of_week": kw.pop("days_of_week", [1, 2, 3, 4, 5]),
            "breaks": kw.pop("breaks", []), "enabled": kw.pop("enabled", True)}


def _ts(y, m, d, h, mi=0, tz=UTC):
    return datetime(y, m, d, h, mi, tzinfo=tz)


# ------------------------------------------------------------------ to_time
def test_to_time_accepts_str_and_time():
    assert to_time("07:30") == dtime(7, 30)
    assert to_time("23:59:30") == dtime(23, 59, 30)
    assert to_time(dtime(8, 0)) == dtime(8, 0)
    with pytest.raises(ValueError):
        to_time("25:00")


# ------------------------------------------------------------ shift windows
def test_shift_window_overnight():
    s = _shift(start_time="22:00", end_time="06:00")
    st, en = shift_window(s, date(2026, 10, 15), UTC)  # Thursday
    assert st == _ts(2026, 10, 15, 22) and en == _ts(2026, 10, 16, 6)


def test_current_shift_daytime_and_off_hours():
    s = _shift()
    inside = current_shift([s], _ts(2026, 10, 16, 10), UTC)  # Friday 10:00
    assert inside and inside["shift"]["id"] == S1
    assert current_shift([s], _ts(2026, 10, 17, 10), UTC) is None  # Saturday
    assert current_shift([s], _ts(2026, 10, 16, 20), UTC) is None  # after end


def test_current_shift_overnight_belongs_to_start_weekday():
    # Monday 22:00–06:00 covers Tuesday 03:00 but not Saturday night.
    s = _shift(start_time="22:00", end_time="06:00", days_of_week=[1])
    assert current_shift([s], _ts(2026, 10, 13, 3), UTC) is not None   # Tue 03:00
    assert current_shift([s], _ts(2026, 10, 12, 23), UTC) is not None  # Mon 23:00
    assert current_shift([s], _ts(2026, 10, 18, 3), UTC) is None       # Sun 03:00


def test_shift_instances_breaks_and_nonworking():
    s = _shift(breaks=[{"start": "12:00", "end": "13:00", "name": "lunch"}])
    inst = shift_instances([s], {date(2026, 10, 15)}, UTC,
                           _ts(2026, 10, 15, 0), _ts(2026, 10, 18, 0))
    # Thu 15th is nonworking -> only Fri 16th remains
    assert len(inst) == 1
    assert inst[0]["seconds"] == 8 * 3600
    assert inst[0]["break_s"] == 3600


def test_break_seconds_clipped_to_window():
    s = _shift(breaks=[{"start": "12:00", "end": "13:00"}])
    day = date(2026, 10, 16)
    # window covering only half the lunch break
    got = break_seconds(s, _ts(2026, 10, 16, 12, 30), _ts(2026, 10, 16, 14), day, UTC)
    assert got == 1800


# ------------------------------------------------------------- state mapping
STATES_MAP = {"running": [1, "run"], "idle": [2], "stopped": [0, "stop"], "fault": [9]}


def test_map_state_and_unknown():
    assert map_state(1, STATES_MAP) == "running"
    assert map_state("stop", STATES_MAP) == "stopped"
    assert map_state(9, STATES_MAP) == "fault"
    assert map_state(77, STATES_MAP) == "unknown"
    assert map_state(True, {"running": [True]}) == "running"


def test_state_intervals_carry_in_and_gaps():
    t0, t1 = _ts(2026, 10, 16, 8), _ts(2026, 10, 16, 12)
    samples = [
        (_ts(2026, 10, 16, 7, 55), 1),   # carry-in: running at window start
        (_ts(2026, 10, 16, 10, 0), 0),   # stop at 10:00
        (_ts(2026, 10, 16, 10, 30), 1),  # resume
    ]
    iv = state_intervals(samples, STATES_MAP, t0, t1)
    assert iv == [("running", t0, _ts(2026, 10, 16, 10)),
                  ("stopped", _ts(2026, 10, 16, 10), _ts(2026, 10, 16, 10, 30)),
                  ("running", _ts(2026, 10, 16, 10, 30), t1)]


def test_state_intervals_no_carry_is_unknown():
    t0, t1 = _ts(2026, 10, 16, 8), _ts(2026, 10, 16, 12)
    iv = state_intervals([(_ts(2026, 10, 16, 9), 1)], STATES_MAP, t0, t1)
    assert iv[0] == ("unknown", t0, _ts(2026, 10, 16, 9))
    assert iv[1] == ("running", _ts(2026, 10, 16, 9), t1)


def test_durations_in_windows_sums_only_inside():
    t0, t1 = _ts(2026, 10, 16, 8), _ts(2026, 10, 16, 12)
    samples = [(t0, 1), (_ts(2026, 10, 16, 10), 0)]
    # only the first two hours are inside the window
    d = durations_in_windows(samples, STATES_MAP, [(t0, _ts(2026, 10, 16, 10))])
    assert d == {"running": 7200.0, "idle": 0.0, "stopped": 0.0,
                 "fault": 0.0, "unknown": 0.0}
    d_all = state_durations(samples, STATES_MAP, t0, t1)
    assert d_all["running"] == 7200.0 and d_all["stopped"] == 7200.0


# ------------------------------------------------------------------ counters
def test_counter_delta_normal_and_reset():
    assert counter_delta(100, 160) == 60
    assert counter_delta(90, 5) == 5          # counter reset mid-window
    assert counter_delta(10, 10) == 0
    assert counter_delta(None, 5) == 0


# --------------------------------------------------------------------- OEE
def test_compute_oee_matches_hand_calc():
    # Hand calc: 4h planned, 30 min stop -> run 3.5h => A = 12600/14400 = 0.875
    # 12600 units at 1 s ideal cycle => P = 1.0; 630 rejects => Q = 0.95
    r = compute_oee(run_s=12600, planned_s=14400, units=12600,
                    rejects=630, ideal_cycle_s=1.0)
    assert abs(r["availability"] - 0.875) < 0.005
    assert abs(r["performance"] - 1.0) < 0.005
    assert abs(r["quality"] - 0.95) < 0.005
    assert abs(r["oee"] - 0.875 * 0.95) < 0.005


def test_compute_oee_no_basis_returns_none():
    r = compute_oee(run_s=0, planned_s=0, units=0, rejects=0, ideal_cycle_s=None)
    assert r["availability"] is None and r["oee"] is None


# -------------------------------------------------------------------- pareto
def test_pareto_sorted_with_cumulative():
    rows = [{"reason_id": "a", "seconds": 100, "count": 2},
            {"reason_id": "b", "seconds": 300, "count": 1},
            {"reason_id": "c", "seconds": 600, "count": 4}]
    out = pareto(rows)
    assert [r["reason_id"] for r in out] == ["c", "b", "a"]
    assert abs(out[0]["pct"] - 0.6) < 1e-9
    assert abs(out[-1]["cum_pct"] - 1.0) < 1e-9


# ----------------------------------------------------------- downtime sweep
def _smap():
    return STATES_MAP


def test_sweep_opens_after_threshold():
    now = _ts(2026, 10, 16, 12)
    samples = [(_ts(2026, 10, 16, 11, 50), 1), (_ts(2026, 10, 16, 11, 54), 0)]
    # stop began 11:54, now 12:00 = 6 min >= 5 min threshold
    act = sweep_decision(samples, _smap(), None, 300, now)
    assert act == {"action": "open", "starts_at": _ts(2026, 10, 16, 11, 54),
                   "state": "stopped"}


def test_sweep_under_threshold_stays_quiet():
    now = _ts(2026, 10, 16, 12)
    samples = [(_ts(2026, 10, 16, 11, 58), 0)]  # 2-minute stop
    assert sweep_decision(samples, _smap(), None, 300, now)["action"] == "none"


def test_sweep_does_not_duplicate_open_row():
    now = _ts(2026, 10, 16, 12)
    samples = [(_ts(2026, 10, 16, 11, 0), 0)]
    act = sweep_decision(samples, _smap(), _ts(2026, 10, 16, 11, 0), 300, now)
    assert act["action"] == "none"


def test_sweep_closes_when_running_again():
    now = _ts(2026, 10, 16, 12)
    open_start = _ts(2026, 10, 16, 11, 30)
    samples = [(_ts(2026, 10, 16, 11, 30), 0), (_ts(2026, 10, 16, 11, 45), 1)]
    act = sweep_decision(samples, _smap(), open_start, 300, now)
    assert act == {"action": "close", "ends_at": _ts(2026, 10, 16, 11, 45)}


def test_sweep_unknown_state_never_opens_nor_closes():
    now = _ts(2026, 10, 16, 12)
    assert sweep_decision([(_ts(2026, 10, 16, 11), 77)], _smap(), None, 300, now)["action"] == "none"
    assert sweep_decision([(_ts(2026, 10, 16, 11), 77)], _smap(),
                          _ts(2026, 10, 16, 10), 300, now)["action"] == "none"
    assert sweep_decision([], _smap(), None, 300, now)["action"] == "none"


def test_sweep_fault_counts_as_stop():
    now = _ts(2026, 10, 16, 12)
    samples = [(_ts(2026, 10, 16, 11, 0), 1), (_ts(2026, 10, 16, 11, 30), 9)]
    act = sweep_decision(samples, _smap(), None, 300, now)
    assert act["action"] == "open" and act["state"] == "fault"
