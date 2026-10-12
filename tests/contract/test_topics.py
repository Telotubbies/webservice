"""Topic/tag-name contract tests — CONTRACT.md "MQTT topics" + 05 §1 governance."""

import pytest

from contract.schemas import (
    SITE,
    EDGE_ID,
    classify_topic,
    tag_to_topic,
    topic_to_tag,
    validate_tag_name,
)


# ---------------------------------------------------------------- tag names

@pytest.mark.parametrize(
    "tag",
    [
        "plant1.sort.line1.motor1.running",
        "plant1.sort.line1.motor1.speed_sp",
        "plant1.sort.line1.conv1.temp_c",
        "plant1.sort.vision.cam1.gravel_ratio",
        "plant1.sort.line1._derived.oee",  # computed tag convention (05 §1)
    ],
)
def test_valid_tag_names(tag):
    assert validate_tag_name(tag) == []


@pytest.mark.parametrize(
    "tag,fragment",
    [
        ("", "non-empty"),
        ("plant1.sort.line1.conv1", "exactly 5 segments"),       # too few
        ("plant1.sort.line1.conv1.temp_c.extra", "exactly 5"),   # too many
        ("plant2.sort.line1.conv1.temp_c", "site segment"),      # wrong site
        ("plant1.sort.line1.conv1.Temp_C", "must match"),        # uppercase
        ("plant1.sort.line1.conv1.temp-c", "must match"),        # dash in tag seg
        ("plant1.sort..conv1.temp_c", "must match"),             # empty segment
        (" plant1.sort.line1.conv1.temp_c", "whitespace"),
        ("plant1.sort.line1.conv1.temp_c ", "whitespace"),
        ("plant1.sort.line1._aux.oee", "must not start with '_'"),  # real device '_' forbidden
        ("plant1.cmd.line1.dev.sig", "reserved"),                # cmd subtree reserved
        ("plant1.sys.line1.dev.sig", "reserved"),                # sys subtree reserved
        ("plant1.edge.line1.dev.sig", "reserved"),               # heartbeat subtree reserved
        ("plant1.sort.line1.conv1.temp_c#", "forbidden"),        # wildcard char
        ("plant1.sort.line1.conv1.temp+c", "forbidden"),
        # ATTACK_PLAN: SQL-ish tag name must be rejected before it reaches any SQL
        ("a.b'; DROP TABLE--", "forbidden"),
        ("plant1.sort.line1.conv1.x' OR '1'='1", "forbidden"),
        ("plant1.sort.line1.conv1.temp_c;", "forbidden"),
        (None, "must be a string"),
        (123, "must be a string"),
    ],
)
def test_invalid_tag_names(tag, fragment):
    errors = validate_tag_name(tag)
    assert errors, f"expected {tag!r} to be rejected"
    assert any(fragment in e for e in errors), errors


def test_tag_topic_round_trip():
    tag = "plant1.sort.line1.conv1.temp_c"
    assert topic_to_tag(tag_to_topic(tag)) == tag
    assert tag_to_topic(tag) == "plant1/sort/line1/conv1/temp_c"


# ------------------------------------------------------------- topic parsing

def test_classify_telemetry_topic():
    info = classify_topic("plant1/sort/line1/conv1/temp_c")
    assert info.kind == "telemetry"
    assert info.tag == "plant1.sort.line1.conv1.temp_c"
    assert info.errors == []


def test_classify_heartbeat_topic():
    info = classify_topic(f"{SITE}/edge/{EDGE_ID}/heartbeat")
    assert info.kind == "heartbeat"
    assert info.edge_id == EDGE_ID
    assert info.errors == []


def test_classify_command_topic():
    info = classify_topic(f"{SITE}/cmd/{EDGE_ID}/req-123-abc")
    assert info.kind == "command"
    assert info.edge_id == EDGE_ID
    assert info.req_id == "req-123-abc"


def test_classify_command_response_topic():
    info = classify_topic(f"{SITE}/cmd-resp/{EDGE_ID}/req-123-abc")
    assert info.kind == "command_response"
    assert info.req_id == "req-123-abc"


@pytest.mark.parametrize(
    "topic",
    [
        "plant2/sort/line1/conv1/temp_c",        # wrong site
        "plant1/sort/line1/conv1",               # 4 segments, not a reserved subtree
        "plant1/sort/line1/conv1/temp_c/extra",  # 6 segments
        "plant1//line1/conv1/temp_c",            # empty segment
        "/plant1/sort/line1/conv1/temp_c",       # leading slash
        "plant1/sort/line1/conv1/temp_c/",       # trailing slash
        "plant1/sort/line1/conv1/temp c",        # space in segment
        "plant1/sort/line1/conv1/temp_c#",       # wildcard char
        "plant1/+/line1/conv1/temp_c",           # '+' segment
        "plant1/#",                              # '#' segment
        "plant1/sort/line1/conv1/temp\x00c",     # NUL
        "plant1/SORT/line1/conv1/temp_c",        # uppercase fails tag rules
        "plant1/cmd/edge1",                      # truncated command topic
        "plant1/cmd-resp/edge1/",                # trailing slash → empty segment
        "plant1/edge/edge1/heartbeat/extra",     # heartbeat must be exactly 4 segs
        "",
        "x",
    ],
)
def test_classify_invalid_topics(topic):
    info = classify_topic(topic)
    assert info.kind == "invalid", f"expected {topic!r} invalid, got {info.kind}"
    assert info.errors


def test_classify_sys_topic_is_recognized_but_not_telemetry():
    info = classify_topic("plant1/sys/edge1/health")
    assert info.kind == "sys"
    assert info.tag is None


def test_cmd_resp_area_position_is_not_telemetry():
    # A 5-segment topic under cmd/ is NOT a valid telemetry tag — the subtree
    # is reserved, so governance rule "cmd outside UNS namespace" holds.
    info = classify_topic("plant1/cmd/edge1/x/y")
    assert info.kind == "invalid"


def test_oversized_topic_rejected():
    topic = "plant1/" + "a" * 70000
    assert classify_topic(topic).kind == "invalid"


def test_heartbeat_wrong_site_rejected():
    assert classify_topic("plant9/edge/edge1/heartbeat").kind == "invalid"
