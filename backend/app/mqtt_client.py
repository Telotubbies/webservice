"""MQTT bridge — paho client wrapping broker connectivity.

Runs paho's own network thread (loop_start). Incoming messages are handed to
the asyncio event loop via call_soon_threadsafe into a bounded queue; the
ingest worker in main.py drains it. Outgoing publishes are thread-safe and
called directly from the loop thread.

Topics (doc 17 §1 — org/site/edge are immutable UUIDs):
  subscribe  $share/ingest/v2/+/+/+/tele/#       QoS 1
             $share/ingest/v2/+/+/+/hb           QoS 1
             $share/ingest/v2/+/+/+/cmd-resp/+   QoS 1
  publish    v2/{org}/{site}/{edge}/cmd/{command_id} QoS 1

Doc 17 §3 also allows plain v2/+/+/+/{tele/#,hb} subscriptions "fan-out to
every replica"; this single replica uses only the shared `ingest` group so
multiple future backends get single-writer delivery without double-ingest.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

import paho.mqtt.client as mqtt

log = logging.getLogger("backend.mqtt")

QUEUE_MAX = 5000

SUBSCRIPTIONS = (
    "$share/ingest/v2/+/+/+/tele/#",
    "$share/ingest/v2/+/+/+/hb",
    "$share/ingest/v2/+/+/+/cmd-resp/+",
)


def command_topic(org_id, site_id, edge_id, command_id: str) -> str:
    return f"v2/{org_id}/{site_id}/{edge_id}/cmd/{command_id}"


class MQTTBridge:
    def __init__(self, host: str, port: int, username: str | None = None,
                 password: str | None = None, ca_file: str | None = None):
        self.host = host
        self.port = port
        self.connected = False
        self.dropped_msgs = 0
        self.queue: asyncio.Queue[mqtt.MQTTMessage] = asyncio.Queue(QUEUE_MAX)
        self._loop: asyncio.AbstractEventLoop | None = None
        self.on_state_change = None  # callable(connected: bool) — set by main

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            # Random suffix: two backends briefly coexisting (rolling deploy)
            # must not fight over the same client_id at the broker.
            client_id=f"backend-{uuid.uuid4().hex[:6]}",
            clean_session=True,
        )
        if username:
            self.client.username_pw_set(username, password)
        if ca_file:
            self.client.tls_set(ca_certs=ca_file)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)

    # -- lifecycle -----------------------------------------------------------
    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        try:
            self.client.connect_async(self.host, self.port, keepalive=30)
            self.client.loop_start()
            log.info(
                "mqtt connecting", extra={"host": self.host, "port": self.port}
            )
        except OSError as exc:
            # connect_async itself can fail (bad host); app must still run —
            # /api/health reports mqtt:"down".
            log.error("mqtt connect_async failed: %s", exc)

    def stop(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:  # noqa: BLE001 — shutdown best-effort
            pass

    # -- paho callbacks (network thread — keep them cheap/thread-safe) -------
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        ok = not reason_code.is_failure
        self.connected = ok
        if ok:
            for sub in SUBSCRIPTIONS:
                client.subscribe(sub, qos=1)
            log.info("mqtt connected", extra={"subscribe": ",".join(SUBSCRIPTIONS)})
        else:
            log.warning("mqtt connect refused", extra={"rc": str(reason_code)})
        self._notify_state()

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        was = self.connected
        self.connected = False
        if was:
            log.warning("mqtt disconnected", extra={"rc": str(reason_code)})
        self._notify_state()

    def _notify_state(self) -> None:
        if self._loop and self.on_state_change:
            try:
                self._loop.call_soon_threadsafe(
                    self.on_state_change, self.connected
                )
            except RuntimeError:
                pass  # loop closing

    def _on_message(self, client, userdata, msg):
        if self._loop is None:
            return
        try:
            self._loop.call_soon_threadsafe(self._enqueue, msg)
        except RuntimeError:
            pass  # loop closing

    def _enqueue(self, msg) -> None:
        try:
            self.queue.put_nowait(msg)
        except asyncio.QueueFull:
            self.dropped_msgs += 1
            if self.dropped_msgs % 100 == 1:
                log.warning(
                    "mqtt ingest queue full — dropping message",
                    extra={"dropped": self.dropped_msgs},
                )

    # -- publish --------------------------------------------------------------
    def publish_command(self, topic: str, payload: dict) -> bool:
        """Publish a command request to `v2/{o}/{s}/{e}/cmd/{id}`.
        Returns True if paho accepted it (doc 17 §3: retain=false)."""
        try:
            info = self.client.publish(
                topic,
                json.dumps(payload, separators=(",", ":")),
                qos=1, retain=False,
            )
            ok = info.rc == mqtt.MQTT_ERR_SUCCESS
            if not ok:
                log.error(
                    "command publish failed",
                    extra={"rc": info.rc, "topic": topic},
                )
            return ok
        except Exception:  # noqa: BLE001 — paho can raise on dead client
            log.exception("command publish raised")
            return False
