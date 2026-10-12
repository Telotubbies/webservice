"""Topic contract tests — doc 17 §1 v2 namespace (BINDING) + tag governance."""

import pytest

from contract.schemas import (
    EDGE_UUID,
    ORG_ID,
    SITE_ID,
    classify_topic,
    is_uuid,
    tag_to_topic,
    topic_to_tag,
    validate_tag_name,
)

P = f"v2/{ORG_ID}/{SITE_ID}/{EDGE_UUID}"


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


# ------------------------------------------------------------- v2 topic parsing

def test_is_uuid_accepts_canonical_form():
    assert is_uuid(ORG_ID) and is_uuid(SITE_ID) and is_uuid(EDGE_UUID)


@pytest.mark.parametrize("value", ["plant1", "edge1", "", "svc-backend",
                                   "0199d000-0000-7000-8000",  # truncated
                                   "0199d000-0000-7000-8000-00000000C001",  # uppercase
                                   "x199d000-0000-7000-8000-00000000c001",
                                   "0199d000_0000_7000_8000_00000000c001"])
def test_is_uuid_rejects_human_names_and_garbage(value):
    assert not is_uuid(value)


def test_classify_telemetry_topic():
    info = classify_topic(f"{P}/tele/sort/line1/conv1/temp_c")
    assert info.kind == "telemetry"
    assert info.tag_path == "sort/line1/conv1/temp_c"
    assert info.org_id == ORG_ID and info.site_id == SITE_ID and info.edge_id == EDGE_UUID
    assert info.errors == []


def test_classify_heartbeat_topic():
    info = classify_topic(f"{P}/hb")
    assert info.kind == "heartbeat"
    assert info.edge_id == EDGE_UUID
    assert info.errors == []


def test_classify_command_topic():
    info = classify_topic(f"{P}/cmd/req-123-abc")
    assert info.kind == "command"
    assert info.command_id == "req-123-abc"


def test_classify_command_response_topic():
    info = classify_topic(f"{P}/cmd-resp/req-123-abc")
    assert info.kind == "command_response"
    assert info.command_id == "req-123-abc"


def test_classify_cross_org_topic_is_structurally_valid():
    # Different org UUID is a LEGAL topic — the broker ACL is what denies it.
    other = "0199d000-0000-7000-8000-ffffffffffaa"
    info = classify_topic(f"v2/{other}/{SITE_ID}/{EDGE_UUID}/hb")
    assert info.kind == "heartbeat"
    assert info.org_id == other


@pytest.mark.parametrize(
    "topic",
    [
        # v1 topics — doc 17: human-name namespace is gone entirely
        "plant1/sort/line1/conv1/temp_c",
        "plant1/edge/edge1/heartbeat",
        "plant1/cmd/edge1/req-1",
        "plant1/cmd-resp/edge1/req-1",
        # v2 shape violations
        "v2/plant1/0199d000-0000-7000-8000-00000000b001/0199d000-0000-7000-8000-00000000c001/hb",
        f"{P}",                                   # prefix only, no kind
        f"{P}/tele",                              # empty path
        f"{P}/tele/sort/line1/conv1/temp-c",      # dash illegal in tag path
        f"{P}/tele/sort/line1/conv1/temp c",      # space
        f"{P}/hb/extra",
        f"{P}/cmd",                               # missing command_id
        f"{P}/cmd/a/b",                           # too deep
        f"{P}/cmd-resp",                          # missing command_id
        f"{P}/sys/x",
        f"v2/{ORG_ID}/{SITE_ID}/{EDGE_UUID}/tele/sort//conv1/x",
        f"{P}/tele/sort/line1/conv1/temp_c#",
        f"{P}/tele/+/x",
        "v2",
        "v2/",
        "",
        "x",
        f"{P}/hb ".strip() + " ",                 # trailing space — shape error
    ],
)
def test_classify_invalid_topics(topic):
    info = classify_topic(topic)
    assert info.kind == "invalid", f"expected {topic!r} invalid, got {info.kind}"
    assert info.errors


def test_oversized_topic_rejected():
    assert classify_topic(f"{P}/tele/" + "a" * 70000).kind == "invalid"


def test_nul_rejected():
    assert classify_topic(f"{P}/tele/sort/line1/conv1/temp\x00c").kind == "invalid"
