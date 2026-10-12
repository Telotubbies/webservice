"""Self-observability unit tests (v4 T8) — offline, no services needed.

Covers: request-id middleware (generate/propagate/sanitize), the JSON access
log whitelist + secret redaction, Prometheus route-template labels (no
path-param leak), and /docs + /openapi.json gating to APP_ENV=dev.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from fastapi import FastAPI  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from prometheus_client import generate_latest  # noqa: E402

from app.observability import (  # noqa: E402
    ObservabilityMiddleware, metrics_response, redact, route_template,
)

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"

SECRET = "sup3r-SECRET-token.abc123="


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/tags/{name:path}/latest")
    def _tag(name: str):
        return {"name": name}

    @app.get("/api/v1/orgs/{org}/sites/{site}/edges")
    def _edges(org: str, site: str):
        return {"items": []}

    @app.post("/api/commands")
    def _cmd():
        return {"command_id": "x"}

    @app.get("/metrics")
    def _metrics():
        return metrics_response()

    app.add_middleware(ObservabilityMiddleware)
    return app


def _access_records(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "backend.access"]


# --------------------------------------------------------------- request id

def test_request_id_generated_and_returned():
    r = TestClient(_app()).get("/api/tags/x/latest")
    assert r.status_code == 200
    assert re.fullmatch(r"[0-9a-f]{32}", r.headers["x-request-id"])


def test_request_id_propagated_when_sane():
    r = TestClient(_app()).get("/api/tags/x/latest",
                              headers={"X-Request-ID": "uat.req_42"})
    assert r.headers["x-request-id"] == "uat.req_42"


def test_request_id_unsafe_inbound_is_replaced():
    # A client-supplied id outside the safe charset must not be echoed —
    # it could smuggle newlines/HTML into the JSON log line.
    c = TestClient(_app())
    r = c.get("/api/tags/x/latest",
              headers={"X-Request-ID": "has space<>\"' and more"})
    rid = r.headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", rid), rid


# --------------------------------------------------------------- access log

def test_access_log_fields_and_route_template(caplog):
    c = TestClient(_app())
    with caplog.at_level(logging.INFO, logger="backend.access"):
        r = c.get("/api/tags/plant1.line1.motor1.temp/latest",
                  headers={"X-Request-ID": "rid-9"})
    assert r.status_code == 200
    recs = _access_records(caplog)
    assert len(recs) == 1
    rec = recs[0]
    assert rec.method == "GET"
    # the TEMPLATE, never the raw path — no tag names in the log
    assert rec.route == "/api/tags/{name:path}/latest"
    assert rec.status == 200
    assert rec.request_id == "rid-9"
    assert isinstance(rec.latency_ms, float)
    assert rec.ip


def test_access_log_never_contains_secret_material(caplog):
    """The redaction gate: a request carrying the same secret in the
    Authorization header, a query param, a cookie and the URL path must not
    put a byte of it into the emitted log record."""
    c = TestClient(_app())
    with caplog.at_level(logging.INFO, logger="backend.access"):
        c.get(f"/api/tags/{SECRET}/latest?token={SECRET}&password={SECRET}",
              headers={"Authorization": f"Bearer {SECRET}",
                       "Cookie": f"sid={SECRET}",
                       "X-Api-Key": SECRET})
        c.post("/api/commands",
               headers={"Authorization": f"Bearer {SECRET}"},
               content=b'{"token": "x"}')
    recs = _access_records(caplog)
    assert len(recs) == 2
    for rec in recs:
        blob = repr(vars(rec)) + rec.getMessage()
        assert SECRET not in blob
        assert "Bearer" not in blob


def test_redact_scrubs_known_secret_shapes():
    for s in (
        f"token={SECRET}",
        f"access_token:{SECRET}",
        f"Authorization: Bearer {SECRET}",
        f"bearer {SECRET}",
        f"logout_token = {SECRET}",
        f"cookie: sid={SECRET}",
        f"set-cookie={SECRET}",
        f"api-key:{SECRET}",
        f"password={SECRET}&other=1",
    ):
        out = redact(s)
        assert SECRET not in out, s
    # non-secret text passes through untouched
    assert redact("/api/tags/{name}/latest") == "/api/tags/{name}/latest"


# ----------------------------------------------------------------- metrics

def test_metrics_use_route_templates_no_path_param_leak():
    c = TestClient(_app())
    org, site = str(uuid.uuid4()), str(uuid.uuid4())
    tag = f"plant1.leak{uuid.uuid4().hex[:8]}.sig"
    assert c.get(f"/api/tags/{tag}/latest").status_code == 200
    assert c.get(f"/api/v1/orgs/{org}/sites/{site}/edges").status_code == 200
    assert c.get("/totally-unknown-path/zzz").status_code == 404
    text = generate_latest().decode()

    assert "wds_http_requests_total" in text
    assert "wds_http_request_duration_seconds" in text
    assert 'route="/api/tags/{name:path}/latest"' in text
    assert 'route="/api/v1/orgs/{org}/sites/{site}/edges"' in text
    assert 'route="unmatched"' in text          # 404s collapse into one series
    # the raw values are nowhere in ANY metric line
    for needle in (tag, org, site):
        assert needle not in text


def test_metrics_endpoint_shape():
    r = TestClient(_app()).get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "# HELP" in r.text or "wds_http_requests_total" in r.text


def test_route_template_unmatched_without_route():
    assert route_template({"type": "http"}) == "unmatched"


# ------------------------------------------------------------ docs gating

def _probe_app(env_extra: dict) -> subprocess.CompletedProcess:
    """Subprocess `import app.main` — the docs/openapi decision is made at
    app construction from config.APP_ENV, read at import time."""
    env = os.environ.copy()
    env.update(env_extra)
    env["PYTHONPATH"] = str(BACKEND)
    return subprocess.run(
        [sys.executable, "-c",
         "import app.main as m;"
         "print('docs:', m.app.docs_url);"
         "print('openapi:', m.app.openapi_url);"
         "print('redoc:', m.app.redoc_url)"],
        env=env, capture_output=True, text=True, timeout=60)


def test_docs_served_in_dev():
    r = _probe_app({"APP_ENV": "dev"})
    assert r.returncode == 0, r.stderr
    assert "docs: /docs" in r.stdout
    assert "openapi: /openapi.json" in r.stdout
    assert "redoc: /redoc" in r.stdout


def test_docs_hidden_in_test_env():
    r = _probe_app({"APP_ENV": "test"})
    assert r.returncode == 0, r.stderr
    assert "docs: None" in r.stdout
    assert "openapi: None" in r.stdout
    assert "redoc: None" in r.stdout


def test_docs_hidden_in_prod_env(tmp_path):
    """T5-deferred F7: a fully-provisioned APP_ENV=prod boot (all secrets
    present — same env shape as test_config_prod) must still serve no docs."""
    def secret(name: str, value: str) -> str:
        p = tmp_path / name
        p.write_text(value)
        return str(p)

    r = _probe_app({
        "APP_ENV": "prod",
        "OIDC_ISSUER": "https://idp.example.com/realms/wds",
        "OIDC_JWKS_URI": "https://idp.example.com/realms/wds/protocol/openid-connect/certs",
        "WDS_APP_DSN": "postgresql://wds_app@db.internal:5432/wds",
        "WDS_SYSTEM_DSN": "postgresql://wds_system@db.internal:5432/wds",
        "WDS_APP_PASSWORD_FILE": secret("app_pw", "r3al-app-pw"),
        "WDS_SYSTEM_PASSWORD_FILE": secret("sys_pw", "r3al-sys-pw"),
        "MQTT_USER": "svc-backend",
        "MQTT_PASSWORD_FILE": secret("mqtt_pw", "r3al-mqtt-pw"),
        "MQTT_CA_FILE": secret("ca", "-----BEGIN CERTIFICATE-----"),
        "DYNSEC_ADMIN_PASSWORD_FILE": secret("dynsec_pw", "r3al-dynsec-pw"),
        "SVC_BACKEND_PW_FILE": secret("svc_pw", "r3al-svc-pw"),
        "EDGE_BOOTSTRAP_PW_FILE": secret("edge_pw", "r3al-edge-pw"),
        "KC_ADMIN": "kc-admin",
        "KC_ADMIN_PASSWORD_FILE": secret("kc_pw", "r3al-kc-pw"),
        "KC_DEMO_PASSWORD_FILE": secret("kc_demo", "r3al-demo-pw"),
        "TRUSTED_PROXIES": "10.0.0.8/32",
        "ALLOWED_ORIGINS": "https://ops.example.com",
    })
    assert r.returncode == 0, r.stderr
    assert "docs: None" in r.stdout
    assert "openapi: None" in r.stdout
    assert "redoc: None" in r.stdout
