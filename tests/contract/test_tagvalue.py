"""TagValue / heartbeat payload contract tests — CONTRACT.md "MQTT topics"."""

from datetime import datetime, timezone

import pytest

from contract.schemas import (
    parse_ts,
    validate_heartbeat,
    validate_tag_value,
)

GOOD_TS = "2025-01-15T08:30:00.123Z"


# ----------------------------------------------------------------- TagValue

@pytest.mark.parametrize(
    "payload",
    [
        {"v": 1420.5, "q": "good", "ts": GOOD_TS},
        {"v": 0, "q": "good", "ts": GOOD_TS},
        {"v": -3.25, "q": "uncertain", "ts": GOOD_TS},
        {"v": True, "q": "good", "ts": GOOD_TS},
        {"v": False, "q": "bad", "ts": "2025-01-15T08:30:00Z"},      # no ms ok
        {"v": 1e9, "q": "stale", "ts": GOOD_TS},
        {"v": 42, "q": "good", "ts": GOOD_TS, "src": "sim"},        # extra field tolerated
    ],
)
def test_valid_tag_values(payload):
    assert validate_tag_value(payload) == []


@pytest.mark.parametrize(
    "payload,fragment",
    [
        ({"v": 1.0, "q": "good"}, "missing required field 'ts'"),
        ({"v": 1.0, "ts": GOOD_TS}, "missing required field 'q'"),
        ({"q": "good", "ts": GOOD_TS}, "missing required field 'v'"),
        ({}, "missing required field"),
        # v: CONTRACT.md wire shape is <num|bool> only
        ({"v": "1420.5", "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": "on", "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": None, "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": float("nan"), "q": "good", "ts": GOOD_TS}, "v must be"),   # NaN not valid JSON number
        ({"v": float("inf"), "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": float("-inf"), "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": [1, 2], "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"v": {"x": 1}, "q": "good", "ts": GOOD_TS}, "v must be"),
        # q: fixed vocabulary good|bad|stale|uncertain
        ({"v": 1, "q": "GOOD", "ts": GOOD_TS}, "q must be"),
        ({"v": 1, "q": "ok", "ts": GOOD_TS}, "q must be"),
        ({"v": 1, "q": "", "ts": GOOD_TS}, "q must be"),
        ({"v": 1, "q": None, "ts": GOOD_TS}, "q must be"),
        ({"v": 1, "q": "error", "ts": GOOD_TS}, "q must be"),
        # ts
        ({"v": 1, "q": "good", "ts": "not a date"}, "ISO8601"),
        ({"v": 1, "q": "good", "ts": None}, "ts must be a string"),
    ],
)
def test_invalid_tag_values(payload, fragment):
    errors = validate_tag_value(payload)
    assert errors, f"expected {payload!r} rejected"
    assert any(fragment in e for e in errors), errors


def test_tag_value_non_dict_rejected():
    assert validate_tag_value("not a dict")
    assert validate_tag_value([1, 2, 3])
    assert validate_tag_value(None)


# ------------------------------------------------------------------ ts rules

@pytest.mark.parametrize(
    "ts",
    [
        "2025-01-15T08:30:00Z",
        "2025-01-15T08:30:00.1Z",
        "2025-01-15T08:30:00.123456Z",
        "2024-02-29T23:59:59Z",   # leap day
        "1999-12-31T23:59:59Z",
    ],
)
def test_parse_ts_valid(ts):
    dt = parse_ts(ts)
    assert dt.tzinfo is not None


@pytest.mark.parametrize(
    "ts",
    [
        "2025-01-15T08:30:00+00:00",   # offset form — contract wants 'Z'
        "2025-01-15T08:30:00+07:00",
        "2025-01-15T08:30:00",         # naive, no zone
        "2025-01-15",                  # date only
        "2025-13-45T99:99:99Z",        # impossible calendar values
        "2023-02-29T00:00:00Z",        # not a leap year
        "2025-01-15 08:30:00Z",        # space instead of T
        "2025-01-15T08:30:00.1234567Z",# >6 fractional digits (µs is plenty)
        "T08:30:00Z",
        "",
        1234567890,                    # epoch int — contract wants ISO string
        None,
    ],
)
def test_parse_ts_invalid(ts):
    with pytest.raises(ValueError):
        parse_ts(ts)


def test_parse_ts_returns_utc():
    assert parse_ts(GOOD_TS).tzinfo == timezone.utc


# ---------------------------------------------------------------- heartbeat

def test_valid_heartbeat():
    assert validate_heartbeat(
        {"status": "up", "clock_ok": True, "adapter": "sim", "ts": GOOD_TS}
    ) == []


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "down", "clock_ok": True, "adapter": "sim", "ts": GOOD_TS},
        {"status": "up", "clock_ok": "yes", "adapter": "sim", "ts": GOOD_TS},
        {"status": "up", "clock_ok": True, "adapter": "", "ts": GOOD_TS},
        {"status": "up", "clock_ok": True, "adapter": "sim"},
        {"status": "up", "clock_ok": True, "adapter": "sim", "ts": "yesterday"},
        {},
        "up",
    ],
)
def test_invalid_heartbeat(payload):
    assert validate_heartbeat(payload)


def test_heartbeat_clock_ok_false_is_valid_shape():
    # clock_ok=false is the skew signal (CONTRACT.md: EDGE_CLOCK_SKEW_MS tests)
    assert validate_heartbeat(
        {"status": "up", "clock_ok": False, "adapter": "sim", "ts": GOOD_TS}
    ) == []
