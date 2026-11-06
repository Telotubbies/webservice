"""F03 — telemetry survives a broker outage AND a gateway restart.

The paho client is swapped for a fake so the tests drive connect state and
PUBACKs by hand; the spool is a real sqlite file in tmp_path.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import paho.mqtt.client as mqtt
import pytest

from edge_bridge import mqtt_bridge
from edge_bridge.mqtt_bridge import MqttBridge
from edge_bridge.spool import TelemetrySpool

PREFIX = "v2/o/s/e"


def tele(i: int) -> tuple[str, dict]:
    # the payload carries the SAMPLE time — that is what back-fill relies on
    return f"{PREFIX}/tele/a/l/d/sig{i % 3}", {
        "v": i, "q": "good", "ts": f"2026-11-05T00:{i // 60 % 60:02d}:{i % 60:02d}Z"}


class FakeClient:
    """Just enough paho: publish() returns a mid; puback() fires on_publish."""

    def __init__(self):
        self.up = False
        self.sent: list[tuple[int, str, str]] = []
        self._out_messages: dict[int, str] = {}
        self._mid = 0

    def publish(self, topic, payload, qos=0, retain=False, properties=None):
        self._mid += 1
        self.sent.append((self._mid, topic, payload))
        if qos:
            self._out_messages[self._mid] = topic
        rc = mqtt.MQTT_ERR_SUCCESS if self.up else mqtt.MQTT_ERR_NO_CONN
        return SimpleNamespace(rc=rc, mid=self._mid)

    def puback_all(self, bridge):
        for mid in list(self._out_messages):
            del self._out_messages[mid]
            bridge._on_publish(self, None, mid, None, None)


def make_bridge(path, max_rows=1000):
    b = MqttBridge("h", 1883, "c", spool=TelemetrySpool(str(path), max_rows=max_rows))
    b._client = FakeClient()
    return b


def go_online(b):
    b._client.up = True
    b.connected.set()


def go_offline(b):
    b._client.up = False
    b.connected.clear()


def drain_all(b, max_rounds=10_000):
    for _ in range(max_rounds):
        b._drain_once()
        b._client.puback_all(b)
        b._drain_once()           # process the acks just delivered
        if b._spool.depth() == 0:
            return
    raise AssertionError("backlog never drained")


def delivered_tele(b):
    return [(t, json.loads(p)) for _, t, p in b._client.sent if "/tele/" in t]


# ------------------------------------------------------------------ spool unit
def test_spool_keeps_order_and_survives_reopen(tmp_path):
    p = tmp_path / "s.sqlite"
    s = TelemetrySpool(str(p), max_rows=10)
    for i in range(3):
        s.append(f"t{i}", f"p{i}")
    s.close()
    s2 = TelemetrySpool(str(p), max_rows=10)
    rows = s2.peek(0, 10)
    assert [(t, pl) for _, t, pl in rows] == [("t0", "p0"), ("t1", "p1"), ("t2", "p2")]
    assert s2.depth() == 3
    s2.ack(rows[0][0])
    assert s2.depth() == 2 and [r[1] for r in s2.peek(0, 10)] == ["t1", "t2"]
    assert [r[1] for r in s2.peek(rows[1][0], 10)] == ["t2"]   # cursor is exclusive


def test_spool_exact_capacity_drops_nothing(tmp_path):
    s = TelemetrySpool(str(tmp_path / "s.sqlite"), max_rows=5)
    for i in range(5):
        s.append("t", str(i))
    assert s.depth() == 5 and s.dropped == 0
    assert [r[2] for r in s.peek(0, 10)] == ["0", "1", "2", "3", "4"]


def test_spool_over_capacity_drops_oldest_and_counts(tmp_path):
    s = TelemetrySpool(str(tmp_path / "s.sqlite"), max_rows=5)
    for i in range(7):
        s.append("t", str(i))
    assert s.depth() == 5 and s.dropped == 2
    assert [r[2] for r in s.peek(0, 10)] == ["2", "3", "4", "5", "6"]


def test_spool_ids_never_reused_after_delete(tmp_path):
    # deleting the newest row must not let the next append sort before it
    s = TelemetrySpool(str(tmp_path / "s.sqlite"), max_rows=5)
    s.append("t", "a")
    s.append("t", "b")
    last = s.peek(0, 10)[-1][0]
    s.ack(last)
    s.append("t", "c")
    assert s.peek(0, 10)[-1][0] > last


def test_spool_max_rows_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("TELEMETRY_SPOOL_MAX_ROWS", "7")
    s = TelemetrySpool.from_env()
    assert s.max_rows == 7 and s.path == str(tmp_path / "state" / "telemetry-spool.sqlite")


# ----------------------------------------------------------- bridge behaviour
def test_offline_telemetry_goes_to_disk_not_paho(tmp_path):
    b = make_bridge(tmp_path / "s.sqlite")
    topic, payload = tele(1)
    assert b.publish_json(topic, payload) is True
    assert b._client.sent == [] and b._spool.depth() == 1
    assert b.queued() == 1                        # heartbeat buffer_depth sees it


def test_non_telemetry_is_not_spooled(tmp_path):
    b = make_bridge(tmp_path / "s.sqlite")
    b.publish_json(f"{PREFIX}/hb", {"status": "up"})
    assert b._spool.depth() == 0 and len(b._client.sent) == 1


@pytest.mark.parametrize("n,cap", [(37, 1000), (50, 50), (51, 50)])
def test_outage_restart_reconnect_delivers_backlog_in_order(tmp_path, n, cap):
    """DONE criterion: broker down -> N samples -> process restart -> reconnect
    => min(N, cap) newest samples delivered in original order, payload intact,
    and live samples are published immediately while the backlog drains."""
    path = tmp_path / "s.sqlite"
    first = make_bridge(path, max_rows=cap)
    sent = [tele(i) for i in range(n)]
    for topic, payload in sent:
        assert first.publish_json(topic, payload)
    assert first.dropped == max(0, n - cap)       # heartbeat buffer_dropped
    first._spool.close()                          # the gateway restarts

    b = make_bridge(path, max_rows=cap)           # new process, same file
    go_online(b)
    b._drain_once()                               # one bounded slice of backlog
    assert 0 < len(b._client.sent) <= mqtt_bridge._DRAIN_WINDOW
    live_topic, live = f"{PREFIX}/tele/a/l/d/live", {"v": -1, "q": "good",
                                                    "ts": "2026-11-05T09:00:00Z"}
    before = len(b._client.sent)
    assert b.publish_json(live_topic, live)
    assert b._client.sent[before][1] == live_topic   # not queued behind backlog
    assert b._spool.depth() > 0 or n <= mqtt_bridge._DRAIN_WINDOW
    drain_all(b)

    backlog = [m for m in delivered_tele(b) if m[0] != live_topic]
    assert backlog == sent[-cap:]                 # newest `cap`, in order, ts kept
    assert b._spool.depth() == 0


def test_crash_mid_drain_loses_nothing(tmp_path):
    path = tmp_path / "s.sqlite"
    a = make_bridge(path)
    sent = [tele(i) for i in range(25)]
    for topic, payload in sent:
        a.publish_json(topic, payload)
    go_online(a)
    a._drain_once()                    # published, but crash before any PUBACK
    assert a._spool.depth() == 25
    a._spool.close()

    b = make_bridge(path)
    go_online(b)
    drain_all(b)
    assert delivered_tele(b) == sent


def test_drain_keeps_at_most_window_unacked(tmp_path):
    b = make_bridge(tmp_path / "s.sqlite")
    for i in range(100):
        b.publish_json(*tele(i))
    go_online(b)
    for _ in range(5):
        b._drain_once()                # no PUBACKs arrive
    assert len(b._client.sent) == mqtt_bridge._DRAIN_WINDOW


def test_drain_pauses_while_offline_and_resumes(tmp_path):
    b = make_bridge(tmp_path / "s.sqlite")
    sent = [tele(i) for i in range(30)]
    for t, p in sent:
        b.publish_json(t, p)
    b._drain_once()
    assert b._client.sent == []        # offline: nothing leaves the spool
    go_online(b)
    b._drain_once()
    b._client.puback_all(b)
    go_offline(b)
    b._drain_once()                    # acks still processed while offline
    depth = b._spool.depth()
    assert depth == 30 - mqtt_bridge._DRAIN_WINDOW
    go_online(b)
    drain_all(b)
    assert delivered_tele(b) == sent


# ------------------------------------------------------------- crash safety
def test_torn_wal_tail_keeps_earlier_rows(tmp_path):
    """Process killed mid-write: the last WAL frame is cut short. sqlite drops
    the torn frame and every committed row before it survives."""
    import shutil
    live = tmp_path / "live"
    s = TelemetrySpool(str(live / "s.sqlite"), max_rows=100)
    for i in range(20):
        s.append("t", str(i))
    snap = tmp_path / "snap"
    snap.mkdir()
    for f in live.iterdir():                       # copy while open == kill -9
        shutil.copy(f, snap / f.name)
    wal = snap / "s.sqlite-wal"
    wal.write_bytes(wal.read_bytes()[:-100])       # tear the last frame
    r = TelemetrySpool(str(snap / "s.sqlite"), max_rows=100)
    got = [x[2] for x in r.peek(0, 100)]
    assert got == [str(i) for i in range(len(got))] and 15 <= len(got) <= 19
    assert r.depth() == len(got)


def test_corrupt_file_is_quarantined_and_spool_restarts_empty(tmp_path):
    p = tmp_path / "s.sqlite"
    p.write_bytes(b"not a database" * 100)
    s = TelemetrySpool(str(p))
    s.append("t", "x")
    assert s.depth() == 1 and [r[2] for r in s.peek(0, 9)] == ["x"]
    assert list(tmp_path.glob("s.sqlite.corrupt-*"))   # evidence kept, not deleted


def test_reconnect_resends_rows_whose_ack_was_lost(tmp_path):
    """paho may lose an in-flight message across a reconnect; the window must
    not stay full forever, so a new session replays from the oldest row."""
    b = make_bridge(tmp_path / "s.sqlite")
    sent = [tele(i) for i in range(25)]
    for t, p in sent:
        b.publish_json(t, p)
    go_online(b)
    b._drain_once()                    # 10 in flight, never acked
    go_offline(b)
    b._client._out_messages.clear()    # paho dropped them with the session
    go_online(b)
    b._on_connect(b._client, None, None, mqtt.ReasonCode(mqtt.CONNACK >> 4, 'Success'))
    drain_all(b)
    assert b._spool.depth() == 0
    assert [m for m in delivered_tele(b)][-25:][0] == sent[0]
