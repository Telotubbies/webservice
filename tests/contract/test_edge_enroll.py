"""Enrollment codes (spec 5.1): code format/hash (backend, pure) and the
edge-side exchange against a stdlib HTTP server faking the backend."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
import sys
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "edge-bridge"))

from app import enroll_codes  # noqa: E402
from edge_bridge import cfg as edge_cfg  # noqa: E402
from edge_bridge.config import Config  # noqa: E402
from edge_bridge.adapters import IdleAdapter, make_adapter  # noqa: E402
from edge_bridge.cfg import AdapterHolder, CfgClient  # noqa: E402
from edge_bridge.credpush import CredClient  # noqa: E402
from edge_bridge.enroll import (  # noqa: E402
    EnrollError, credential_version, enroll_if_needed, load_identity,
)

IDENT = {"org_id": "o1", "site_id": "s1", "edge_id": "e1", "mqtt_host": "broker.example",
         "mqtt_port": 8883, "ca_pem": "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
         "mqtt_username": "edge-e1-v2", "mqtt_password": "pw", "state_key": "k" * 43}


# -- code format / hashing ----------------------------------------------------

def test_new_code_format():
    for _ in range(50):
        c = enroll_codes.new_code()
        assert len(c) == 9 and c[4] == "-"
        assert set(c.replace("-", "")) <= set(enroll_codes.ALPHABET)


@pytest.mark.parametrize("raw", ["abcd-2345", "ABCD2345", " abcd 2345 ", "AbCd-2345"])
def test_normalize_accepts_hand_typing(raw):
    assert enroll_codes.normalize(raw) == "ABCD2345"


@pytest.mark.parametrize("raw", ["", "ABCD-234", "ABCD-23456", "ABCD-2341", "ABC!-2345"])
def test_normalize_rejects_malformed(raw):
    assert enroll_codes.normalize(raw) is None
    assert enroll_codes.hash_code(raw) is None


def test_hash_is_sha256_of_normalized_without_dash():
    assert enroll_codes.hash_code("abcd-2345") == hashlib.sha256(b"ABCD2345").hexdigest()
    assert enroll_codes.hash_code("abcd-2345") == enroll_codes.hash_code("ABCD2345")


# -- edge side against a fake backend -------------------------------------------

class _Backend:
    def __init__(self, status=200, body=None):
        self.status, self.body, self.hits, self.seen = status, body if body is not None else IDENT, 0, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                outer.hits += 1
                n = int(self.headers.get("Content-Length", 0))
                outer.seen.append((self.path, json.loads(self.rfile.read(n))))
                data = json.dumps(outer.body).encode()
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


@pytest.fixture()
def backend():
    made = []

    def make(**kw):
        b = _Backend(**kw)
        made.append(b)
        return b
    yield make
    for b in made:
        b.close()


def test_enroll_writes_identity_0600(tmp_path, backend):
    b = backend()
    ident = enroll_if_needed(str(tmp_path), {"WDS_URL": b.url + "/", "ENROLL_CODE": "ABCD-2345", "WDS_INSECURE_TLS": "1"})
    assert b.seen == [("/api/v1/edge/enroll", {"code": "ABCD-2345"})]
    assert ident["edge_id"] == "e1"
    p = tmp_path / "identity.json"
    assert json.loads(p.read_text())["mqtt_password"] == "pw"
    assert (tmp_path / "ca.pem").read_text() == IDENT["ca_pem"]
    if os.name != "nt":
        assert stat.S_IMODE(p.stat().st_mode) == 0o600
        assert stat.S_IMODE((tmp_path / "ca.pem").stat().st_mode) == 0o600


def test_existing_identity_never_enrolls_again(tmp_path, backend):
    b = backend()
    env = {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345", "WDS_INSECURE_TLS": "1"}
    enroll_if_needed(str(tmp_path), env)
    again = enroll_if_needed(str(tmp_path), env)
    assert b.hits == 1 and again["edge_id"] == "e1"


def test_no_env_means_no_enroll(tmp_path):
    assert enroll_if_needed(str(tmp_path), {}) is None
    assert enroll_if_needed(str(tmp_path), {"WDS_URL": "http://x"}) is None
    assert load_identity(str(tmp_path)) is None


@pytest.mark.parametrize("status", [404, 410, 429, 503])
def test_enroll_failure_raises_and_writes_nothing(tmp_path, backend, status):
    b = backend(status=status, body={"detail": "x"})
    with pytest.raises(EnrollError):
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345", "WDS_INSECURE_TLS": "1"})
    assert not (tmp_path / "identity.json").exists()


def test_incomplete_response_rejected(tmp_path, backend):
    b = backend(body={"edge_id": "e1"})
    with pytest.raises(EnrollError):
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345", "WDS_INSECURE_TLS": "1"})
    assert not (tmp_path / "identity.json").exists()


def test_unreachable_backend_raises(tmp_path):
    with pytest.raises(EnrollError):
        enroll_if_needed(str(tmp_path), {"WDS_URL": "http://127.0.0.1:1", "ENROLL_CODE": "ABCD-2345", "WDS_INSECURE_TLS": "1"},
                         timeout=1.0)


def test_config_prefers_identity_over_env(monkeypatch):
    monkeypatch.setenv("ORG_ID", "envorg")
    monkeypatch.setenv("MQTT_USER", "envuser")
    monkeypatch.setenv("MQTT_HOST", "envhost")
    c = Config.from_env({**IDENT, "mqtt_ca_file": "/s/ca.pem"})
    assert (c.org_id, c.site_id, c.edge_id) == ("o1", "s1", "e1")
    assert (c.mqtt_host, c.mqtt_port, c.mqtt_ca_file) == ("broker.example", 8883, "/s/ca.pem")
    assert c.credentials() == ("edge-e1-v2", "pw")
    assert c.state_key == IDENT["state_key"]
    assert Config.from_env().org_id == "envorg"


# -- cfg cache sealing ------------------------------------------------------------

KEY = base64.urlsafe_b64encode(bytes(range(32))).decode()


def test_seal_roundtrip_and_ciphertext_hides_plaintext():
    blob = edge_cfg._seal(b'{"secret":"hunter2"}', KEY)
    assert b"hunter2" not in blob
    assert edge_cfg._unseal(blob, KEY) == b'{"secret":"hunter2"}'


def test_seal_without_key_is_identity_and_plaintext_cache_still_reads():
    assert edge_cfg._seal(b"abc") == b"abc"
    assert edge_cfg._unseal(b"abc", KEY) == b"abc"


def test_sealed_cache_without_key_or_wrong_key_fails():
    blob = edge_cfg._seal(b"abc", KEY)
    with pytest.raises(ValueError):
        edge_cfg._unseal(blob, None)
    other = base64.urlsafe_b64encode(bytes(32)).decode()
    with pytest.raises(Exception):  # noqa: B017 - cryptography InvalidTag
        edge_cfg._unseal(blob, other)


# -- plain-http WDS_URL is refused unless explicitly overridden ----------------------

def test_plain_http_refused_without_override(tmp_path, backend):
    b = backend()
    with pytest.raises(EnrollError, match="https"):
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345"})
    assert b.hits == 0  # the code never left the box
    assert not (tmp_path / "identity.json").exists()


def test_plain_http_override_warns_loudly(tmp_path, backend, caplog):
    b = backend()
    with caplog.at_level("WARNING", logger="edge_bridge.enroll"):
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345",
                                         "WDS_INSECURE_TLS": "1"})
    assert any("CLEARTEXT" in r.message for r in caplog.records)
    assert b.hits == 1


# -- in-band credential rotation (cred topic) ---------------------------------------

def _enrolled(tmp_path, backend):
    b = backend(body={**IDENT, "mqtt_username": "edge-e1-v1"})
    ident = enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345",
                                             "WDS_INSECURE_TLS": "1"})
    return replace(Config.from_env(ident), state_dir=str(tmp_path),
                   identity_file=str(tmp_path / "identity.json"))


def cred_msg(version=2, user="edge-e1-v2", pw="new-pw", retain=False, raw=None):
    payload = raw if raw is not None else json.dumps(
        {"version": version, "username": user, "password": pw}).encode()
    return SimpleNamespace(topic="v2/o1/s1/e1/cred", retain=retain, payload=payload)


def test_cred_topic_and_version_parse(tmp_path, backend):
    cfg = _enrolled(tmp_path, backend)
    assert cfg.cred_topic == "v2/o1/s1/e1/cred"
    assert credential_version(load_identity(str(tmp_path))) == 1


def test_newer_cred_rewrites_identity_and_reconnects(tmp_path, backend):
    cfg = _enrolled(tmp_path, backend)
    calls = []
    cl = CredClient(cfg, lambda: calls.append(1))
    assert cl.handle(cred_msg()) is True
    assert calls == [1]
    ident = load_identity(str(tmp_path))
    assert (ident["mqtt_username"], ident["mqtt_password"], ident["cred_version"]) == ("edge-e1-v2", "new-pw", 2)
    assert ident["state_key"] == IDENT["state_key"]  # rest of identity preserved
    assert cfg.credentials() == ("edge-e1-v2", "new-pw")  # next connect uses it
    if os.name != "nt":
        assert stat.S_IMODE((tmp_path / "identity.json").stat().st_mode) == 0o600


@pytest.mark.parametrize("m", [
    cred_msg(version=1), cred_msg(version=0), cred_msg(retain=True),
    cred_msg(raw=b"not json"), cred_msg(raw=b'{"version":"3","username":"u","password":"p"}'),
    cred_msg(raw=b'{"version":3,"username":"","password":"p"}'),
    cred_msg(raw=b'{"version":true,"username":"u","password":"p"}'),
    cred_msg(raw=b"[]"),
])
def test_stale_retained_malformed_cred_ignored(tmp_path, backend, m):
    cfg = _enrolled(tmp_path, backend)
    calls = []
    assert CredClient(cfg, lambda: calls.append(1)).handle(m) is False
    assert calls == []
    assert load_identity(str(tmp_path))["mqtt_password"] == "pw"


def test_equal_version_cred_not_applied_twice(tmp_path, backend):
    cfg = _enrolled(tmp_path, backend)
    cl = CredClient(cfg, lambda: None)
    assert cl.handle(cred_msg()) is True
    assert cl.handle(cred_msg()) is False


# -- enrolled gateways are idle, not simulated ----------------------------------------

def _holder_cfg(tmp_path, enrolled):
    cfg = Config(org_id="o", site_id="s", edge_id="e", state_dir=str(tmp_path),
                 identity_file=str(tmp_path / "identity.json") if enrolled else None)
    holder = AdapterHolder(IdleAdapter() if enrolled else make_adapter("sim", "plant1", {}), 1000)
    sent = []
    bridge = SimpleNamespace(publish_json=lambda t, p, qos=1: sent.append((t, p)) or True,
                             subscribe=lambda *a, **k: None)
    return cfg, holder, sent, CfgClient(cfg, holder, bridge, "plant1")


def _v(n):
    return SimpleNamespace(topic="t", retain=False,
                           payload=json.dumps({"version": n, "sources": []}).encode())


def test_idle_adapter_publishes_nothing():
    a = IdleAdapter()
    assert a.name == "idle" and a.read_all() == [] and a.tag_map() == {}


def test_enrolled_edge_accepts_version_zero(tmp_path):
    cfg, holder, sent, cl = _holder_cfg(tmp_path, enrolled=True)
    assert cfg.enrolled and holder.get().name == "idle"
    cl.handle(_v(0))
    assert cl.version == 0
    assert sent and sent[-1][1]["version"] == 0 and sent[-1][1]["ok"] is True
    assert holder.get().name == "multi"


def test_env_bootstrap_edge_still_ignores_version_zero(tmp_path):
    cfg, holder, sent, cl = _holder_cfg(tmp_path, enrolled=False)
    before = holder.get()
    cl.handle(_v(0))
    assert holder.get() is before and sent == []
