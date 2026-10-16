"""PLC-write path hardening (QA critical fixes):

  - the offline write window starts at the MQTT disconnect, not at the first
    gate check (a day-old outage must not write);
  - the in-flight/rate gate is atomic across camera worker threads;
  - edge-triggered rules re-arm on empty detections (runner calls
    on_detections every frame);
  - a model still loading is not an inference failure and must not flip the
    camera to cloud failover;
  - gate bools are strict, counter writes need GOOD-quality reads, the pulse
    reset result is checked, the write queue is bounded, rule ids are safe
    for file paths, and the log shipper speaks the backend contract.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

import edge_bridge.vision.rules as rules_mod  # noqa: E402
from edge_bridge.adapters.base import Quality, TagValue, WriteResult  # noqa: E402
from edge_bridge.logship import LogShipper  # noqa: E402
from edge_bridge.vision.detector import (  # noqa: E402
    ExternalDetector, FailoverDetector, ModelDetector, ModelNotReady)
from edge_bridge.vision.runner import VisionRunner, _Worker  # noqa: E402
from edge_bridge.vision.rules import MAX_WRITE_QUEUE, RuleEngine, parse_rule  # noqa: E402


# --------------------------------------------------------------------- fakes
def _det(cid=0, x=0.1, y=0.1, w=0.1, h=0.1, score=0.9):
    return {"class_id": cid, "score": score, "bbox": [x, y, w, h]}


class FakeAdapter:
    name = "fake"

    def __init__(self, read_quality=Quality.GOOD, fail_writes=()):
        self.writes: list[tuple[str, object]] = []
        self._quality = read_quality
        self._fail_writes = set(fail_writes)    # 0-based write() call indices that fail
        self._write_calls = 0
        self._meta = {"site.a.b.motor": {"writable": True},
                      "site.a.b.count": {"writable": True}}
        self._vals = {"site.a.b.count": 10.0}

    def tag_map(self):
        return self._meta

    def read_all(self):
        return [TagValue(name=k, v=v, q=self._quality,
                         ts=datetime.now(timezone.utc))
                for k, v in self._vals.items()]

    def write(self, tag, value):
        idx = self._write_calls
        self._write_calls += 1
        if idx in self._fail_writes:
            return WriteResult.denied("plc_fault")
        meta = self._meta.get(tag)
        if meta is None or not meta.get("writable"):
            return WriteResult.denied("not_writable")
        self.writes.append((tag, value))
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
        self.raw: list[bytes] = []

    def publish_json(self, topic, payload, qos=1):
        if topic.endswith("/event"):
            self.events.append(payload)
        elif topic.endswith("/audit"):
            self.audits.append(payload)
        return self.connected.is_set()

    def publish_raw(self, topic, payload, qos=0):
        self.raw.append(payload)
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


GATE_ON = {"control_enabled": True, "ai_plc_write": True,
           "offline_write_window_s": 900}


def _rule(actions=None, cond=None, **kw):
    r = {"id": "r1", "name": "test", "enabled": True, "dry_run": False,
         "conditions": cond or {"class_ids": [0], "min_score": 0.5},
         "actions": actions or [{"kind": "plc_write", "tag_path": "a/b/motor",
                                 "value": True}],
         **kw}
    return r


def _cam(rules, gate=None, cid="c1"):
    return {"id": cid, "enabled": True, "gate": gate or dict(GATE_ON),
            "model": {"version_id": "mv1", "placement": "edge",
                      "class_config": {}},
            "rules": rules}


def _engine(tmp_path, online=True, adapter=None):
    adapter = adapter or FakeAdapter()
    bridge = FakeBridge(online=online)
    e = RuleEngine(FakeHolder(adapter), bridge, FakeCfg(), str(tmp_path),
                   clock=FakeClock())
    return e, adapter, bridge


def _wait_writes(adapter, n=1, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end and len(adapter.writes) < n:
        time.sleep(0.02)
    return adapter.writes


# ------------------------------------------------- offline window (finding 1)
def test_offline_since_stamped_at_disconnect_not_first_check(tmp_path):
    """Disconnect now; gate check much later -> the window already elapsed."""
    e, adapter, bridge = _engine(tmp_path)
    bridge.connected.clear()
    e.note_disconnected(bridge)                       # the bridge hook fires NOW
    e._offline_since = time.monotonic() - 1000        # disconnect was 1000s ago
    gate = dict(GATE_ON, offline_write_window_s=900)
    _frame_kwargs = _cam([_rule()], gate=gate)
    e.on_detections(_frame_kwargs, [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert bridge.events[0]["blocked_reason"] == "offline_window"


def test_offline_window_boundary(tmp_path):
    """Inside the window writes go through; at/past it they are blocked."""
    e, adapter, bridge = _engine(tmp_path, online=False)
    e.note_disconnected(bridge)
    e._offline_since = time.monotonic() - 899         # 1s inside a 900s window
    cam = _cam([_rule()])
    e.on_detections(cam, [_det()], None)
    assert _wait_writes(adapter) == [("site.a.b.motor", True)]
    e._pool.shutdown(wait=True)

    e, adapter, bridge = _engine(tmp_path, online=False)
    e.note_disconnected(bridge)
    e._offline_since = time.monotonic() - 901         # past the window
    e.on_detections(_cam([_rule()]), [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert bridge.events[0]["blocked_reason"] == "offline_window"


def test_note_connected_clears_offline_clock(tmp_path):
    e, adapter, bridge = _engine(tmp_path, online=False)
    e.note_disconnected(bridge)
    assert e.offline_seconds() > 0 or e._offline_since is not None
    bridge.connected.set()
    e.note_connected(bridge)
    assert e._offline_since is None and e.offline_seconds() == 0.0


# ---------------------------------------------- atomic in-flight (finding 2)
def test_concurrent_gate_passes_exactly_one_write(tmp_path):
    """Two camera threads racing the same tag: only one may claim it."""
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    st = e._cam_state(cam)
    rule = st.rules[0]
    barrier = threading.Barrier(3)

    def go():
        barrier.wait()
        e._fire(cam, st, rule, None, None, "edge")

    ts = [threading.Thread(target=go) for _ in range(2)]
    for t in ts:
        t.start()
    barrier.wait()
    for t in ts:
        t.join()
    e._pool.shutdown(wait=True)
    assert len(adapter.writes) == 1
    reasons = [a.get("reason") for ev in bridge.events
               for a in ev["detail"]["actions"]]
    assert reasons.count("in_flight") == 1


# ---------------------------------------------- empty-dets re-arm (finding 3)
def test_empty_detections_rearm_edge_trigger(tmp_path, monkeypatch):
    monkeypatch.setattr(rules_mod, "MIN_REFIRE_S", 0.0)
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    e.on_detections(cam, [_det()], None)
    assert _wait_writes(adapter)
    e.on_detections(cam, [_det()], None)             # still present: no refire
    e.on_detections(cam, [], None)                   # cleared: re-arm
    e.on_detections(cam, [_det()], None)
    assert _wait_writes(adapter, 2)
    e._pool.shutdown(wait=True)
    assert len(adapter.writes) == 2


def test_runner_calls_on_detections_for_empty_frames(tmp_path):
    """The defect lived in the worker: on_detections was skipped when the
    detector returned []. Drive a real _Worker with a scripted detector."""
    calls: list[list] = []
    seq = iter([[_det()], [], [], [_det()], []])

    class Scripted:
        state, detail = "ready", ""
        engine = latency_ms = bench_fps = version = None
        placement = "edge"

        def detect(self, frame):
            try:
                return next(seq)
            except StopIteration:
                return []

    class Src:
        def read(self):
            time.sleep(0.01)
            return np.zeros((120, 160, 3), np.uint8)

        def close(self):
            pass

    runner = VisionRunner(publish_frame=lambda cid, j: None,
                          publish_stat=lambda d: None, state_dir=tmp_path,
                          detector_factory=lambda cam: Scripted(),
                          on_detections=lambda cam, dets, frame, detector=None:
                          calls.append(dets))
    cam = {"id": "c1", "name": "c1", "kind": "rtsp", "enabled": True,
           "rtsp_url": "rtsp://x/y", "fps_sample": 100}
    w = _Worker(cam, runner)
    w._open = lambda: Src()
    runner._cam_cfgs["c1"] = cam
    try:
        w.start()
        end = time.time() + 5.0
        while time.time() < end and len(calls) < 5:
            time.sleep(0.02)
    finally:
        w.stop_ev.set()
        w.join(timeout=3.0)
    assert len(calls) >= 5
    assert [] in calls                                # empty frames DO reach the engine


# -------------------------------------------- loading != failure (finding 4)
class _StubEdge:
    """ModelDetector stand-in for FailoverDetector."""

    def __init__(self, state):
        self.state, self.detail = state, ""
        self.version = "v1"
        self.engine = self.latency_ms = self.bench_fps = None
        self.placement = "edge"
        self.calls = 0

    def detect(self, frame):
        self.calls += 1
        raise ModelNotReady(self.state)


class _StubCloud:
    state, detail = "ready", ""
    engine = "cloud"
    latency_ms = bench_fps = None
    version = "v1"
    placement = "cloud"

    def detect(self, frame):
        return []


def test_loading_never_fails_over_to_cloud():
    edge, cloud = _StubEdge("loading"), _StubCloud()
    det = FailoverDetector(edge, cloud)
    for _ in range(rules_mod.WRITE_RATE_N + 5):
        with pytest.raises(ModelNotReady):
            det.detect(None)
    assert det._on_cloud is False and det._fails == []
    assert det.placement == "edge"


def test_real_errors_do_fail_over():
    edge, cloud = _StubEdge("error"), _StubCloud()
    det = FailoverDetector(edge, cloud)
    for _ in range(3):                                 # FAILOVER_N
        with pytest.raises(ModelNotReady):
            det.detect(None)
    assert det._on_cloud is True
    assert det.detect(None) == []                      # cloud answers now
    assert det.placement == "cloud"


def test_throttled_rechecks_are_not_failures():
    edge, cloud = _StubEdge("error"), _StubCloud()
    det = FailoverDetector(edge, cloud)
    orig = edge.detect

    def throttled(frame):
        raise ModelNotReady("error", throttled=True)

    edge.detect = throttled
    for _ in range(5):
        with pytest.raises(ModelNotReady):
            det.detect(None)
    edge.detect = orig
    assert det._on_cloud is False and det._fails == []


def test_loading_throttles_health_poll():
    """A cold model must not trigger health() on every frame (~5s poll)."""
    calls = {"n": 0}

    class Cli:
        def ensure(self, model):
            calls["n"] += 1
            return "loading"

        def engine(self, vid):
            return None

    det = ModelDetector(Cli(), {"version_id": "v1", "class_config": {
        "0": {"enabled": True, "min_score": 0.5}}})
    with pytest.raises(ModelNotReady):
        det.detect(None)
    with pytest.raises(ModelNotReady) as e2:
        det.detect(None)
    assert calls["n"] == 1                             # second frame: no health()
    assert e2.value.throttled is True


# --------------------------------------------------------- supporting fixes
def test_string_bool_in_gate_cannot_pass(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    gate = dict(GATE_ON, ai_plc_write="true")          # string, not bool
    e.on_detections(_cam([_rule()], gate=gate), [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert bridge.events[0]["blocked_reason"] == "ai_write_disabled"

    e, adapter, bridge = _engine(tmp_path)
    gate = dict(GATE_ON, control_enabled="false")
    e.on_detections(_cam([_rule()], gate=gate), [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert bridge.events[0]["blocked_reason"] == "control_disabled"


def test_rule_id_traversal_rejected():
    for bad in ("../etc", "a/b", "..", "x\x00y", "id with space", ""):
        assert parse_rule({"id": bad, "conditions": {"class_ids": [0]},
                           "actions": [{"kind": "alarm"}]}) is None
    assert parse_rule({"id": "ok-rule_1", "conditions": {"class_ids": [0]},
                       "actions": [{"kind": "alarm"}]}) is not None


def test_counter_needs_good_quality_read(tmp_path):
    e, adapter, bridge = _engine(tmp_path, adapter=FakeAdapter(Quality.BAD))
    rule = _rule(actions=[{"kind": "counter", "tag_path": "a/b/count", "by": 1}])
    e.on_detections(_cam([rule]), [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert bridge.audits[0]["status"] == "counter_unreadable"


def test_pulse_reset_failure_is_audited(tmp_path):
    # first write ok, reset write fails twice (initial + one retry)
    adapter = FakeAdapter(fail_writes=[1, 2])
    e, _, bridge = _engine(tmp_path, adapter=adapter)
    rule = _rule(actions=[{"kind": "plc_write", "tag_path": "a/b/motor",
                           "value": True, "pulse_ms": 5}])
    e.on_detections(_cam([rule]), [_det()], None)
    e._pool.shutdown(wait=True)
    assert adapter.writes == [("site.a.b.motor", True)]
    assert bridge.audits[0]["status"].startswith("reset_failed")


def test_write_queue_bounded(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    cam = _cam([_rule()])
    st = e._cam_state(cam)
    rule = st.rules[0]
    e._write_queued = MAX_WRITE_QUEUE                  # saturated pool queue
    e._fire(cam, st, rule, None, None, "edge")
    e._pool.shutdown(wait=True)
    assert adapter.writes == []
    assert e._writes_dropped == 1
    assert "a/b/motor" not in e._inflight              # claim released on drop
    assert bridge.events[0]["detail"]["actions"][0]["reason"] == "queue_full"


def test_tag_writes_ledger_pruned(tmp_path):
    e, adapter, bridge = _engine(tmp_path)
    e._tag_writes["a/b/motor"] = [time.monotonic() - 3600] * 50  # all stale
    e.on_detections(_cam([_rule()]), [_det()], None)
    assert _wait_writes(adapter)                       # stale entries don't block
    e._pool.shutdown(wait=True)
    assert len(e._tag_writes["a/b/motor"]) == 1        # only the fresh write kept


def test_logship_speaks_backend_contract():
    bridge = FakeBridge()
    ship = LogShipper(bridge, "v2/o/s/e/logs")
    rec = logging.LogRecord("edge_bridge.test", logging.WARNING,
                            __file__, 1, "m" * 3000, None, None)
    ship.emit(rec)
    entry = json.loads(ship._ring[0])
    assert entry["level"] == "warn"                    # warning normalizes
    assert entry["source"] == "edge_bridge.test"
    assert len(entry["msg"]) == 2000                   # truncated BEFORE dumps
    assert isinstance(entry["ts"], float) and entry["ts"] < 1e12  # s, not ms
    # a record whose raw JSON would exceed 2KB must still parse cleanly
    assert json.loads(ship._ring[0])["msg"].startswith("mmm")


def test_external_detector_requires_https_for_remote():
    cc = {"0": {"enabled": True, "min_score": 0.5}}
    model = {"version_id": "v1", "class_config": cc,
             "external": {"provider": "generic",
                          "url": "http://ml.example.com/infer"}}
    det = ExternalDetector(model)
    assert det.state == "error" and "https" in det.detail
    with pytest.raises(ModelNotReady):
        det.detect(np.zeros((8, 8, 3), np.uint8))
    ok = ExternalDetector({"version_id": "v1", "class_config": cc, "external": {
        "provider": "generic", "url": "https://ml.example.com/infer"}})
    assert ok.state == "ready"
    local = ExternalDetector({"version_id": "v1", "class_config": cc, "external": {
        "provider": "generic", "url": "http://127.0.0.1:9000/infer"}})
    assert local.state == "ready"                      # loopback http is allowed
