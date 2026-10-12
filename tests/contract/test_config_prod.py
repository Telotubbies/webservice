"""APP_ENV=prod fail-fast (v4 T7, doc 20 §3.5): subprocess `import app.config`
must refuse loudly when required envs are missing or still dev-default.

Runs in a subprocess because the check fires at import time — in-process the
contract suite runs with APP_ENV unset (dev) and must stay green.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"

_CHECKED_VARS = [
    "OIDC_ISSUER", "OIDC_JWKS_URI", "OIDC_AUDIENCE", "OIDC_CLIENT_ID",
    "WDS_APP_DSN", "WDS_SYSTEM_DSN",
    "WDS_APP_PASSWORD", "WDS_APP_PASSWORD_FILE",
    "WDS_SYSTEM_PASSWORD", "WDS_SYSTEM_PASSWORD_FILE",
    "MQTT_USER", "MQTT_PASSWORD", "MQTT_PASSWORD_FILE", "MQTT_CA_FILE",
    "DYNSEC_ADMIN_PASSWORD_FILE", "SVC_BACKEND_PW_FILE", "EDGE_BOOTSTRAP_PW_FILE",
    "KC_ADMIN", "KC_ADMIN_PASSWORD", "KC_ADMIN_PASSWORD_FILE",
    "KC_DEMO_PASSWORD", "KC_DEMO_PASSWORD_FILE",
    "TRUSTED_PROXIES", "ALLOWED_ORIGINS",
]


def _import_config(env_extra: dict) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    for k in _CHECKED_VARS:
        env.pop(k, None)
    env.update(env_extra)
    env["PYTHONPATH"] = str(BACKEND)
    return subprocess.run(
        [sys.executable, "-c", "import app.config"],
        env=env, capture_output=True, text=True, timeout=30)


@pytest.fixture()
def prod_env(tmp_path: Path) -> dict:
    """A complete, non-dev prod env — every secret from a real file."""
    def secret(name: str, value: str) -> str:
        p = tmp_path / name
        p.write_text(value)
        return str(p)

    return {
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
    }


def test_dev_default_app_env_unaffected():
    r = _import_config({"APP_ENV": "dev"})
    assert r.returncode == 0, r.stderr


def test_unset_app_env_is_dev():
    env = {"PYTHONPATH": str(BACKEND)}
    env.pop("APP_ENV", None)
    r = _import_config(env)
    assert r.returncode == 0, r.stderr


def test_test_env_unaffected():
    r = _import_config({"APP_ENV": "test"})
    assert r.returncode == 0, r.stderr


def test_prod_missing_envs_refuses():
    r = _import_config({"APP_ENV": "prod"})
    assert r.returncode != 0
    out = r.stderr + r.stdout
    for name in ("OIDC_ISSUER", "OIDC_JWKS_URI", "WDS_APP_DSN", "WDS_SYSTEM_DSN",
                 "MQTT_PASSWORD_FILE", "DYNSEC_ADMIN_PASSWORD_FILE",
                 "ALLOWED_ORIGINS", "TRUSTED_PROXIES"):
        assert name in out, name


def test_prod_dev_defaults_refuse(prod_env):
    """Every env present, but secrets still carry the documented dev values."""
    env = dict(prod_env)
    env["WDS_APP_DSN"] = "postgresql://wds_app:app-dev-pass@db.internal:5432/wds"
    env.pop("WDS_APP_PASSWORD_FILE")
    env.pop("KC_ADMIN_PASSWORD_FILE")
    env["KC_ADMIN_PASSWORD"] = "admin-dev-pass"
    r = _import_config(env)
    assert r.returncode != 0
    assert "dev-default" in (r.stderr + r.stdout)


def test_prod_dev_default_file_contents_refuse(prod_env, tmp_path):
    p = tmp_path / "app_pw_dev"
    p.write_text("app-dev-pass")
    env = dict(prod_env)
    env["WDS_APP_PASSWORD_FILE"] = str(p)
    r = _import_config(env)
    assert r.returncode != 0


def test_prod_default_oidc_issuer_refuses(prod_env):
    env = dict(prod_env)
    env["OIDC_ISSUER"] = "http://localhost:5173/realms/wds"
    r = _import_config(env)
    assert r.returncode != 0


def test_prod_unreadable_secret_file_refuses(prod_env):
    env = dict(prod_env)
    env["DYNSEC_ADMIN_PASSWORD_FILE"] = "/nonexistent/pw"
    r = _import_config(env)
    assert r.returncode != 0
    assert "DYNSEC_ADMIN_PASSWORD_FILE" in (r.stderr + r.stdout)


def test_unknown_app_env_is_fail_closed():
    """A typo'd APP_ENV must be strict, not silently treated as dev."""
    r = _import_config({"APP_ENV": "prodution"})
    assert r.returncode != 0


def test_prod_complete_env_passes(prod_env):
    r = _import_config(prod_env)
    assert r.returncode == 0, r.stderr
