"""Command payload contract tests — REST request, MQTT cmd, cmd-resp, alarms."""

import pytest

from contract.schemas import (
    map_edge_status,
    validate_alarm,
    validate_command_response,
    validate_mqtt_command,
    validate_rest_command_request,
)

GOOD_TS = "2025-01-15T08:30:00Z"
WRITABLE_BOOL = "plant1.sort.line1.motor1.running"
WRITABLE_NUM = "plant1.sort.line1.motor1.speed_sp"


def _req(**kw):
    base = {"tag": WRITABLE_BOOL, "value": True}
    base.update(kw)
    return base


def _mqtt_cmd(**kw):
    base = {
        "command_id": "cmd-1",
        "tag": WRITABLE_BOOL,
        "value": True,
        "issued_at": GOOD_TS,
        "ttl_s": 5,
        "idempotency_key": "idem-1",
        "user": "operator@demo",
    }
    base.update(kw)
    return base


# ------------------------------------------------------- REST command request

@pytest.mark.parametrize(
    "payload",
    [
        _req(),
        _req(tag=WRITABLE_NUM, value=45.0),
        _req(value=0),
        _req(ttl_s=5),
        _req(ttl_s=0.5),
        _req(idempotency_key="uuid-v4-whatever"),
        _req(ttl_s=10, idempotency_key="k"),
        _req(reason="operator stop"),   # 06 §1 extra field — tolerated
    ],
)
def test_rest_request_valid(payload):
    assert validate_rest_command_request(payload) == []


@pytest.mark.parametrize(
    "payload,fragment",
    [
        # ttl_s edge cases — the headline adversarial surface
        (_req(ttl_s=0), "ttl_s must be > 0"),
        (_req(ttl_s=-1), "ttl_s must be > 0"),
        (_req(ttl_s=-0.0001), "ttl_s must be > 0"),
        (_req(ttl_s=float("nan")), "ttl_s must be a finite number"),
        (_req(ttl_s=float("inf")), "ttl_s must be a finite number"),
        (_req(ttl_s="5"), "ttl_s must be a finite number"),
        (_req(ttl_s=True), "ttl_s must be a finite number"),   # bool is not a number
        (_req(ttl_s=None), "ttl_s must be a finite number"),
        # missing / bad tag
        ({"value": True}, "missing required field 'tag'"),
        (_req(tag=""), "non-empty"),
        (_req(tag="plant2.sort.line1.motor1.running"), "site segment"),
        (_req(tag="not-a-tag"), "exactly 5"),
        (_req(tag=123), "must be a string"),
        (_req(tag="a.b'; DROP TABLE--"), "forbidden"),
        # missing / bad value
        ({"tag": WRITABLE_BOOL}, "missing required field 'value'"),
        (_req(value="true"), "value must be"),
        (_req(value=float("nan")), "value must be"),
        (_req(value=None), "value must be"),
        # idempotency key
        (_req(idempotency_key=123), "idempotency_key"),
        (_req(idempotency_key=""), "idempotency_key"),
        (_req(idempotency_key="x" * 300), "idempotency_key"),
        (_req(idempotency_key=None), "idempotency_key"),
        # not an object at all
        ("tag=x", "JSON object"),
        ([1, 2], "JSON object"),
    ],
)
def test_rest_request_invalid(payload, fragment):
    errors = validate_rest_command_request(payload)
    assert errors, f"expected {payload!r} rejected"
    assert any(fragment in e for e in errors), errors


def test_rest_request_ttl_s_absent_is_fine():
    # ttl_s optional per contract — backend applies a default
    assert validate_rest_command_request({"tag": WRITABLE_BOOL, "value": True}) == []


# -------------------------------------------------------------- MQTT command

def test_mqtt_command_valid():
    assert validate_mqtt_command(_mqtt_cmd()) == []


@pytest.mark.parametrize(
    "field",
    ["command_id", "tag", "value", "issued_at", "ttl_s", "idempotency_key", "user"],
)
def test_mqtt_command_missing_fields(field):
    cmd = _mqtt_cmd()
    del cmd[field]
    errors = validate_mqtt_command(cmd)
    assert any(f"missing required field {field!r}" in e for e in errors), errors


@pytest.mark.parametrize(
    "payload,fragment",
    [
        (_mqtt_cmd(command_id=""), "command_id"),
        (_mqtt_cmd(command_id=None), "command_id"),
        (_mqtt_cmd(tag="bogus"), "exactly 5"),
        (_mqtt_cmd(issued_at="now"), "ISO8601"),
        (_mqtt_cmd(issued_at=None), "ts must be a string"),
        (_mqtt_cmd(ttl_s=0), "ttl_s must be > 0"),
        (_mqtt_cmd(ttl_s=-3), "ttl_s must be > 0"),
        (_mqtt_cmd(ttl_s=float("nan")), "finite"),
        (_mqtt_cmd(ttl_s="5"), "finite"),
        (_mqtt_cmd(idempotency_key=""), "idempotency_key"),
        (_mqtt_cmd(idempotency_key=42), "idempotency_key"),
        (_mqtt_cmd(user=""), "user"),
        (_mqtt_cmd(user=None), "user"),
        (_mqtt_cmd(value="high"), "value must be"),
        ("not json", "JSON object"),
    ],
)
def test_mqtt_command_invalid(payload, fragment):
    errors = validate_mqtt_command(payload)
    assert errors, f"expected {payload!r} rejected"
    assert any(fragment in e for e in errors), errors


# ----------------------------------------------------------------- cmd-resp

@pytest.mark.parametrize(
    "payload",
    [
        {"command_id": "c1", "status": "done"},
        {"command_id": "c1", "status": "done", "detail": "write confirmed"},
        {"command_id": "c1", "status": "denied", "detail": "not_writable"},
        {"command_id": "c1", "status": "denied", "detail": "interlock"},
        {"command_id": "c1", "status": "denied", "detail": "ttl_expired"},
        {"command_id": "c1", "status": "denied", "detail": "clock_untrusted"},
        {"command_id": "c1", "status": "denied", "detail": "out_of_range"},
        {"command_id": "c1", "status": "error", "detail": "adapter exploded"},
    ],
)
def test_command_response_valid(payload):
    assert validate_command_response(payload) == []


@pytest.mark.parametrize(
    "payload,fragment",
    [
        # 'timeout' is assigned by the BACKEND, never sent by the edge (05 §3)
        ({"command_id": "c1", "status": "timeout"}, "never sends 'timeout'"),
        ({"command_id": "c1", "status": "issued"}, "status must be"),
        ({"command_id": "c1", "status": "acked"}, "status must be"),
        ({"command_id": "c1", "status": "ok"}, "status must be"),
        # denied requires a detail from the fixed set
        ({"command_id": "c1", "status": "denied"}, "requires detail"),
        ({"command_id": "c1", "status": "denied", "detail": "no"}, "requires detail"),
        ({"command_id": "c1", "status": "denied", "detail": "TIMEOUT"}, "requires detail"),
        ({"status": "done"}, "command_id"),
        ({"command_id": "", "status": "done"}, "command_id"),
        ({"command_id": "c1", "status": "done", "detail": 5}, "detail must be"),
        ("done", "JSON object"),
    ],
)
def test_command_response_invalid(payload, fragment):
    errors = validate_command_response(payload)
    assert errors, f"expected {payload!r} rejected"
    assert any(fragment in e for e in errors), errors


def test_edge_status_mapping():
    assert map_edge_status("done") == "done"
    assert map_edge_status("denied") == "denied"
    assert map_edge_status("error") == "failed"
    with pytest.raises(ValueError):
        map_edge_status("timeout")
    with pytest.raises(ValueError):
        map_edge_status("bogus")


# -------------------------------------------------------------------- alarms

def test_alarm_valid():
    assert validate_alarm(
        {
            "id": 7,
            "tag": "plant1.sort.line1.conv1.temp_c",
            "rule": "conv1_overtemp",
            "severity": "critical",
            "state": "active",
            "ts": GOOD_TS,
        }
    ) == []


@pytest.mark.parametrize(
    "payload,fragment",
    [
        ({"id": 1, "tag": "x", "rule": "r", "severity": "critical",
          "state": "active", "ts": GOOD_TS}, "exactly 5"),
        ({"id": 1, "tag": "plant1.sort.line1.conv1.temp_c", "rule": "r",
          "severity": "fatal", "state": "active", "ts": GOOD_TS}, "severity"),
        ({"id": 1, "tag": "plant1.sort.line1.conv1.temp_c", "rule": "r",
          "severity": "critical", "state": "cleared", "ts": GOOD_TS}, "state"),
        # NOTE: 'cleared' exists in 05 §3 DB CHECK but not in the CONTRACT.md
        # alarm shape (state:active|acked) — binding doc wins, flagged.
        ({"id": 1, "tag": "plant1.sort.line1.conv1.temp_c", "rule": "r",
          "severity": "critical", "state": "active"}, "missing required field 'ts'"),
        ({"id": 1, "tag": "plant1.sort.line1.conv1.temp_c", "rule": "r",
          "severity": "critical", "state": "active", "ts": "soon"}, "ISO8601"),
    ],
)
def test_alarm_invalid(payload, fragment):
    errors = validate_alarm(payload)
    assert errors, f"expected {payload!r} rejected"
    assert any(fragment in e for e in errors), errors
