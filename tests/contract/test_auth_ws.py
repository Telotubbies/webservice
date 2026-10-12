"""Auth/Z + WebSocket contract tests — CONTRACT.md "Auth" / "WebSocket /ws"."""

import pytest

from contract.schemas import (
    ROLE_ANONYMOUS,
    WS_AUTHED_EVENTS,
    WS_CLOSE_AUTH_EXPIRED,
    WS_PUBLIC_EVENTS,
    can_read,
    expected_mutation_status,
    role_for_token,
    validate_ws_event,
    ws_events_allowed,
)

GOOD_TS = "2025-01-15T08:30:00Z"


# -------------------------------------------------------------------- tokens

def test_demo_tokens_map_to_roles():
    assert role_for_token("demo-operator") == "operator"
    assert role_for_token("demo-viewer") == "viewer"


@pytest.mark.parametrize("token", [None, "", "demo-admin", "garbage", "demo-operator "])
def test_unknown_or_absent_token_is_anonymous(token):
    assert role_for_token(token) == ROLE_ANONYMOUS


# -------------------------------------------------------------- read access

@pytest.mark.parametrize("role", ["viewer", "operator", "admin", "owner"])
def test_authenticated_members_can_read(role):
    # v4 T5 / CONTRACT.v2: every /api/* read requires a member principal
    assert can_read(role)


def test_anonymous_cannot_read():
    # v4 T5: anonymous reads removed — no token -> 401 on every /api/*
    # endpoint except the machine-level health probes.
    assert not can_read(ROLE_ANONYMOUS)


# ----------------------------------------------------------- mutation access

@pytest.mark.parametrize(
    "role,endpoint,expected",
    [
        ("anonymous", "command", 401),       # no token → 401
        ("viewer", "command", 403),          # wrong role → 403
        ("operator", "command", 201),        # happy path → 201
        ("anonymous", "alarm_ack", 401),     # ack requires auth
        ("viewer", "alarm_ack", 403),        # operator-only (read+command+ack)
        ("operator", "alarm_ack", 200),
    ],
)
def test_mutation_status_matrix(role, endpoint, expected):
    assert expected_mutation_status(role, endpoint) == expected


def test_unknown_endpoint_rejected():
    with pytest.raises(ValueError):
        expected_mutation_status("operator", "drop_table")


# -------------------------------------------------------------- WS auth code

def test_ws_auth_expired_close_code_is_4401():
    # CONTRACT.md: close code **4401**. DIVERGENCE: 09 §6.6 says 4001 —
    # binding contract wins; flagged for the red-team review.
    assert WS_CLOSE_AUTH_EXPIRED == 4401


# ------------------------------------------------------------ WS event scope

def test_anonymous_ws_scope_excludes_command_events():
    # 06 §2 + 09 §7: a hypothetical public connection must not receive
    # command events. v4 T5 goes further — anonymous never connects at all
    # (first-frame auth is mandatory); the scope model stays as the
    # least-privilege floor for any non-operator principal.
    allowed = ws_events_allowed("anonymous")
    assert "command" not in allowed
    assert {"tag", "alarm", "health"} <= allowed


def test_viewer_ws_scope_excludes_command_events():
    assert "command" not in ws_events_allowed("viewer")


def test_operator_ws_scope_includes_command_events():
    assert "command" in ws_events_allowed("operator")


def test_auth_lifecycle_events_only_for_authed():
    assert "auth_expired" not in ws_events_allowed("anonymous")
    assert "auth_expired" in ws_events_allowed("operator")
    assert "auth_expiring" not in ws_events_allowed("anonymous")


def test_public_and_authed_sets_partition():
    assert WS_PUBLIC_EVENTS & {"command", "auth_expired", "auth_expiring"} == set()
    assert WS_PUBLIC_EVENTS < WS_AUTHED_EVENTS


# ----------------------------------------------------------- WS event shapes

@pytest.mark.parametrize(
    "event",
    [
        {"type": "tag", "name": "plant1.sort.line1.conv1.temp_c",
         "v": 81.2, "q": "good", "ts": GOOD_TS},
        {"type": "alarm", "id": 1, "tag": "plant1.sort.line1.conv1.temp_c",
         "rule": "overtemp", "severity": "critical", "state": "active", "ts": GOOD_TS},
        {"type": "alarm_update", "id": 1, "state": "acked"},
        {"type": "command", "command_id": "c1", "status": "done",
         "tag": "plant1.sort.line1.motor1.running"},
        {"type": "command", "command_id": "c1", "status": "denied",
         "tag": "plant1.sort.line1.motor1.running", "detail": "not_writable"},
        {"type": "health", "mqtt": "up", "edge": "up"},
        {"type": "health", "mqtt": "up", "edge": "stale"},
        {"type": "auth_expired"},
        {"type": "auth_expiring", "in_s": 300},
        {"type": "tags", "items": [{"tag": "x", "v": 1, "q": "good", "ts": GOOD_TS}]},
    ],
)
def test_ws_event_valid(event):
    assert validate_ws_event(event) == []


@pytest.mark.parametrize(
    "event,fragment",
    [
        ({"type": "tag", "name": "plant1.sort.line1.conv1.temp_c", "v": "hot",
          "q": "good", "ts": GOOD_TS}, "v must be"),
        ({"type": "tag", "name": "bad tag!!", "v": 1,
          "q": "good", "ts": GOOD_TS}, "forbidden"),
        ({"type": "tag", "v": 1, "q": "good", "ts": GOOD_TS}, "missing required field 'name'"),
        ({"type": "tag", "name": "plant1.sort.line1.conv1.temp_c", "v": 1,
          "q": "good"}, "ts must be a string"),
        ({"type": "command", "status": "done",
          "tag": "plant1.sort.line1.motor1.running"}, "missing required field 'command_id'"),
        ({"type": "command", "command_id": "c1", "status": "exploded",
          "tag": "plant1.sort.line1.motor1.running"}, "lifecycle status"),
        ({"type": "health", "mqtt": "maybe", "edge": "up"}, "health.mqtt"),
        ({"type": "health", "mqtt": "up", "edge": "dead"}, "health.edge"),
        ({"type": "auth_expiring"}, "missing required field 'in_s'"),
        ({"type": "nonsense"}, "unknown event type"),
        ({}, "unknown event type"),
        ("tag event", "JSON object"),
    ],
)
def test_ws_event_invalid(event, fragment):
    errors = validate_ws_event(event)
    assert errors, f"expected {event!r} rejected"
    assert any(fragment in e for e in errors), errors
