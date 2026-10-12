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
# `app.*` imports for offline unit tests (JWT verifier, auth gates) — the
# modules are import-safe: config reads env once, nothing connects at import.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

BASE_URL = os.environ.get("BASE_URL", "").rstrip("/")
MQTT_HOST = os.environ.get("MQTT_HOST", "")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "tester")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "tester-demo-pass")
OPERATOR_TOKEN = os.environ.get("OPERATOR_TOKEN", "demo-operator")
VIEWER_TOKEN = os.environ.get("VIEWER_TOKEN", "demo-viewer")

# v4 T5 — OIDC via Keycloak (ADR-12). The compose stack publishes KC on
# 127.0.0.1:8080; the public iss is the web origin (KC_HOSTNAME), so a token
# minted via the loopback port still carries iss=http://localhost:5173/realms/wds.
KC_URL = os.environ.get("KC_URL", "http://localhost:8080")
KC_REALM = os.environ.get("KC_REALM", "wds")
KC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "wds-web")
KC_DEMO_PASSWORD = os.environ.get("KC_DEMO_PASSWORD", "kc-demo-pass")


def kc_password_token(username: str, password: str = KC_DEMO_PASSWORD) -> str:
    """Resource-owner password grant against the test realm (direct access
    grants are enabled on wds-web for exactly this — headless test auth).
    Returns the access_token, or '' when KC isn't reachable."""
    import urllib.parse
    import urllib.request
    try:
        import json as _json
        body = urllib.parse.urlencode({
            "grant_type": "password", "client_id": KC_CLIENT_ID,
            "username": username, "password": password,
        }).encode()
        url = f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect/token"
        with urllib.request.urlopen(
                urllib.request.Request(url, data=body), timeout=8) as r:
            return _json.loads(r.read())["access_token"]
    except Exception:  # noqa: BLE001
        return ""


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
def api(base_url, operator_headers):
    """Authenticated client (operator token). v4 T5 ended anonymous reads —
    tests that probe the unauthenticated path must use `anon_api`."""
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers=operator_headers) as client:
        yield client


@pytest.fixture()
def anon_api(base_url):
    """Client with NO Authorization header — the only way to exercise the
    anonymous -> 401 path now that anonymous reads are gone (v4 T5)."""
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        yield client


@pytest.fixture(scope="session")
def operator_headers() -> dict:
    return {"Authorization": f"Bearer {OPERATOR_TOKEN}"}


@pytest.fixture(scope="session")
def viewer_headers() -> dict:
    return {"Authorization": f"Bearer {VIEWER_TOKEN}"}


@pytest.fixture(scope="session")
def oidc_headers() -> dict:
    """A REAL Keycloak access token (operator@demo) — requires `make seed-dev`
    to have set the demo password. Skips cleanly when the realm isn't up."""
    token = kc_password_token("operator@demo")
    if not token:
        pytest.skip("keycloak realm not reachable / demo user not provisioned "
                    "(run `make seed-dev`)")
    return {"Authorization": f"Bearer {token}"}


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
