"""Compose/infra security checks (v4 T13).

Asserted against the repo + running containers:

- The DEFAULT compose profile exposes no plaintext MQTT 1883 listener —
  it exists only under docker-compose.test.yml (and only on loopback).
- The `tester` fault-injection identity is wired ONLY by the test
  overlay — absent from the base compose graph.
- No infra/secrets value appears in `docker inspect` output for any
  running service (env, healthcheck, command) — the file-mount contract.
- Host port bindings are loopback-scoped, not 0.0.0.0.

These are repo+daemon level, gated on `docker` being available; HTTP
surface checks live in the sibling modules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

REPO = Path(__file__).resolve().parents[2]
BASE_COMPOSE = REPO / "docker-compose.yml"
TEST_OVERLAY = REPO / "docker-compose.test.yml"


def _docker():
    if not shutil.which("docker"):
        pytest.skip("docker CLI not available — compose checks need the daemon")


def _compose_config(*files: Path) -> dict:
    args = ["docker", "compose"]
    for f in files:
        args += ["-f", str(f)]
    args += ["config", "--format", "json"]
    out = subprocess.run(args, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, f"compose config failed: {out.stderr[:300]}"
    return json.loads(out.stdout)


def _published_ports(cfg: dict, service: str) -> list[str]:
    return [str(p.get("published", ""))
            for p in cfg["services"][service].get("ports", [])]


# ------------------------------------------------------------- listener map

def test_default_profile_has_no_plaintext_1883():
    _docker()
    cfg = _compose_config(BASE_COMPOSE)
    ports = _published_ports(cfg, "mosquitto")
    assert "1883" not in ports, \
        f"plaintext MQTT listener published in the default profile: {ports}"
    assert "8883" in ports, f"TLS listener missing from default: {ports}"
    # loopback-only, not 0.0.0.0 — the demo box must not serve the LAN
    for p in cfg["services"]["mosquitto"]["ports"]:
        assert p.get("host_ip", "127.0.0.1").startswith("127."), p


def test_test_overlay_1883_is_loopback_only():
    """Under the overlay 1883 exists by design (doc 20 §3.4) — but it too
    must be loopback-bound, never LAN-reachable."""
    _docker()
    cfg = _compose_config(BASE_COMPOSE, TEST_OVERLAY)
    bindings = [p for p in cfg["services"]["mosquitto"].get("ports", [])
                if str(p.get("published")) == "1883"]
    assert bindings, "overlay did not add the 1883 test listener"
    for p in bindings:
        assert p.get("host_ip", "").startswith("127."), \
            f"test listener bound to non-loopback: {p}"


def test_all_published_ports_loopback_only():
    """Every published port of every service stays on 127.0.0.1."""
    _docker()
    cfg = _compose_config(BASE_COMPOSE)
    for name, svc in cfg["services"].items():
        for p in svc.get("ports", []):
            assert p.get("host_ip", "127.0.0.1").startswith("127."), \
                f"{name}: {p} published on a non-loopback address"


# -------------------------------------------------------- tester identity

def test_tester_identity_is_overlay_only():
    _docker()
    base = _compose_config(BASE_COMPOSE)
    full = _compose_config(BASE_COMPOSE, TEST_OVERLAY)
    assert "tester_pw" not in (base.get("secrets") or {}), \
        "tester secret wired into the default profile"
    assert "tester_pw" in (full.get("secrets") or {}), \
        "tester secret missing under the test overlay"
    be = base["services"]["backend"].get("environment", {})
    assert not any("TESTER" in str(k) for k in
                   (be if isinstance(be, dict) else be)), \
        "TESTER_PW_FILE present in the default backend env"
    be_t = full["services"]["backend"].get("environment", {})
    env_t = be_t if isinstance(be_t, dict) else {
        kv.split("=")[0]: kv.split("=", 1)[1] for kv in be_t}
    assert env_t.get("TESTER_PW_FILE") == "/run/secrets/tester_pw"


# ---------------------------------------------------------- inspect leaks

def _running_containers() -> list[str]:
    out = subprocess.run(
        ["docker", "ps", "--filter", "name=webservice-",
         "--format", "{{.Names}}"],
        capture_output=True, text=True, timeout=30)
    return [n for n in out.stdout.split() if n]


def _secret_values() -> list[tuple[str, str]]:
    vals = []
    sdir = REPO / "infra" / "secrets"
    if sdir.is_dir():
        for f in sorted(sdir.iterdir()):
            v = f.read_text().strip()
            if len(v) >= 6:
                vals.append((f.name, v))
    return vals


def test_no_secret_values_in_docker_inspect():
    """The file-mount contract (v4 T6/T7): every credential rides
    /run/secrets; `docker inspect` (env, cmd, healthcheck) must be clean."""
    _docker()
    containers = _running_containers()
    if not containers:
        pytest.skip("no webservice-* containers running")
    secrets = _secret_values()
    assert secrets, "infra/secrets empty — nothing to check?"
    for name in containers:
        out = subprocess.run(["docker", "inspect", name],
                             capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, name
        blob = out.stdout
        leaks = [s for s, v in secrets if v in blob]
        assert not leaks, f"{name}: secret values in docker inspect: {leaks}"


def test_password_envs_are_file_indirections_only():
    """No env var named *PASSWORD* carries a literal value in the compose
    graph — the *_FILE indirection is the only allowed form (doc 17/T7)."""
    _docker()
    cfg = _compose_config(BASE_COMPOSE)
    for name, svc in cfg["services"].items():
        env = svc.get("environment") or {}
        items = env.items() if isinstance(env, dict) else \
            (kv.split("=", 1) for kv in env if "=" in kv)
        for k, v in items:
            k = str(k)
            if "PASSWORD" in k and not k.endswith("_FILE"):
                assert not v, f"{name}: {k} carries a literal password"
