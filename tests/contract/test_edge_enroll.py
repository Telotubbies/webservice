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
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "edge-bridge"))

from app import enroll_codes  # noqa: E402
from edge_bridge import cfg as edge_cfg  # noqa: E402
from edge_bridge.config import Config  # noqa: E402
from edge_bridge.enroll import EnrollError, enroll_if_needed, load_identity  # noqa: E402

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
    ident = enroll_if_needed(str(tmp_path), {"WDS_URL": b.url + "/", "ENROLL_CODE": "ABCD-2345"})
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
    env = {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345"}
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
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345"})
    assert not (tmp_path / "identity.json").exists()


def test_incomplete_response_rejected(tmp_path, backend):
    b = backend(body={"edge_id": "e1"})
    with pytest.raises(EnrollError):
        enroll_if_needed(str(tmp_path), {"WDS_URL": b.url, "ENROLL_CODE": "ABCD-2345"})
    assert not (tmp_path / "identity.json").exists()


def test_unreachable_backend_raises(tmp_path):
    with pytest.raises(EnrollError):
        enroll_if_needed(str(tmp_path), {"WDS_URL": "http://127.0.0.1:1", "ENROLL_CODE": "ABCD-2345"},
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
