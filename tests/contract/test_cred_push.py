"""Backend side of in-band credential rotation: ACLs, topic, publish payload."""

import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app import credpush  # noqa: E402
from app.dynsec import BACKEND_ACLS, edge_acls  # noqa: E402
from app.mqtt_client import cred_topic  # noqa: E402


class FakeMqtt:
    def __init__(self, ok=True):
        self.sent, self.ok = [], ok

    def publish_cred(self, topic, payload):
        self.sent.append((topic, payload))
        return self.ok


def test_edge_acls_allow_only_own_cred_topic():
    o, s, e = uuid4(), uuid4(), uuid4()
    p = f"v2/{o}/{s}/{e}/cred"
    acls = {(a["acltype"], a["topic"]) for a in edge_acls(o, s, e)}
    assert ("subscribePattern", p) in acls and ("publishClientReceive", p) in acls
    # the edge may receive its credential but never publish one
    assert not any(t == "publishClientSend" and tp.endswith("/cred") for t, tp in acls)


def test_backend_may_publish_cred_to_any_edge():
    assert {"acltype": "publishClientSend", "topic": "v2/+/+/+/cred", "allow": True} in BACKEND_ACLS


def test_push_cred_publishes_expected_payload_on_edge_topic():
    o, s, e = uuid4(), uuid4(), uuid4()
    m = FakeMqtt()
    assert credpush.push_cred(m, o, s, e, 3, "edge-x-v3", "pw") is True
    assert m.sent == [(f"v2/{o}/{s}/{e}/cred",
                       {"version": 3, "username": "edge-x-v3", "password": "pw"})]
    assert cred_topic(o, s, e) == f"v2/{o}/{s}/{e}/cred"


def test_push_cred_reports_failure():
    assert credpush.push_cred(FakeMqtt(ok=False), uuid4(), uuid4(), uuid4(), 2, "u", "p") is False
