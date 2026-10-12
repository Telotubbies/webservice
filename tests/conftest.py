"""Shared fixtures + integration gating.

Default `pytest` run: contract/unit tests only — integration tests are
collected but SKIP unless the env vars they need are present:

    BASE_URL   e.g. http://localhost:8000      → REST / WS tests
    MQTT_HOST  e.g. localhost (+ MQTT_PORT)    → broker-level tests
    DISRUPTIVE=1                               → tests that stop/start services

Usage:
    pytest                        # unit/contract only (no services needed)
    BASE_URL=http://localhost:8000 MQTT_HOST=localhost pytest -m integration
"""

from __future__ import annotations

import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(__file__))  # `contract` package import

BASE_URL = os.environ.get("BASE_URL", "").rstrip("/")
MQTT_HOST = os.environ.get("MQTT_HOST", "")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "tester")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "tester-demo-pass")
OPERATOR_TOKEN = os.environ.get("OPERATOR_TOKEN", "demo-operator")
VIEWER_TOKEN = os.environ.get("VIEWER_TOKEN", "demo-viewer")

TAGS = {
    "running": "plant1.sort.line1.motor1.running",
    "speed_sp": "plant1.sort.line1.motor1.speed_sp",
    "speed_mps": "plant1.sort.line1.conv1.speed_mps",
    "temp_c": "plant1.sort.line1.conv1.temp_c",
    "level_pct": "plant1.sort.line1.bin1.level_pct",
    "gravel_ratio": "plant1.sort.vision.cam1.gravel_ratio",
}
SITE = os.environ.get("SITE", "plant1")
EDGE_ID = os.environ.get("EDGE_ID", "edge1")


def wait_until(predicate, timeout_s: float, interval_s: float = 0.5, desc: str = "condition"):
    """Poll `predicate()` until truthy or timeout. Returns last value or raises."""
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval_s)
    raise AssertionError(f"timed out after {timeout_s}s waiting for {desc}; last={last!r}")


# ------------------------------------------------------------------ REST

@pytest.fixture(scope="session")
def base_url() -> str:
    if not BASE_URL:
        pytest.skip("BASE_URL not set — skipping REST integration test")
    return BASE_URL


@pytest.fixture()
def api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        yield client


@pytest.fixture(scope="session")
def operator_headers() -> dict:
    return {"Authorization": f"Bearer {OPERATOR_TOKEN}"}


@pytest.fixture(scope="session")
def viewer_headers() -> dict:
    return {"Authorization": f"Bearer {VIEWER_TOKEN}"}


@pytest.fixture()
def operator_api(api, operator_headers):
    api.headers.update(operator_headers)
    return api


# ------------------------------------------------------------------- MQTT

@pytest.fixture()
def mqtt_client():
    """Connected paho client; skipped unless MQTT_HOST is set."""
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set — skipping MQTT integration test")
    mqtt = pytest.importorskip("paho.mqtt.client")
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()
    yield client
    client.loop_stop()
    client.disconnect()


# ----------------------------------------------------------------- WS URL

@pytest.fixture(scope="session")
def ws_base(base_url) -> str:
    if base_url.startswith("https"):
        return "wss" + base_url[5:]
    return "ws" + base_url[4:]


# --------------------------------------------------------- disruptive gate

@pytest.fixture(scope="session")
def disruptive():
    if os.environ.get("DISRUPTIVE") != "1":
        pytest.skip("disruptive test — set DISRUPTIVE=1 to enable")
    return True


@pytest.fixture(scope="session")
def compose_file() -> str:
    return os.environ.get(
        "COMPOSE_FILE",
        os.path.join(os.path.dirname(__file__), "..", "docker-compose.yml"),
    )
