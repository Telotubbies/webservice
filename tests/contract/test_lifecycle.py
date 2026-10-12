"""Command lifecycle contract tests — state machine, dedup ordering, edge pipeline.

Lifecycle vocabulary is CONTRACT.v2 §6 / doc 17 §6:
backend statuses {accepted, dispatched, acknowledged, rejected, failed,
timeout}; edge cmd-resp statuses {acknowledged, rejected, failed}.
"""

from datetime import datetime, timedelta, timezone

import pytest

from contract.schemas import (
    COMMAND_STATUSES,
    IN_FLIGHT_STATUSES,
    TERMINAL_STATUSES,
    edge_evaluate_command,
    is_legal_transition,
    is_terminal,
    resolve_command_post,
)

NOW = datetime(2025, 1, 15, 8, 30, 0, tzinfo=timezone.utc)
WRITABLE_BOOL = "sort/line1/motor1/running"      # tag_path form (doc 17 §6)
WRITABLE_NUM = "sort/line1/motor1/speed_sp"
READONLY = "sort/line1/conv1/temp_c"
UNKNOWN = "sort/line1/ghost1/sig"


def _cmd(tag_path=WRITABLE_BOOL, value=True, ttl_s=5, issued_at=None):
    return {
        "command_id": "c1",
        "tag_path": tag_path,
        "value": value,
        "issued_at": (issued_at or NOW).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ttl_s": ttl_s,
        "idempotency_key": "k1",
        "user": "op",
    }


# ------------------------------------------------------------ status domains

def test_status_vocabulary_is_contract_exact():
    assert COMMAND_STATUSES == {
        "accepted", "dispatched", "acknowledged", "rejected", "failed",
        "timeout",
    }


def test_terminal_statuses():
    assert TERMINAL_STATUSES == {"acknowledged", "rejected", "failed", "timeout"}
    for s in TERMINAL_STATUSES:
        assert is_terminal(s)
    assert not is_terminal("accepted")


def test_inflight_statuses_match_one_command_per_tag_rule():
    assert IN_FLIGHT_STATUSES == {"accepted", "dispatched"}
    for s in IN_FLIGHT_STATUSES:
        assert not is_terminal(s)


# ---------------------------------------------------------------- transitions

@pytest.mark.parametrize(
    "frm,to",
    [
        ("accepted", "dispatched"),   # MQTT publish ok
        ("accepted", "failed"),       # publish itself failed
        ("accepted", "timeout"),
        ("dispatched", "acknowledged"),
        ("dispatched", "rejected"),
        ("dispatched", "failed"),
        ("dispatched", "timeout"),    # no resp within ttl_s
    ],
)
def test_legal_transitions(frm, to):
    assert is_legal_transition(frm, to), f"{frm}→{to} should be legal"


@pytest.mark.parametrize(
    "frm,to",
    [
        ("accepted", "acknowledged"),  # must pass through dispatched first
        ("accepted", "rejected"),
        ("accepted", "accepted"),
        ("dispatched", "accepted"),    # no backwards
        ("dispatched", "dispatched"),
        # terminals are absorbing — nothing leaves them
        ("acknowledged", "accepted"), ("acknowledged", "failed"),
        ("acknowledged", "acknowledged"),
        ("rejected", "acknowledged"), ("rejected", "accepted"),
        ("failed", "acknowledged"), ("failed", "accepted"),
        ("timeout", "acknowledged"), ("timeout", "accepted"),
    ],
)
def test_illegal_transitions(frm, to):
    assert not is_legal_transition(frm, to), f"{frm}→{to} must be illegal"


def test_no_self_transitions():
    for s in COMMAND_STATUSES:
        assert not is_legal_transition(s, s)


def test_terminals_are_absorbing():
    for terminal in TERMINAL_STATUSES:
        for target in COMMAND_STATUSES:
            assert not is_legal_transition(terminal, target)


def test_unknown_statuses_rejected():
    assert not is_legal_transition("bogus", "acknowledged")
    assert not is_legal_transition("accepted", "bogus")
    # v1 vocabulary must not come back
    assert not is_legal_transition("issued", "sent")
    assert not is_legal_transition("done", "done")


def test_happy_path_chain():
    chain = ["accepted", "dispatched", "acknowledged"]
    for a, b in zip(chain, chain[1:]):
        assert is_legal_transition(a, b), f"contract chain broken at {a}→{b}"


# ------------------------------------------------- POST resolution ordering

def test_new_command_returns_201():
    r = resolve_command_post(replayed_command_id=None, inflight_command_id=None)
    assert r.http_status == 201
    assert r.command_id is not None


def test_inflight_same_tag_returns_409_with_active_id():
    r = resolve_command_post(replayed_command_id=None, inflight_command_id="cmd-A")
    assert r.http_status == 409
    assert r.active_command_id == "cmd-A"


def test_idempotent_replay_returns_200_same_id():
    r = resolve_command_post(replayed_command_id="cmd-A", inflight_command_id=None)
    assert r.http_status == 200
    assert r.command_id == "cmd-A"


def test_dedup_checked_before_conflict():
    # 09 §6.6 test_idempotent_replay_after_409: resending the same
    # idempotency_key while ANOTHER command is in-flight on that tag must
    # replay (200), not 409 — dedup runs before the conflict check.
    r = resolve_command_post(replayed_command_id="cmd-A", inflight_command_id="cmd-B")
    assert r.http_status == 200
    assert r.command_id == "cmd-A"


# ------------------------------------------------------- edge decision order

def test_edge_acknowledged_on_writable_bool():
    res = edge_evaluate_command(_cmd(tag_path=WRITABLE_BOOL, value=True), now=NOW)
    assert res.status == "acknowledged"


def test_edge_acknowledged_on_in_range_setpoint():
    res = edge_evaluate_command(_cmd(tag_path=WRITABLE_NUM, value=45.0), now=NOW)
    assert res.status == "acknowledged"


def test_edge_rejected_out_of_range_setpoint():
    for v in (-1.0, 60.1, 1e6):
        res = edge_evaluate_command(_cmd(tag_path=WRITABLE_NUM, value=v), now=NOW)
        assert res.status == "rejected"
        assert res.reason == "out_of_range"


def test_edge_range_boundary_is_inclusive():
    for v in (0.0, 60.0):
        assert edge_evaluate_command(
            _cmd(tag_path=WRITABLE_NUM, value=v), now=NOW).status == "acknowledged"


def test_edge_rejected_not_writable_readonly_tag():
    res = edge_evaluate_command(_cmd(tag_path=READONLY, value=12.0), now=NOW)
    assert (res.status, res.reason) == ("rejected", "not_writable")


def test_edge_rejected_not_writable_unknown_tag():
    res = edge_evaluate_command(_cmd(tag_path=UNKNOWN, value=1.0), now=NOW)
    assert (res.status, res.reason) == ("rejected", "not_writable")


def test_edge_rejected_ttl_expired():
    res = edge_evaluate_command(
        _cmd(ttl_s=5), now=NOW + timedelta(seconds=6)
    )
    assert (res.status, res.reason) == ("rejected", "ttl_expired")


def test_edge_ttl_boundary_not_expired():
    # now == issued_at + ttl → not strictly greater → still executable
    res = edge_evaluate_command(_cmd(ttl_s=5), now=NOW + timedelta(seconds=5))
    assert res.status == "acknowledged"


def test_edge_rejected_clock_untrusted():
    res = edge_evaluate_command(_cmd(), now=NOW, clock_ok=False)
    assert (res.status, res.reason) == ("rejected", "clock_untrusted")


def test_edge_ttl_checked_before_writable():
    # Expired command on a non-writable tag → ttl_expired wins (TTL is step 0,
    # writable check is step 1 in 04 §5 — stale commands must not execute at all).
    res = edge_evaluate_command(
        _cmd(tag_path=READONLY, value=1.0, ttl_s=1), now=NOW + timedelta(seconds=10)
    )
    assert (res.status, res.reason) == ("rejected", "ttl_expired")


def test_edge_clock_checked_before_ttl():
    # Untrusted clock + expired TTL → clock_untrusted (can't trust the TTL
    # comparison itself; see AMBIGUITY note in schemas.edge_evaluate_command).
    res = edge_evaluate_command(
        _cmd(ttl_s=1), now=NOW + timedelta(seconds=10), clock_ok=False
    )
    assert (res.status, res.reason) == ("rejected", "clock_untrusted")


def test_edge_value_type_mismatch_bool_tag():
    # bool tag written with a number → type bug → status 'failed'
    res = edge_evaluate_command(_cmd(tag_path=WRITABLE_BOOL, value=1), now=NOW)
    assert res.status == "failed"


def test_edge_value_type_mismatch_num_tag():
    res = edge_evaluate_command(_cmd(tag_path=WRITABLE_NUM, value="fast"), now=NOW)
    assert res.status == "failed"


def test_edge_bool_is_not_accepted_as_num():
    # Python bool subclasses int — writing `true` to speed_sp is a type bug
    res = edge_evaluate_command(_cmd(tag_path=WRITABLE_NUM, value=True), now=NOW)
    assert res.status == "failed"
