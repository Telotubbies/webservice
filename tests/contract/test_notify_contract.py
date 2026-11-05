"""Offline contract for notify.py's pure seams (roadmap §7 Phase 3):
channel config validation + secret split, ack-token sign/parse, the
`send_email` job payload contract, escalation level validation, and the
ISA-18.2 _quality metrics — checked against a hand count.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("fastapi")

from app.core import config
from app.alarming import notify
from app.db.util import utcnow

ORG = uuid.uuid4()
ALARM = uuid.uuid4()
JTI = uuid.uuid4()


# ---------------------------------------------------------------- config split
def test_email_config_splits_recipients_and_smtp_password():
    pub, sec = notify._split_config(
        "email",
        {"to": ["a@b.co", " c@d.co "],
         "smtp": {"host": "smtp.x", "port": 2525, "user": "u", "from": "f@x"}},
        {"smtp_pass": "s3cret"})
    assert pub["to"] == ["a@b.co", "c@d.co"]
    assert pub["smtp"]["host"] == "smtp.x" and pub["smtp"]["port"] == 2525
    assert "smtp_pass" not in pub and sec["smtp_pass"] == "s3cret"


def test_email_requires_recipients():
    with pytest.raises(ValueError):
        notify._split_config("email", {"to": []}, {})
    with pytest.raises(ValueError):
        notify._split_config("email", {"to": ["not-an-email"]}, {})


def test_line_requires_secret_token_not_config():
    with pytest.raises(ValueError):
        notify._split_config("line", {"to": "U123"}, {"token": "short"})
    pub, sec = notify._split_config("line", {"to": "U123"}, {"token": "x" * 40})
    assert pub == {"to": "U123"} and sec["token"] == "x" * 40


def test_webhook_url_is_secret_and_bounded():
    with pytest.raises(ValueError):
        notify._split_config("webhook", {}, {"url": "ftp://x"})
    with pytest.raises(ValueError):
        notify._split_config("webhook", {}, {"url": "no-scheme"})
    pub, sec = notify._split_config(
        "webhook", {}, {"url": "https://hooks.example.com/t", "secret": "s"})
    assert pub == {} and sec["url"].startswith("https://") and sec["secret"] == "s"
    # target hint exposes the host, never the path/token
    assert notify._target_hint("webhook", pub, sec) == "hooks.example.com"


def test_unknown_type_rejected():
    with pytest.raises(ValueError):
        notify._split_config("pagerduty", {}, {})


# ------------------------------------------------------------------ ack tokens
def test_ack_token_roundtrip():
    exp = int(time.time()) + 3600
    tok = notify.make_ack_token(ORG, ALARM, JTI, exp)
    assert notify.parse_ack_token(tok) == (ORG, ALARM, JTI, exp)


def test_ack_token_tamper_fails():
    exp = int(time.time()) + 3600
    tok = notify.make_ack_token(ORG, ALARM, JTI, exp)
    other = uuid.uuid4().hex
    assert notify.parse_ack_token(tok.replace(JTI.hex, other)) is None
    assert notify.parse_ack_token(tok + "x") is None
    assert notify.parse_ack_token("garbage") is None
    assert notify.parse_ack_token("") is None


def test_ack_token_expired_fails():
    exp = int(time.time()) - 10
    tok = notify.make_ack_token(ORG, ALARM, JTI, exp)
    assert notify.parse_ack_token(tok) is None


# -------------------------------------------------------------- send_email job
def test_email_payload_accepts_and_bounds():
    big = "A" * 10
    to, subject, body, atts = notify._email_payload({
        "to": "a@b.co", "subject": "s", "body": "b",
        "attachments": [{"name": "r.csv", "content_b64": "QUJD",
                         "content_type": "text/csv"}]})
    assert to == ["a@b.co"] and subject == "s"
    assert atts[0]["name"] == "r.csv" and atts[0]["content_type"] == "text/csv"
    # subject/body bounded
    _, s2, b2, _ = notify._email_payload(
        {"to": ["a@b.co"], "subject": big * 100, "body": big * 5000})
    assert len(s2) == 300 and len(b2) == 20000


def test_email_payload_rejects_bad_to_and_huge_attachments():
    with pytest.raises(ValueError):
        notify._email_payload({"to": ["bad"], "subject": "s", "body": "b"})
    with pytest.raises(ValueError):
        notify._email_payload({"to": [f"a{i}@b.co" for i in range(30)],
                               "subject": "s", "body": "b"})
    with pytest.raises(ValueError):
        notify._email_payload({"to": ["a@b.co"], "subject": "s", "body": "b",
                               "attachments": [{"content_b64": "A" * (4 * 1024 * 1024)}]})


# ------------------------------------------------------------------- levels
def test_levels_validated_and_sorted():
    lv = notify._levels([{"after_minutes": 5, "channel_ids": [str(uuid.uuid4())]},
                         {"after_minutes": 30, "team_ids": [str(uuid.uuid4())]}])
    assert [x["after_minutes"] for x in lv] == [5, 30]
    with pytest.raises(ValueError):
        notify._levels([])
    with pytest.raises(ValueError):
        notify._levels([{"after_minutes": 30}, {"after_minutes": 5}])
    with pytest.raises(ValueError):
        notify._levels([{"after_minutes": 0}])
    with pytest.raises(ValueError):
        notify._levels([{"after_minutes": 5, "channel_ids": ["not-a-uuid"]}])


# ----------------------------------------------------------------- _quality
def _row(rule, state, raised, acked=None, cleared=None, sev="warning"):
    return {"rule_id": rule, "rule": f"rule-{str(rule)[:4]}", "severity": sev,
            "state": state, "raised_at": raised, "acked_at": acked,
            "cleared_at": cleared}


def test_quality_matches_hand_count():
    now = datetime.now(timezone.utc)
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    rows = [
        # r1: 3 activations inside 60 s -> chattering
        _row(r1, "cleared", now - timedelta(hours=2),
             cleared=now - timedelta(hours=2) + timedelta(seconds=30)),
        _row(r1, "cleared", now - timedelta(hours=2) + timedelta(seconds=20),
             cleared=now - timedelta(hours=2) + timedelta(seconds=40)),
        _row(r1, "cleared", now - timedelta(hours=2) + timedelta(seconds=45)),
        # r1: standing + unacked, older than 24 h
        _row(r1, "active", now - timedelta(hours=30), sev="critical"),
        # r2: one acked alarm, mtta 600 s
        _row(r2, "cleared", now - timedelta(hours=3),
             acked=now - timedelta(hours=3) + timedelta(seconds=600)),
    ]
    m = notify._quality(rows, hours=24.0, operators=5)
    assert m["total"] == 5
    assert m["alarms_per_hour"] == round(5 / 24, 2)
    assert m["alarms_per_operator_hour"] == round(5 / 24 / 5, 3)
    assert m["standing"] == 1            # the 30 h-old still-active alarm
    assert m["unacked"] == 1
    # the 30 h-old standing alarm predates the 24 h histogram window
    assert len(m["hourly"]) == 24 and sum(m["hourly"]) == 4
    by = {x["rule_id"]: x for x in m["rules"]}
    a, b = by[str(r1)], by[str(r2)]
    assert a["count"] == 4 and abs(a["share"] - 0.8) < 1e-9
    assert a["chatter"] >= 1             # 3-in-60s burst flagged
    assert a["standing"] == 1 and a["unacked"] == 1
    assert b["count"] == 1 and b["mtta_s"] == 600 and b["chatter"] == 0
    assert "chatter" in a["flags"] and "unacked" in a["flags"]
    assert m["rules"][0]["rule_id"] == str(r1)   # top bad actor first


def test_quality_empty_window():
    m = notify._quality([], hours=24.0, operators=0)
    assert m["total"] == 0 and m["alarms_per_hour"] == 0 and m["rules"] == []


# --------------------------------------------------------------- vision sweep
def test_vision_conditions_mapping():
    # dead relay + non-ok persisted status -> offline
    assert notify._vision_conditions({"status": "error"}, {}, None) == ["camera_offline"]
    # dead relay but a very recent ok status -> not offline yet
    fresh_ok = {"status": "ok", "status_at": utcnow()}
    assert notify._vision_conditions(fresh_ok, {}, None) == []
    # stale status_at even with status 'ok' -> offline
    stale_ok = {"status": "ok",
                "status_at": utcnow() - timedelta(seconds=config.VISION_OFFLINE_AFTER_S + 1)}
    assert "camera_offline" in notify._vision_conditions(stale_ok, {}, None)
    st = {"model_state": "error", "latency_ms": config.VISION_LATENCY_BUDGET_MS + 1,
          "placement": "cloud"}
    got = set(notify._vision_conditions({"status": "ok", "status_at": utcnow()}, st, None))
    assert {"model_load_failed", "latency_budget", "cloud_fallback"} <= got
    ok = {"model_state": "ready", "latency_ms": 10.0, "placement": "edge"}
    assert notify._vision_conditions(fresh_ok, ok, None) == []
    assert notify._vision_conditions(fresh_ok, ok, 85.0) == ["gpu_budget"]
    assert notify._vision_conditions(fresh_ok, ok, 10.0) == []
