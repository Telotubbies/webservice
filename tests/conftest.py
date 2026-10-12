"""Shared fixtures + integration gating.

Default `pytest` run: contract/unit tests only — integration tests are
collected but SKIP unless the env vars they need are present:

    BASE_URL    e.g. http://localhost:8000         → REST / WS tests
    MQTT_HOST   e.g. localhost (+ MQTT_PORT=8883)  → broker-level tests
    DISRUPTIVE=1                                   → tests that stop/start services

Broker access is TLS + dynsec (doc 17): tests connect as the `tester`
identity whose secret lives in infra/secrets/tester_pw (created only under
the test compose overlay) and verify against infra/certs/ca.crt.

Usage:
    pytest                        # unit/contract only (no services needed)
    BASE_URL=http://localhost:8000 MQTT_HOST=localhost MQTT_PORT=8883 \
        pytest -m integration
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(__file__))  # `contract` package import
# `app.*` imports for offline unit tests (JWT verifier, auth gates) — the
# modules are import-safe: config reads env once, nothing connects at import.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

REPO = Path(__file__).resolve().parent.parent

BASE_URL = os.environ.get("BASE_URL", "").rstrip("/")
MQTT_HOST = os.environ.get("MQTT_HOST", "")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "8883"))
MQTT_CA_FILE = os.environ.get("MQTT_CA_FILE") or str(REPO / "infra/certs/ca.crt")
OPERATOR_TOKEN = os.environ.get("OPERATOR_TOKEN", "demo-operator")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "demo-admin")
VIEWER_TOKEN = os.environ.get("VIEWER_TOKEN", "demo-viewer")


def _secret(name: str) -> str:
    try:
        return (REPO / "infra" / "secrets" / name).read_text().strip()
    except OSError:
        return ""


MQTT_USER = os.environ.get("MQTT_USER", "tester")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD") or _secret("tester_pw")

# doc 17 §1 — v2 topic identity of the dev-seeded edge (UUIDs only).
ORG_ID = os.environ.get("V1_ORG_ID", "0199d000-0000-7000-8000-00000000a001")
SITE_ID = os.environ.get("V1_SITE_ID", "0199d000-0000-7000-8000-00000000b001")
EDGE_UUID = os.environ.get("V1_EDGE_ID", "0199d000-0000-7000-8000-00000000c001")
V2_PREFIX = f"v2/{ORG_ID}/{SITE_ID}/{EDGE_UUID}"


def v2_tele(path: str) -> str:
    return f"{V2_PREFIX}/tele/{path}"


def v2_hb() -> str:
    return f"{V2_PREFIX}/hb"


def v2_cmd(command_id: str) -> str:
    return f"{V2_PREFIX}/cmd/{command_id}"


def v2_cmd_resp(command_id: str) -> str:
    return f"{V2_PREFIX}/cmd-resp/{command_id}"


def mqtt_connect(client=None, username=MQTT_USER, password=MQTT_PASSWORD):
    """Connect a paho client over TLS as a dynsec identity."""
    import paho.mqtt.client as mqtt
    c = client or mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                              client_id=f"pytest-{uuid.uuid4().hex[:8]}")
    if username:
        c.username_pw_set(username, password)
    c.tls_set(ca_certs=MQTT_CA_FILE)
    c.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    c.loop_start()
    return c

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
def admin_headers() -> dict:
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


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
    """Connected paho client as `tester` (TLS, test profile only); skipped
    unless MQTT_HOST is set."""
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set — skipping MQTT integration test")
    if not MQTT_PASSWORD:
        pytest.skip("tester secret missing — run under the test overlay "
                    "(`make up-test`, infra/secrets/tester_pw)")
    client = mqtt_connect()
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
