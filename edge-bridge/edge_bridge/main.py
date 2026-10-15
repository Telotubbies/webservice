"""edge-bridge entrypoint.

Run:  MQTT_HOST=localhost python -m edge_bridge.main

Threads: paho supervisor (connect/loop/reconnect), poll loop (every POLL_MS),
heartbeat loop (every 5 s). Command handling happens on paho's network
thread via on_message -> CommandHandler. SIGTERM/SIGINT stops everything.

Topics are doc-17 v2: the edge publishes only on its own prefix
`v2/{org_id}/{site_id}/{edge_id}/{tele/*,hb,cmd-resp/*}` and subscribes to
`cmd/+` — the broker ACL denies everything else, so even a compromised
bridge process can't speak for another edge.
"""

from __future__ import annotations

import json
import logging
import signal
import threading
import time

from .adapters import IdleAdapter, load_tags_config, make_adapter
from .cfg import AdapterHolder, CfgClient
from .credpush import CredClient
from .clock import EdgeClock
from .commands import CommandHandler
from .config import Config
from .enroll import EnrollError, enroll_if_needed
from .logging_setup import setup_logging
from .mqtt_bridge import MqttBridge

log = logging.getLogger("edge_bridge.main")


def _poll_loop(stop: threading.Event, cfg: Config, holder: AdapterHolder,
               bridge: MqttBridge, health: dict) -> None:
    next_tick = time.monotonic()  # monotonic: immune to NTP slew (SDLC §6.6)
    while not stop.is_set():
        adapter = holder.get()  # re-read: a cfg push may have swapped it
        period = max(holder.poll_ms, 100) / 1000.0  # floor matches backend CHECK
        try:
            values = adapter.read_all()
            health["read_failures"] = 0
        except Exception:
            health["read_failures"] = health.get("read_failures", 0) + 1
            log.exception("adapter %s read_all failed — skipping cycle",
                          adapter.name)
            values = []
        for tv in values:
            bridge.publish_json(cfg.tele_topic(cfg.tag_path(tv.name)),
                                tv.payload())

        next_tick += period
        delay = next_tick - time.monotonic()
        if delay < 0:  # fell behind: resync, don't burst-catch-up
            next_tick = time.monotonic()
            delay = period
        stop.wait(delay)


def _heartbeat_loop(stop: threading.Event, cfg: Config, holder: AdapterHolder,
                    bridge: MqttBridge, clock: EdgeClock,
                    health: dict) -> None:
    while not stop.is_set():
        read_failures = health.get("read_failures", 0)
        degraded = read_failures > 0 or not clock.clock_ok
        payload = {
            # "degraded" = alive but impaired (bad clock / adapter reads
            # failing). Backend treats missing heartbeat as "stale".
            "status": "degraded" if degraded else "up",
            "clock_ok": clock.clock_ok,
            "clock_offset_ms": clock.skew_ms,
            "read_failures": read_failures,
            "buffer_depth": bridge.queued(),
            "buffer_dropped": 0,
            "adapter": holder.get().name,
            "ts": clock.now().isoformat().replace("+00:00", "Z"),
        }
        bridge.publish_json(cfg.hb_topic, payload)
        stop.wait(cfg.heartbeat_s)


def main() -> int:
    setup_logging()
    try:
        identity = enroll_if_needed(Config.from_env().state_dir)
    except EnrollError as exc:
        log.error("enrollment failed: %s", exc)
        return 3   # non-zero: the container restart policy retries
    cfg = Config.from_env(identity)
    if not cfg.org_id or not cfg.site_id or not cfg.edge_id:
        log.error("ORG_ID/SITE_ID/EDGE_ID (uuids) are required — the v2 "
                  "topic namespace has no human names")
        return 2
    clock = EdgeClock(cfg.clock_skew_ms, cfg.clock_ok_threshold_ms)

    if cfg.enrolled:
        # enrolled: nothing is published until the console pushes a cfg
        adapter = IdleAdapter()
    else:
        tags_cfg = load_tags_config(cfg.tags_config)
        adapter = make_adapter(cfg.adapter, cfg.site_code, tags_cfg, now=clock.now)

    health: dict = {"read_failures": 0}
    bridge = MqttBridge(
        cfg.mqtt_host, cfg.mqtt_port,
        client_id=f"edge-{cfg.edge_id}",
        cred_provider=cfg.credentials,
        ca_file=cfg.mqtt_ca_file,
        # If we vanish ungracefully, the broker tells the world we're down —
        # without this, silence is indistinguishable from "all good".
        will_topic=cfg.hb_topic,
        will_payload=json.dumps({"status": "down", "clock_ok": None}),
    )
    holder = AdapterHolder(adapter, cfg.poll_ms)
    handler = CommandHandler(cfg, holder, clock, bridge)
    cfg_client = CfgClient(cfg, holder, bridge, cfg.site_code, now=clock.now)
    # A cached backend cfg wins over tags.yaml; tags.yaml stays the fallback.
    cfg_client.load_cached()
    cred_client = CredClient(cfg, bridge.reconnect) if cfg.enrolled else None
    adapter = holder.get()

    def _on_connect(b: MqttBridge) -> None:
        # Re-subscribes on every reconnect (on_connect fires per CONNACK).
        b.subscribe(handler.cmd_topic, qos=1)
        cfg_client.on_connect(b)
        if cred_client is not None:
            b.subscribe(cfg.cred_topic, qos=1)

    def _on_message(msg) -> None:
        if msg.topic == cfg.cfg_topic:
            cfg_client.handle(msg)
        elif cred_client is not None and msg.topic == cfg.cred_topic:
            cred_client.handle(msg)
        else:
            handler.handle_message(msg)

    bridge.on_connect = _on_connect
    bridge.on_message = _on_message

    log.info(
        "edge-bridge starting org=%s site=%s edge=%s adapter=%s poll_ms=%d "
        "mqtt=%s:%d tls=%s clock_skew_ms=%s clock_ok=%s tags=%d",
        cfg.org_id, cfg.site_id, cfg.edge_id, adapter.name, holder.poll_ms,
        cfg.mqtt_host, cfg.mqtt_port, bool(cfg.mqtt_ca_file),
        cfg.clock_skew_ms, clock.clock_ok,
        len(adapter.tag_map()),
        extra={"fields": {"event": "startup", "adapter": adapter.name,
                          "poll_ms": holder.poll_ms, "site": cfg.site_id,
                          "edge_id": cfg.edge_id}},
    )

    stop = threading.Event()

    def _sigterm(signum, frame):
        log.info("signal %d received — shutting down", signum,
                 extra={"fields": {"event": "shutdown"}})
        stop.set()

    signal.signal(signal.SIGTERM, _sigterm)
    signal.signal(signal.SIGINT, _sigterm)

    bridge.start()
    threads = [
        threading.Thread(target=_poll_loop, name="poll",
                         args=(stop, cfg, holder, bridge, health),
                         daemon=True),
        threading.Thread(target=_heartbeat_loop, name="heartbeat",
                         args=(stop, cfg, holder, bridge, clock, health),
                         daemon=True),
    ]
    for t in threads:
        t.start()

    stop.wait()  # main thread idles until SIGTERM/SIGINT

    bridge.stop()
    holder.get().close()
    for t in threads:
        t.join(timeout=2.0)
    log.info("edge-bridge stopped cleanly cmds_handled=%d denies=%d",
             handler.handled, handler.denied)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
