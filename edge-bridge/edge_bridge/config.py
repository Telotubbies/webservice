"""Environment-driven configuration (contract §Env vars)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_user: str | None = None
    mqtt_password: str | None = None
    edge_id: str = "edge1"
    site: str = "plant1"
    adapter: str = "sim"
    poll_ms: int = 1000
    clock_skew_ms: float = 0.0
    tags_config: str = "tags.yaml"
    heartbeat_s: float = 5.0          # contract: heartbeat every 5 s
    clock_ok_threshold_ms: float = 500.0

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "localhost"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            mqtt_user=os.getenv("MQTT_USER") or None,
            mqtt_password=os.getenv("MQTT_PASSWORD") or None,
            edge_id=os.getenv("EDGE_ID", "edge1"),
            site=os.getenv("SITE", "plant1"),
            adapter=os.getenv("ADAPTER", "sim"),
            poll_ms=int(os.getenv("POLL_MS", "1000")),
            clock_skew_ms=float(os.getenv("EDGE_CLOCK_SKEW_MS", "0")),
            tags_config=os.getenv("TAGS_CONFIG", "tags.yaml"),
        )
