"""Backend vision rules/events validation (roadmap 9.7/9.8): cfg-shaped rule
validators, MQTT event/audit ingest parsing, fail-closed signature checks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.vision.events import parse_audit, parse_event
from app.vision.rulecfg import validate_actions, validate_conditions


# ----------------------------------------------------------- cfg validators
def test_conditions_accept_valid():
    cond = validate_conditions({
        "class_ids": [0, 2], "min_score": 0.4,
        "zone": [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
        "min_area": 0.01, "hold_frames": 3, "hold_ms": 500, "count_in_zone": 2})
    assert cond["class_ids"] == [0, 2] and cond["hold_frames"] == 3


def test_conditions_reject():
    for bad in [None, {}, {"class_ids": []}, {"class_ids": ["a"]},
                {"class_ids": [0], "min_score": 1.5},
                {"class_ids": [0], "zone": [[0, 0], [1, 1]]},          # <3 points
                {"class_ids": [0], "zone": [[0, 0], [1, 1], [2, 2]]},  # 2 not in 0..1
                {"class_ids": [0], "hold_frames": 0},
                {"class_ids": [0], "hold_ms": 99_999},
                {"class_ids": [0], "count_in_zone": 0}]:
        with pytest.raises(ValueError):
            validate_conditions(bad)


def test_actions_accept_valid():
    acts = validate_actions([
        {"kind": "plc_write", "tag_path": "a/b/motor", "value": True, "pulse_ms": 500},
        {"kind": "counter", "tag_path": "a/b/count", "by": 1},
        {"kind": "alarm", "severity": "critical", "message": "person in cell"},
        {"kind": "snapshot"}])
    assert [a["kind"] for a in acts] == ["plc_write", "counter", "alarm", "snapshot"]


def test_actions_reject():
    for bad in [None, [], [{"kind": "nope"}],
                [{"kind": "plc_write", "tag_path": "x", "value": "on"}],
                [{"kind": "plc_write", "tag_path": "", "value": 1}],
                [{"kind": "counter", "tag_path": "a", "by": "lots"}],
                [{"kind": "alarm", "severity": "fatal"}],
                [{"kind": "plc_write", "tag_path": "a", "value": float("nan")}]]:
        with pytest.raises(ValueError):
            validate_actions(bad)


# ----------------------------------------------------------------- events in
def _event(**kw):
    doc = {"camera_id": str(uuid.uuid4()), "kind": "rule_fire", "class_id": 0,
           "score": 0.9, "bbox": [0.1, 0.1, 0.2, 0.2],
           "fired_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    doc.update(kw)
    return json.dumps(doc).encode()


def test_parse_event_happy():
    ev = parse_event(_event())
    assert ev is not None and ev["kind"] == "rule_fire" and ev["class_id"] == 0


def test_parse_event_rejects_bad():
    assert parse_event(b"{") is None
    assert parse_event(b'"x"') is None
    assert parse_event(_event(kind="hack")) is None
    assert parse_event(_event(camera_id="not-a-uuid")) is None
    assert parse_event(_event(score=7)) is None
    assert parse_event(_event(bbox=[0, 0, 1])) is None
    assert parse_event(_event(class_id=-1)) is None
    assert parse_event(_event(thumb_b64="###")) is None
    assert parse_event(_event(thumb_b64=base64.b64encode(b"PNG?").decode())) is None
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    assert parse_event(_event(fired_at=future)) is None
    assert parse_event(b"x" * (200 * 1024)) is None


def test_parse_event_thumb_roundtrip():
    jpeg = b"\xff\xd8\xff" + b"\x00" * 100
    ev = parse_event(_event(thumb_b64=base64.b64encode(jpeg).decode()))
    assert ev is not None and ev["thumb"] == jpeg


# ----------------------------------------------------------------- audits in
def _signed(rec: dict, secret: str) -> bytes:
    key = hashlib.sha256(secret.encode()).digest()
    msg = json.dumps({k: v for k, v in rec.items() if k != "sig"},
                     sort_keys=True, separators=(",", ":")).encode()
    out = dict(rec)
    out["sig"] = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return json.dumps(out).encode()


def _audit_rec(**kw):
    doc = {"command_id": str(uuid.uuid4()), "rule_id": str(uuid.uuid4()),
           "tag_path": "a/b/motor", "value": True, "source": "edge_rule",
           "fired_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    doc.update(kw)
    return doc


def test_parse_audit_shape():
    rec = parse_audit(_signed(_audit_rec(), "pw"))
    assert rec is not None and rec["tag_path"] == "a/b/motor" and len(rec["sig"]) == 64


def test_parse_audit_rejects_bad_shape():
    assert parse_audit(b"{") is None
    assert parse_audit(_signed(_audit_rec(command_id="x"), "pw")) is None
    assert parse_audit(_signed(_audit_rec(value="high"), "pw")) is None
    assert parse_audit(json.dumps(_audit_rec()).encode()) is None   # no sig at all
    assert parse_audit(_signed(_audit_rec(fired_at="yesterday"), "pw")) is None
    assert parse_audit(b"x" * (20 * 1024)) is None


def test_audit_signature_fails_closed():
    """Tampering with ANY field must change the canonical message bytes the
    verifier recomputes — the same path handle_audit takes."""
    from app.vision.events import _audit_message
    secret = "pw"
    rec = json.loads(_signed(_audit_rec(), secret))
    key = hashlib.sha256(secret.encode()).digest()
    good = hmac.new(key, _audit_message(rec), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(good, rec["sig"])
    for field, val in (("tag_path", "a/b/other"), ("value", False),
                       ("fired_at", "2000-01-01T00:00:00Z")):
        tampered = dict(rec, **{field: val})
        bad = hmac.new(key, _audit_message(tampered), hashlib.sha256).hexdigest()
        assert not hmac.compare_digest(bad, rec["sig"])   # stored sig no longer verifies
