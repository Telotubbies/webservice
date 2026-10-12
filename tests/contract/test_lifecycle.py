"""Command lifecycle contract tests — state machine, dedup ordering, edge pipeline."""

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
WRITABLE_BOOL = "plant1.sort.line1.motor1.running"
WRITABLE_NUM = "plant1.sort.line1.motor1.speed_sp"
READONLY = "plant1.sort.line1.conv1.temp_c"
UNKNOWN = "plant1.sort.line1.ghost1.sig"


def _cmd(tag=WRITABLE_BOOL, value=True, ttl_s=5, issued_at=None):
    return {
        "command_id": "c1",
        "tag": tag,
        "value": value,
        "issued_at": (issued_at or NOW).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ttl_s": ttl_s,
        "idempotency_key": "k1",
        "user": "op",
    }


# ------------------------------------------------------------ status domains

def test_status_vocabulary_is_contract_exact():
    assert COMMAND_STATUSES == {
        "issued", "sent", "acked", "done", "denied", "failed", "timeout",
    }


def test_terminal_statuses():
    assert TERMINAL_STATUSES == {"done", "denied", "failed", "timeout"}
    for s in TERMINAL_STATUSES:
        assert is_terminal(s)
    assert not is_terminal("issued")


def test_inflight_statuses_match_one_command_per_tag_rule():
    # 05 §3: partial unique index WHERE status IN ('issued','sent')
    assert IN_FLIGHT_STATUSES == {"issued", "sent"}
    for s in IN_FLIGHT_STATUSES:
        assert not is_terminal(s)


# ---------------------------------------------------------------- transitions

@pytest.mark.parametrize(
    "frm,to",
    [
        ("issued", "sent"),
        ("issued", "failed"),     # publish itself failed
        ("issued", "timeout"),
        ("sent", "acked"),
        ("sent", "done"),         # resp mapped directly (acked observational)
        ("sent", "denied"),
        ("sent", "failed"),
        ("sent", "timeout"),      # no resp within ttl_s
        ("acked", "done"),
        ("acked", "denied"),
        ("acked", "failed"),      # edge 'error' → failed
        ("acked", "timeout"),
    ],
)
def test_legal_transitions(frm, to):
    assert is_legal_transition(frm, to), f"{frm}→{to} should be legal"


@pytest.mark.parametrize(
    "frm,to",
    [
        ("issued", "acked"),      # must pass through sent first
        ("issued", "done"),       # cannot skip publish/resp
        ("issued", "denied"),
        ("issued", "issued"),
        ("sent", "issued"),       # no backwards
        ("sent", "sent"),
        ("acked", "issued"),
        ("acked", "sent"),
        ("acked", "acked"),
        # terminals are absorbing — nothing leaves them
        ("done", "issued"), ("done", "sent"), ("done", "failed"), ("done", "done"),
        ("denied", "done"), ("denied", "sent"), ("denied", "issued"),
        ("failed", "done"), ("failed", "issued"),
        ("timeout", "done"), ("timeout", "sent"), ("timeout", "issued"),
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
    assert not is_legal_transition("bogus", "done")
    assert not is_legal_transition("issued", "bogus")


def test_happy_path_chain_issued_sent_acked_done():
    chain = ["issued", "sent", "acked", "done"]
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

def test_edge_done_on_writable_bool():
    res = edge_evaluate_command(_cmd(tag=WRITABLE_BOOL, value=True), now=NOW)
    assert res.status == "done"
    assert res.detail is None


def test_edge_done_on_in_range_setpoint():
    res = edge_evaluate_command(_cmd(tag=WRITABLE_NUM, value=45.0), now=NOW)
    assert res.status == "done"


def test_edge_denied_out_of_range_setpoint():
    for v in (-1.0, 60.1, 1e6):
        res = edge_evaluate_command(_cmd(tag=WRITABLE_NUM, value=v), now=NOW)
        assert res.status == "denied"
        assert res.detail == "out_of_range"


def test_edge_range_boundary_is_inclusive():
    for v in (0.0, 60.0):
        assert edge_evaluate_command(_cmd(tag=WRITABLE_NUM, value=v), now=NOW).status == "done"


def test_edge_denied_not_writable_readonly_tag():
    res = edge_evaluate_command(_cmd(tag=READONLY, value=12.0), now=NOW)
    assert (res.status, res.detail) == ("denied", "not_writable")


def test_edge_denied_not_writable_unknown_tag():
    res = edge_evaluate_command(_cmd(tag=UNKNOWN, value=1.0), now=NOW)
    assert (res.status, res.detail) == ("denied", "not_writable")


def test_edge_denied_ttl_expired():
    res = edge_evaluate_command(
        _cmd(ttl_s=5), now=NOW + timedelta(seconds=6)
    )
    assert (res.status, res.detail) == ("denied", "ttl_expired")


def test_edge_ttl_boundary_not_expired():
    # now == issued_at + ttl → not strictly greater → still executable
    res = edge_evaluate_command(_cmd(ttl_s=5), now=NOW + timedelta(seconds=5))
    assert res.status == "done"


def test_edge_denied_clock_untrusted():
    res = edge_evaluate_command(_cmd(), now=NOW, clock_ok=False)
    assert (res.status, res.detail) == ("denied", "clock_untrusted")


def test_edge_ttl_checked_before_writable():
    # Expired command on a non-writable tag → ttl_expired wins (TTL is step 0,
    # writable check is step 1 in 04 §5 — stale commands must not execute at all).
    res = edge_evaluate_command(
        _cmd(tag=READONLY, value=1.0, ttl_s=1), now=NOW + timedelta(seconds=10)
    )
    assert (res.status, res.detail) == ("denied", "ttl_expired")


def test_edge_clock_checked_before_ttl():
    # Untrusted clock + expired TTL → clock_untrusted (can't trust the TTL
    # comparison itself; see AMBIGUITY note in schemas.edge_evaluate_command).
    res = edge_evaluate_command(
        _cmd(ttl_s=1), now=NOW + timedelta(seconds=10), clock_ok=False
    )
    assert (res.status, res.detail) == ("denied", "clock_untrusted")


def test_edge_value_type_mismatch_bool_tag():
    # bool tag written with a number → not a 'denied' detail in the contract
    # set → status 'error' (maps to backend 'failed'). Flagged AMBIGUITY.
    res = edge_evaluate_command(_cmd(tag=WRITABLE_BOOL, value=1), now=NOW)
    assert res.status == "error"


def test_edge_value_type_mismatch_num_tag():
    res = edge_evaluate_command(_cmd(tag=WRITABLE_NUM, value="fast"), now=NOW)
    assert res.status == "error"


def test_edge_bool_is_not_accepted_as_num():
    # Python bool subclasses int — writing `true` to speed_sp is a type bug
    res = edge_evaluate_command(_cmd(tag=WRITABLE_NUM, value=True), now=NOW)
    assert res.status == "error"
