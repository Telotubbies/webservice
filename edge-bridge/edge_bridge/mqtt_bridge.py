"""MQTT transport with supervised reconnect.

The client is created with `reconnect_on_failure=False`, so paho's
`loop_forever()` returns as soon as the connection drops and the
supervisor thread owns the retry policy: exponential backoff 1 s -> 60 s
with +/-50 % jitter, one clean log line per connect attempt.

Credential lifecycle (doc 17 §5): `cred_provider` is consulted before
EVERY connect attempt, so a rotated `edge-{e}-v{n+1}` secret that lands in
the credentials file takes effect on the next reconnect — the old one
stays valid during its grace window, then is disabled broker-side. A
refused CONNACK (e.g. the edge was disabled) retries with the same
backoff: the process can't distinguish "disabled" from "wrong password"
and shouldn't exit on either.

Telemetry store-and-forward (F03): `tele/*` publishes made while offline go
to a durable sqlite spool (spool.py) instead of paho's in-memory queue. A
drain thread replays it oldest-first after reconnect, at most _DRAIN_WINDOW
unacked at a time (paho allows 20 in flight, so live samples always have
room and publish immediately), and deletes a row only on its PUBACK — a
crash mid-drain re-sends instead of losing. Replays may duplicate; the
backend dedups history on (tag_id, ts) and the payload keeps sample time.
"""

from __future__ import annotations

import json
import logging
import random
import sqlite3
import threading
from collections import deque
from typing import Callable

import paho.mqtt.client as mqtt

from .spool import TelemetrySpool

log = logging.getLogger("edge_bridge.mqtt")

_BACKOFF_MIN_S = 1.0
_BACKOFF_MAX_S = 60.0
_JITTER = 0.5  # delay * uniform(1-JITTER, 1+JITTER)
_KEEPALIVE_S = 30
_MAX_QUEUED = 500  # bound on paho's out-queue while offline (non-telemetry); excess dropped+counted
_DRAIN_WINDOW = 10   # spooled publishes awaiting PUBACK at once — half of paho's 20 in-flight
_DRAIN_TICK_S = 0.05  # with the window: <= 200 backlog msg/s, live data never waits behind it


class MqttBridge:
    """Thin wrapper around paho: one supervisor thread, thread-safe publish.

    While disconnected, paho queues QoS1 publishes in its out-queue and
    flushes them on reconnect (store-and-forward lite); failures to even
    enqueue are logged.
    """

    # Public callbacks, assignable after construction (paho-style):
    #   on_connect(bridge)    — e.g. (re)subscribe; fires on every reconnect
    #   on_disconnect(bridge) — fires the moment the link drops (offline-since stamp)
    #   on_message(msg)       — runs on paho's network thread
    on_connect: Callable[["MqttBridge"], None] | None = None
    on_disconnect: Callable[["MqttBridge"], None] | None = None
    on_message: Callable[[mqtt.MQTTMessage], None] | None = None

    def __init__(self, host: str, port: int, client_id: str,
                 cred_provider: Callable[[], tuple[str | None, str | None]] | None = None,
                 ca_file: str | None = None,
                 will_topic: str | None = None, will_payload: str | None = None,
                 spool: TelemetrySpool | None = None):
        self._host = host
        self._port = port
        self._cred_provider = cred_provider
        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            reconnect_on_failure=False,  # supervisor owns reconnect policy
        )
        if cred_provider is not None:
            user, pw = cred_provider()
            if user:
                self._client.username_pw_set(user, pw)
        if ca_file:
            self._client.tls_set(ca_certs=ca_file)
        if will_topic and will_payload:
            # LWT: broker publishes a down-heartbeat if we drop ungracefully.
            self._client.will_set(will_topic, payload=will_payload,
                                  qos=1, retain=False)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._dispatch_message
        self._client.on_publish = self._on_publish

        self.connected = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name="mqtt-supervisor", daemon=True)
        self._attempts = 0
        self._ever_connected = False
        self._session = False   # CONNACK-accepted during the current attempt
        self._queue_dropped = 0  # non-telemetry publishes refused while the out-queue was full
        if spool is None:
            try:
                spool = TelemetrySpool.from_env()
            except (OSError, sqlite3.Error, ValueError):
                # no writable state dir: run on, but an outage now loses telemetry
                log.exception("telemetry spool unavailable — offline telemetry is NOT durable")
        self._spool = spool
        self._acked: deque[int] = deque()    # PUBACK mids, appended on paho's thread
        self._inflight: dict[int, int] = {}  # mid -> spool row id (drain thread only)
        self._cursor = 0                     # last spool row id handed to paho
        self._new_session = False            # set on CONNACK, consumed by the drain thread
        self._drainer = threading.Thread(
            target=self._drain_loop, name="telemetry-drain", daemon=True)

    @property
    def dropped(self) -> int:
        """Publishes lost to full buffers — heartbeat buffer_dropped."""
        return self._queue_dropped + (self._spool.dropped if self._spool else 0)

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        self._thread.start()
        if self._spool is not None:
            self._drainer.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            self._client.disconnect()
        except Exception:
            pass
        self._thread.join(timeout=5.0)
        if self._drainer.is_alive():
            self._drainer.join(timeout=5.0)

    def reconnect(self) -> None:
        """Drop the session; the supervisor reconnects (re-reading credentials)."""
        try:
            self._client.disconnect()
        except Exception:  # noqa: BLE001
            log.exception("reconnect: disconnect failed")

    def queued(self) -> int:
        """Buffered QoS1 messages awaiting the connection — surfaced in the
        heartbeat as buffer_depth (doc 17 §6 heartbeat schema). Rows being
        drained count in both buffers (<= _DRAIN_WINDOW overcount)."""
        spooled = self._spool.depth() if self._spool else 0
        try:
            return len(self._client._out_messages) + spooled  # paho internal, read-only
        except Exception:  # noqa: BLE001
            return spooled

    # -- supervisor ----------------------------------------------------------

    def _run(self) -> None:
        backoff = _BACKOFF_MIN_S
        while not self._stop.is_set():
            try:
                self._attempts += 1
                self._refresh_credentials()
                if self._ever_connected:
                    self._client.reconnect()
                else:
                    self._client.connect(self._host, self._port,
                                         keepalive=_KEEPALIVE_S)
            except OSError as exc:
                backoff = self._wait(backoff, f"connect failed: {exc}")
                continue
            except Exception as exc:  # TLS setup, bad creds file, …
                backoff = self._wait(backoff, f"connect failed: {exc}")
                continue

            self._session = False
            try:
                # Blocks while connected; returns on drop because
                # reconnect_on_failure=False.
                rc = self._client.loop_forever(timeout=1.0)
            except Exception as exc:
                rc = f"loop error: {exc}"

            if self._stop.is_set():
                break
            if self._session:
                # a drop AFTER a real connection is a fresh incident — the
                # next retry is fast; only pre-CONNACK failures grow backoff
                backoff = _BACKOFF_MIN_S
            backoff = self._wait(backoff, f"connection dropped (rc={rc})")

        log.info("mqtt supervisor stopped")

    def _refresh_credentials(self) -> None:
        """Re-read provisioned credentials so rotation rides a reconnect."""
        if self._cred_provider is None:
            return
        try:
            user, pw = self._cred_provider()
            if user:
                self._client.username_pw_set(user, pw)
        except Exception:  # noqa: BLE001 — keep the last-known creds
            log.exception("credential reload failed — keeping last-known")

    def _wait(self, backoff: float, why: str) -> float:
        delay = backoff * random.uniform(1 - _JITTER, 1 + _JITTER)
        log.warning("mqtt %s — retrying in %.1fs (attempt %d)",
                    why, delay, self._attempts)
        self._stop.wait(delay)
        return min(backoff * 2, _BACKOFF_MAX_S)

    # -- paho callbacks (network thread) --------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code.is_failure:
            # Bad/old credential, disabled client, ACL-less identity — the
            # supervisor retries with backoff; rotation/rollback resolves it.
            log.error("mqtt CONNACK refused rc=%s", reason_code)
            return
        self._ever_connected = True
        self._session = True
        self._new_session = True
        self.connected.set()
        log.info("mqtt connected host=%s port=%d attempt=%d",
                 self._host, self._port, self._attempts)
        if self.on_connect is not None:
            try:
                self.on_connect(self)
            except Exception:
                log.exception("on_connect callback failed")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        self.connected.clear()
        if self._stop.is_set():
            return
        log.warning("mqtt disconnected rc=%s — supervisor will reconnect "
                    "with backoff+jitter", reason_code)
        if self.on_disconnect is not None:
            try:
                self.on_disconnect(self)
            except Exception:
                log.exception("on_disconnect callback failed")

    def _on_publish(self, client, userdata, mid, reason_code=None, properties=None):
        # paho holds its out-message lock here: hand off, never block or touch sqlite
        self._acked.append(mid)

    def _dispatch_message(self, client, userdata, msg) -> None:
        if self.on_message is not None:
            try:
                self.on_message(msg)
            except Exception:
                log.exception("on_message callback failed topic=%s", msg.topic)

    # -- publish / subscribe ----------------------------------------------------

    def subscribe(self, topic: str, qos: int = 1) -> None:
        rc, _ = self._client.subscribe(topic, qos=qos)
        if rc != mqtt.MQTT_ERR_SUCCESS:
            log.error("subscribe failed topic=%s rc=%s", topic, rc)
        else:
            log.info("subscribed topic=%s qos=%d", topic, qos)

    # -- telemetry spool drain (own thread) -------------------------------------

    def _drain_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._drain_once()
            except Exception:  # noqa: BLE001 — sqlite hiccup: retry next tick
                log.exception("telemetry drain failed")
            self._stop.wait(_DRAIN_TICK_S)

    def _drain_once(self) -> None:
        """Delete PUBACKed rows, then hand paho the next oldest rows up to the
        window. Unacked rows stay on disk; paho itself re-sends them after a
        reconnect (same client, same mid), and a restart replays from row 1."""
        while self._acked:
            row = self._inflight.pop(self._acked.popleft(), None)
            if row is not None:     # None = a live publish's ack
                self._spool.ack(row)
        if not self.connected.is_set():
            return
        if self._new_session:
            # paho may have lost in-flight messages with the old session: replay from the oldest row
            self._new_session = False
            self._inflight.clear()
            self._cursor = 0
        room = _DRAIN_WINDOW - len(self._inflight)
        if room <= 0:
            return
        for row, topic, payload in self._spool.peek(self._cursor, room):
            info = self._client.publish(topic, payload, qos=1)
            # NO_CONN: the link dropped under us, but paho queued it and re-sends
            if info.rc not in (mqtt.MQTT_ERR_SUCCESS, mqtt.MQTT_ERR_NO_CONN):
                break
            self._inflight[info.mid] = row
            self._cursor = row

    def _queue_has_room(self) -> bool:
        """Bound paho's out-queue while offline: non-durable payloads
        (frames, events) drop+count past _MAX_QUEUED; durable ones
        (audits) see a False return and spool to disk instead."""
        if self.connected.is_set():
            return True
        if self.queued() < _MAX_QUEUED:
            return True
        self._queue_dropped += 1
        if self._queue_dropped % 100 == 1:
            log.warning("offline out-queue full (>=%d) — dropping publishes "
                        "(total dropped=%d)", _MAX_QUEUED, self._queue_dropped)
        return False

    def _publish_telemetry(self, topic: str, data: str, qos: int) -> bool:
        if self.connected.is_set():
            info = self._client.publish(topic, data, qos=qos)  # live: never waits for backlog
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                return True
        try:
            self._spool.append(topic, data)  # offline: durable until PUBACKed
            return True
        except sqlite3.Error:
            log.exception("telemetry spool append failed topic=%s", topic)
            return False

    def publish_raw(self, topic: str, payload: bytes, qos: int = 0) -> bool:
        if not self._queue_has_room():
            return False
        info = self._client.publish(topic, payload, qos=qos)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def publish_json(self, topic: str, payload: dict, qos: int = 1) -> bool:
        if self._spool is not None and topic.split("/", 5)[4:5] == ["tele"]:
            return self._publish_telemetry(topic, json.dumps(payload), qos)
        if not self._queue_has_room():
            return False
        info = self._client.publish(topic, json.dumps(payload), qos=qos)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            log.warning("publish failed topic=%s rc=%s", topic, info.rc)
            return False
        return True
