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
"""

from __future__ import annotations

import json
import logging
import random
import threading
from typing import Callable

import paho.mqtt.client as mqtt

log = logging.getLogger("edge_bridge.mqtt")

_BACKOFF_MIN_S = 1.0
_BACKOFF_MAX_S = 60.0
_JITTER = 0.5  # delay * uniform(1-JITTER, 1+JITTER)
_KEEPALIVE_S = 30


class MqttBridge:
    """Thin wrapper around paho: one supervisor thread, thread-safe publish.

    While disconnected, paho queues QoS1 publishes in its out-queue and
    flushes them on reconnect (store-and-forward lite); failures to even
    enqueue are logged.
    """

    # Public callbacks, assignable after construction (paho-style):
    #   on_connect(bridge) — e.g. (re)subscribe; fires on every reconnect
    #   on_message(msg)    — runs on paho's network thread
    on_connect: Callable[["MqttBridge"], None] | None = None
    on_message: Callable[[mqtt.MQTTMessage], None] | None = None

    def __init__(self, host: str, port: int, client_id: str,
                 cred_provider: Callable[[], tuple[str | None, str | None]] | None = None,
                 ca_file: str | None = None,
                 will_topic: str | None = None, will_payload: str | None = None):
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

        self.connected = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name="mqtt-supervisor", daemon=True)
        self._attempts = 0
        self._ever_connected = False
        self._session = False   # CONNACK-accepted during the current attempt

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            self._client.disconnect()
        except Exception:
            pass
        self._thread.join(timeout=5.0)

    def reconnect(self) -> None:
        """Drop the session; the supervisor reconnects (re-reading credentials)."""
        try:
            self._client.disconnect()
        except Exception:  # noqa: BLE001
            log.exception("reconnect: disconnect failed")

    def queued(self) -> int:
        """Buffered QoS1 messages awaiting the connection — surfaced in the
        heartbeat as buffer_depth (doc 17 §6 heartbeat schema)."""
        try:
            return len(self._client._out_messages)  # paho internal, read-only
        except Exception:  # noqa: BLE001
            return 0

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

    def publish_raw(self, topic: str, payload: bytes, qos: int = 0) -> bool:
        info = self._client.publish(topic, payload, qos=qos)
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def publish_json(self, topic: str, payload: dict, qos: int = 1) -> bool:
        info = self._client.publish(topic, json.dumps(payload), qos=qos)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            log.warning("publish failed topic=%s rc=%s", topic, info.rc)
            return False
        return True
