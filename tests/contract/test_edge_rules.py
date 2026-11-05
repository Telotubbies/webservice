"""Edge vision rules + IoU tracker (roadmap 9.7/9.8): condition evaluation,
dry-run, the local PLC gate, signed audit spooling and replay."""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from edge_bridge.vision.rules import AuditSpool, RuleEngine, parse_rule, sign_audit  # noqa: E402
from edge_bridge.vision.track import IoUTracker  # noqa: E402


# ------------------------------------------------------------------ tracker
def _det(cid=0, x=0.1, y=0.1, w=0.1, h=0.1, score=0.9):
    return {"class_id": cid, "score": score, "bbox": [x, y, w, h]}


def test_tracker_one_object_one_announce():
    t = IoUTracker(iou=0.2)
    _, new1 = t.update([_det(x=0.10)])
    assert len(new1) == 1
    _, new2 = t.update([_det(x=0.12)])           # same object, slight move
    _, new3 = t.update([_det(x=0.14)])
    assert not new2 and not new3                # never re-announced
    assert len(t.update([_det(x=0.90)])[1]) == 1  # different object
    tracks, _ = t.update([])
    assert len(tracks) == 2


def test_tracker_retires_lost_and_respects_class():
    t = IoUTracker(iou=0.3, max_lost=1)
    t.update([_det(cid=0)])
    t.update([_det(cid=1, x=0.1)])               # same box, different class -> new track
    tracks, _ = t.update([])
    assert len(tracks) == 1                      # cid=0 was already lost once -> retired
    tracks, _ = t.update([])
    tracks, _ = t.update([])
    assert tracks == []                          # the other one follows


def test_tracker_min_hits_defers_announce():
    t = IoUTracker(iou=0.2, min_hits=2)
    _, new1 = t.update([_det()])
    assert not new1                              # unconfirmed detection
    _, new2 = t.update([_det(x=0.11)])
    assert len(new2) == 1


def test_tracker_drops_malformed_detections():
    t = IoUTracker()
    tracks, new = t.update([{"class_id": 0}, {"bbox": [0, 0, 1, 1]},
                            "junk", _det()])
    assert len(new) == 1 and tracks[0].bbox[0] == 0.1


# --------------------------------------------------------------------- fakes
class FakeAdapter:
    name = "fake"

    def __init__(self):
        self.writes: list[tuple[str, object]] = []
        self._meta = {"site.a.b.motor": {"writable": True},
                      "site.a.b.speed": {"writable": True, "min": 0.0, "max": 60.0},
                      "site.a.b.count": {"writable": True},
                      "site.a.b.temp": {"writable": False}}
        self._vals = {"site.a.b.count": 10.0}

    def tag_map(self):
        return self._meta

    def read_all(self):
        from edge_bridge.adapters.base import TagValue, Quality
        return [TagValue(name=k, v=v, q=Quality.GOOD,
                         ts=datetime.now(timezone.utc))
                for k, v in self._vals.items()]

    def write(self, tag, value):
        meta = self._meta.get(tag)
        if meta is None or not meta.get("writable"):
            from edge_bridge.adapters.base import WriteResult
            return WriteResult.denied("not_writable")
        self.writes.append((tag, value))
        if isinstance(value, (int, float)):
            self._vals[tag] = value
        from edge_bridge.adapters.base import WriteResult
        return WriteResult.done()

    def close(self):
        pass


class FakeHolder:
    def __init__(self, adapter):
        self._a = adapter

    def get(self):
        return self._a


class FakeBridge:
    def __init__(self, online=True):
        self.connected = threading.Event()
        if online:
            self.connected.set()
        self.events: list[dict] = []
        self.audits: list[dict] = []
        self.counts: list[dict] = []

    def publish_json(self, topic, payload, qos=1):
        # record the attempt even offline — paho queues QoS1 in its out-queue
        if topic.endswith("/event"):
            self.events.append(payload)
        elif topic.endswith("/audit"):
            self.audits.append(payload)
        elif topic.endswith("/count"):
            self.counts.append(payload)
        return self.connected.is_set()

    def publish_raw(self, topic, payload, qos=0):
        return self.connected.is_set()


class FakeCfg:
    site_code = "site"
    vision_event_topic = "v2/o/s/e/vision/event"
    vision_audit_topic = "v2/o/s/e/vision/audit"
    vision_count_topic = "v2/o/s/e/vision/count"

    def credentials(self):
        return "user", "pw-secret"


class FakeClock:
    clock_ok = True

    def now(self):
        return datetime.now(timezone.utc)


GATE_ON = {"control_enabled": True, "ai_plc_write": True, "offline_write_window_s": 900}
ZONE_HALF = [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]]  # left half


def _rule(actions=None, cond=None, **kw):
    r = {"id": "r1", "name": "test", "enabled": True, "dry_run": False,
         "conditions": cond or {"class_ids": [0], "min_score": 0.5},
         "actions": actions or [{"kind": "plc_write", "tag_path": "a/b/motor", "value": True}],
         **kw}
    return r


def _cam(rules, gate=None, cid="c1", class_config=None):
    return {"id": cid, "enabled": True, "gate": gate or dict(GATE_ON),
            "model": {"version_id": "mv1", "placement": "edge",
                      "class_config": class_config or {}},
            "rules": rules}


def _engine(tmp_path, online=True):
    adapter, bridge = FakeAdapter(), FakeBridge(online=online)
    e = RuleEngine(FakeHolder(adapter), bridge, FakeCfg(), str(tmp_path),
                   clock=FakeClock())
    return e, adapter, bridge


def _frame(e, cam, dets):
    e.on_detections(cam, dets, None)


def _wait_writes(adapter, n=1, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end and len(adapter.writes) < n:
        time.sleep(0.02)
    return adapter.writes


def _verify_sig(rec, password="pw-secret"):
    sig = rec.pop("sig")
    msg = json.dumps(rec, sort_keys=True, separators=(",", ":")).encode()
    assert hmac.compare_digest(
        sig, hmac.new(hashlib.sha256(password.encode()).digest(), msg,
                      hashlib.sha256).hexdigest())


# --------------------------------------------------------------- rule firing
def test_dry_run_never_writes_and_reports(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule(dry_run=True)])
    _frame(e, cam, [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert [ev["kind"] for ev in bridge.events] == ["dry_run"]
    assert "plc_write" in bridge.events[0]["detail"]["would"]


def test_live_rule_writes_and_audits(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    _frame(e, cam, [_det()])
    assert _wait_writes(adapter) == [("site.a.b.motor", True)]
    e._pool.shutdown(wait=True)
    assert bridge.events[0]["kind"] == "rule_fire"
    assert len(bridge.audits) == 1
    rec = dict(bridge.audits[0])
    assert rec["source"] == "edge_rule" and rec["rule_id"] == "r1"
    assert rec["tag_path"] == "a/b/motor" and rec["status"] == "fired"
    _verify_sig(rec)


def test_rule_rearms_only_after_condition_clears(tmp_path, monkeypatch):
    import edge_bridge.vision.rules as rules_mod
    monkeypatch.setattr(rules_mod, "MIN_REFIRE_S", 0.0)
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    _frame(e, cam, [_det()])
    assert _wait_writes(adapter)
    _frame(e, cam, [_det()])                     # still present -> no refire
    _frame(e, cam, [])                           # clears -> re-arm
    _frame(e, cam, [_det()])
    assert _wait_writes(adapter, 2)
    e._pool.shutdown(wait=True)
    assert len(adapter.writes) == 2


def test_hold_frames_requires_streak(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule(cond={"class_ids": [0], "hold_frames": 3})])
    _frame(e, cam, [_det()])
    _frame(e, cam, [])
    _frame(e, cam, [_det()])
    assert adapter.writes == []                  # streak reset by the gap
    _frame(e, cam, [_det()])
    _frame(e, cam, [_det()])
    assert _wait_writes(adapter)


def test_count_in_zone_and_polygon(tmp_path):
    cond = {"class_ids": [0], "zone": ZONE_HALF, "count_in_zone": 2}
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule(cond=cond)])
    _frame(e, cam, [_det(x=0.1), _det(x=0.9)])   # one outside the zone
    assert adapter.writes == []
    _frame(e, cam, [_det(x=0.1), _det(x=0.2, y=0.6)])
    assert _wait_writes(adapter)


def test_zone_excludes_center_on_right(tmp_path):
    cond = {"class_ids": [0], "zone": ZONE_HALF}
    e, adapter, bridge = _engine(tmp_path)
    _frame(e, _cam([_rule(cond=cond)]), [_det(x=0.8, y=0.4)])
    assert adapter.writes == []
    _frame(e, _cam([_rule(cond=cond)]), [_det(x=0.1, y=0.4)])
    assert _wait_writes(adapter)


# -------------------------------------------------------------------- the gate
def test_ai_write_off_blocks_with_reason(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    gate = dict(GATE_ON, ai_plc_write=False)
    _frame(e, _cam([_rule()], gate=gate), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    ev = bridge.events[0]
    assert ev["kind"] == "blocked" and ev["blocked_reason"] == "ai_write_disabled"


def test_control_disabled_blocks(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    _frame(e, _cam([_rule()], gate=dict(GATE_ON, control_enabled=False)), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "control_disabled"


def test_range_limit_enforced_locally(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    rule = _rule(actions=[{"kind": "plc_write", "tag_path": "a/b/speed", "value": 999}])
    _frame(e, _cam([rule]), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "out_of_range"


def test_read_only_tag_blocked(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    rule = _rule(actions=[{"kind": "plc_write", "tag_path": "a/b/temp", "value": 5}])
    _frame(e, _cam([rule]), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "not_writable"


def test_cloud_placement_blocks_unless_allowed(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    cam["model"]["placement"] = "cloud"
    _frame(e, cam, [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "cloud_placement"

    e, adapter, bridge = _engine(tmp_path)
    rule = _rule(allow_cloud_write=True)
    cam = _cam([rule]); cam["model"]["placement"] = "cloud"
    _frame(e, cam, [_det()])
    assert _wait_writes(adapter)


def test_offline_window_zero_blocks_immediately(tmp_path):
    e, adapter, bridge = _engine(tmp_path, online=False)
    gate = dict(GATE_ON, offline_write_window_s=0)
    _frame(e, _cam([_rule()], gate=gate), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "offline_window"


def test_offline_window_expiry_blocks(tmp_path):
    e, adapter, bridge = _engine(tmp_path, online=False)
    e._offline_since = time.monotonic() - 1000   # been offline for a while
    gate = dict(GATE_ON, offline_write_window_s=900)
    _frame(e, _cam([_rule()], gate=gate), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "offline_window"


def test_clock_untrusted_blocks(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    e._clock = type("C", (), {"clock_ok": False, "now": staticmethod(
        lambda: datetime.now(timezone.utc))})()
    _frame(e, _cam([_rule()]), [_det()])
    e._pool.shutdown(wait=True)
    assert bridge.events[0]["blocked_reason"] == "clock_untrusted"


def test_per_tag_rate_limit(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    e._tag_writes["a/b/motor"] = [time.monotonic()] * 5  # window already full
    _frame(e, cam, [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes == [] and bridge.events[0]["blocked_reason"] == "rate_limited"


def test_counter_action_reads_and_writes(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    rule = _rule(actions=[{"kind": "counter", "tag_path": "a/b/count", "by": 1}])
    _frame(e, _cam([rule]), [_det()])
    assert _wait_writes(adapter) == [("site.a.b.count", 11.0)]
    e._pool.shutdown(wait=True)
    rec = dict(bridge.audits[0])
    _verify_sig(rec)


# -------------------------------------------------------------- audit spool
def test_audit_spooled_offline_and_replayed_in_order(tmp_path):
    e, adapter, bridge = _engine(tmp_path, online=False)
    cam = _cam([_rule()])
    _frame(e, cam, [_det()])
    e._pool.shutdown(wait=True)                  # the write ran, audit spooled
    assert adapter.writes and not bridge.audits
    spool = AuditSpool(str(tmp_path))
    assert spool.depth() == 1
    bridge.connected.set()
    assert e.flush_audit() == 1
    rec = dict(bridge.audits[0])
    _verify_sig(rec)
    assert spool.depth() == 0


def test_audit_two_rules_replay_in_order(tmp_path):
    e, adapter, bridge = _engine(tmp_path, online=False)
    r2 = _rule(actions=[{"kind": "plc_write", "tag_path": "a/b/speed", "value": 5}])
    r2["id"] = "r2"
    cam = _cam([_rule(), r2])
    _frame(e, cam, [_det()])
    e._pool.shutdown(wait=True)
    bridge.connected.set()
    e.flush_audit()
    assert [a["rule_id"] for a in bridge.audits] == ["r1", "r2"]


def test_flush_stops_on_failure_and_keeps_rest(tmp_path):
    spool = AuditSpool(str(tmp_path))
    spool.append({"n": 1})
    spool.append({"n": 2})
    calls = []
    sent = spool.drain(lambda r: calls.append(r) or len(calls) == 1)
    assert sent == 1 and calls == [{"n": 1}, {"n": 2}]  # second send attempted, failed
    assert spool.depth() == 1                           # and record 2 stays buffered


def test_unsigned_audit_dropped_without_credential(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    e._cfg = type("C", (), {"site_code": "site",
                          "vision_event_topic": "t", "vision_audit_topic": "t",
                          "vision_count_topic": "t",
                          "credentials": lambda self=None: (None, None)})()
    _frame(e, _cam([_rule()]), [_det()])
    e._pool.shutdown(wait=True)
    assert adapter.writes and not bridge.audits and AuditSpool(str(tmp_path)).depth() == 0


# ------------------------------------------------------------------ parsing
def test_parse_rule_rejects_garbage():
    assert parse_rule(None) is None
    assert parse_rule({"id": "x"}) is None
    assert parse_rule({"id": "x", "conditions": {"class_ids": []},
                       "actions": [{"kind": "alarm"}]}) is None
    assert parse_rule({"id": "x", "conditions": {"class_ids": [1]},
                       "actions": [{"kind": "format_c"}]}) is None
    assert parse_rule({"id": "x", "conditions": {"class_ids": [1]},
                       "actions": [{"kind": "plc_write", "tag_path": 5, "value": 1}]}) is None


def test_parse_rule_defaults_dry_run_true():
    raw = {"id": "r1", "conditions": {"class_ids": [0]},
           "actions": [{"kind": "alarm"}]}        # no dry_run key -> default True
    r = parse_rule(raw)
    assert r is not None and r.dry_run is True
    r2 = parse_rule(_rule(dry_run=False))
    assert r2.dry_run is False


def test_sign_audit_roundtrip_and_fail_closed():
    rec = sign_audit({"a": 1}, "pw")
    assert rec is not None and len(rec["sig"]) == 64
    _verify_sig(dict(rec), "pw")
    assert sign_audit({"a": 1}, "") is None


def test_alert_object_event_once_per_track(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([], class_config={"0": {"enabled": True, "alert": True}})
    _frame(e, cam, [_det()])
    _frame(e, cam, [_det(x=0.11)])
    _frame(e, cam, [_det(x=0.12)])
    assert [ev["kind"] for ev in bridge.events] == ["alert_object"]
    assert bridge.events[0]["class_id"] == 0


def test_count_rollup_publishes_on_minute_change(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([], class_config={"0": {"enabled": True, "alert": False}})
    _frame(e, cam, [_det()])
    _frame(e, cam, [_det(x=0.5)])
    st = e._cams["c1"]
    st.count_minute = "2000-01-01T00:00"          # force minute rollover
    _frame(e, cam, [_det(x=0.9)])
    assert bridge.counts[0]["counts"] == {0: 2}  # two tracks counted that minute
