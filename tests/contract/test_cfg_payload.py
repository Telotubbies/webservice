"""Edge config delivery: payload shape, cfg-req / cfg-ack parsing, ACLs (pure)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.datasources.publisher import (  # noqa: E402
    cfg_payload,
    cfg_topic,
    parse_cfg_ack,
    parse_cfg_req,
    should_send,
    stale_publish,
)
from app.dynsec import BACKEND_ACLS, edge_acls  # noqa: E402
from app.mqtt_client import SUBSCRIPTIONS  # noqa: E402

S1, S2, T1 = "s-1", "s-2", "t-1"


def _src(sid, enabled=True, secrets=None):
    return {"id": sid, "protocol": "modbus", "connection": {"host": "10.0.0.5"},
            "poll_ms": 500, "enabled": enabled, "secrets": secrets}


def _tag():
    return {"id": T1, "path": "line1/m1/speed", "type": "float", "address": {"area": "hr"},
            "scale": 0.1, "offset": None, "writable": False, "min": 0.0, "max": 10.0,
            "unit": "rpm", "name": "speed", "line": "line1"}


def test_cfg_payload_shape():
    p = cfg_payload(7, [_src(S1, secrets={"password": "x"}), _src(S2, enabled=False)],
                    {S1: [_tag()], S2: [_tag()]})
    assert p["version"] == 7
    assert [s["id"] for s in p["sources"]] == [S1]  # disabled omitted
    s = p["sources"][0]
    assert set(s) == {"id", "protocol", "connection", "secrets", "poll_ms", "enabled", "tags"}
    assert s["enabled"] is True and s["secrets"] == {"password": "x"}
    assert set(s["tags"][0]) == {"id", "path", "type", "address", "scale", "offset",
                                 "writable", "min", "max"}
    json.dumps(p)


def test_cfg_payload_no_secrets_is_null():
    assert cfg_payload(1, [_src(S1)], {})["sources"][0]["secrets"] is None
    assert cfg_payload(1, [_src(S1, secrets={})], {})["sources"][0]["secrets"] is None


def test_cfg_req_behind_gets_latest():
    assert should_send(None, 3) and should_send(2, 3)


def test_cfg_req_current_gets_nothing():
    assert not should_send(3, 3) and not should_send(4, 3)


def test_cfg_req_parsing():
    assert parse_cfg_req({"have_version": None}) == (True, None)
    assert parse_cfg_req({}) == (True, None)
    assert parse_cfg_req({"have_version": 4}) == (True, 4)
    for bad in ([], "x", {"have_version": "4"}, {"have_version": True}, {"have_version": 1.5}):
        assert parse_cfg_req(bad)[0] is False


def test_ack_ok():
    a = parse_cfg_ack({"version": 5, "ok": True, "errors": []})
    assert a and a.version == 5 and a.summary() is None and not a.error_source_ids


def test_ack_errors_summary_and_sources():
    a = parse_cfg_ack({"version": 5, "ok": False, "errors": [
        {"source_id": S1, "detail": "refused"}, {"tag_id": T1, "detail": "bad addr"}, "junk"]})
    assert a.error_source_ids == {S1}
    assert a.summary() == f"source {S1}: refused; tag {T1}: bad addr"
    assert a.source_detail(S1) == "refused"


def test_ack_not_ok_without_errors_still_reports():
    assert parse_cfg_ack({"version": 1, "ok": False}).summary()


def test_ack_malformed():
    for bad in (None, [], {"version": "5", "ok": True}, {"version": True, "ok": True},
                {"version": -1, "ok": True}, {"version": 1}, {"version": 1, "ok": "yes"},
                {"version": 1, "ok": True, "errors": "x"}):
        assert parse_cfg_ack(bad) is None


def test_ack_truncates_long_detail():
    a = parse_cfg_ack({"version": 1, "ok": False,
                       "errors": [{"source_id": S1, "detail": "x" * 5000}]})
    assert len(a.errors[0][2]) == 300 and len(a.summary()) <= 500


def test_topic_and_acls():
    assert cfg_topic("o", "s", "e") == "v2/o/s/e/cfg"
    acls = {(a["acltype"], a["topic"]) for a in edge_acls("o", "s", "e")}
    for want in (("subscribePattern", "v2/o/s/e/cfg"), ("publishClientReceive", "v2/o/s/e/cfg"),
                 ("publishClientSend", "v2/o/s/e/cfg-req"),
                 ("publishClientSend", "v2/o/s/e/cfg-ack")):
        assert want in acls
    b = {(a["acltype"], a["topic"]) for a in BACKEND_ACLS}
    assert ("publishClientSend", "v2/+/+/+/cfg") in b
    for leaf in ("cfg-req", "cfg-ack"):
        assert f"$share/ingest/v2/+/+/+/{leaf}" in SUBSCRIPTIONS
        assert ("subscribePattern", f"$share/ingest/v2/+/+/+/{leaf}") in b


def test_stale_publish_skip_rule():
    assert stale_publish(5, 6)
    assert not stale_publish(6, 6) and not stale_publish(7, 6) and not stale_publish(0, None)


def test_malformed_cfg_messages_are_counted_not_raised():
    import asyncio
    from types import SimpleNamespace

    from app.main import _handle_cfg, new_ingest_counters

    assert "cfg_bad_payload" in new_ingest_counters()
    st = SimpleNamespace(counters=new_ingest_counters(), cfgpub=None)
    edge = SimpleNamespace(id="e")
    for kind, payload in (("cfg-req", b"not json"), ("cfg-req", b'{"have_version":"x"}')):
        msg = SimpleNamespace(topic=f"v2/o/s/e/{kind}", payload=payload)
        asyncio.run(_handle_cfg(st, msg, edge, kind))
    assert st.counters["cfg_bad_payload"] == 2


def test_edge_json_ships_config_fields():
    from app.main import _edge_json
    row = {"id": "i", "org_id": "o", "site_id": "s", "name": "n", "status": "active",
           "mqtt_username": "u", "credential_version": 1, "last_hb_at": None,
           "clock_ok": None, "adapter": None, "config_version": 3,
           "config_applied": 2, "config_error": "x"}
    j = _edge_json(row)
    assert (j["config_version"], j["config_applied"], j["config_error"]) == (3, 2, "x")
