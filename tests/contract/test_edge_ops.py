"""Edge test_source / browse ops + their command-channel wiring."""

from __future__ import annotations

import json
import socket
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

pytest.importorskip("asyncua")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from asyncua import ua  # noqa: E402
from asyncua.sync import Server  # noqa: E402

from edge_bridge import ops  # noqa: E402
from edge_bridge.commands import CommandHandler  # noqa: E402
from edge_bridge.config import Config  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def opc():
    port = _free_port()
    srv = Server()
    srv.set_endpoint(f"opc.tcp://127.0.0.1:{port}")
    idx = srv.register_namespace("urn:wds:ops")
    obj = srv.nodes.objects.add_object(idx, "Dev")
    v = obj.add_variable(idx, "Speed", 3.5, ua.VariantType.Double)
    srv.start()
    try:
        yield {"endpoint": f"opc.tcp://127.0.0.1:{port}", "node": v.nodeid.to_string()}
    finally:
        srv.stop()


def _opcua_src(endpoint, node="ns=2;s=x", **conn):
    return {"id": "d", "protocol": "opcua",
            "connection": {"endpoint": endpoint, "security": "none",
                           "auth": "anonymous", **conn},
            "secrets": None,
            "tags": [{"id": "t", "path": "a/speed", "type": "float",
                      "address": {"node_id": node}}]}


def test_test_source_unreachable_detail():
    src = _opcua_src(f"opc.tcp://127.0.0.1:{_free_port()}", timeout_ms=500)
    res = ops.run("test_source", {"source": src})
    assert res["ok"] is False and res["sample"][0]["q"] == "bad"
    assert res["detail"].startswith("connect_failed:")
    assert any(n in res["detail"] for n in ("TimeoutError", "ConnectionRefused", "OSError"))


def test_test_source_ok_returns_sample(opc):
    res = ops.run("test_source", {"source": _opcua_src(opc["endpoint"], opc["node"])})
    assert res["ok"] is True
    assert res["sample"] == [{"path": "a/speed", "v": 3.5, "q": "good"}]


def test_test_source_sim_ok_and_capped():
    tags = [{"id": str(i), "path": f"l/d/s{i}", "type": "float",
             "address": {"behavior": "random_walk", "initial": 1.0}} for i in range(8)]
    res = ops.run("test_source", {"source": {"id": "x", "protocol": "sim",
                                             "connection": {}, "tags": tags}})
    assert res["ok"] is True and len(res["sample"]) == 5


def test_test_source_invalid_source_is_not_ok():
    res = ops.run("test_source", {"source": {"protocol": "nope", "tags": []}})
    assert res["ok"] is False and res["detail"].startswith("invalid_source")


def test_opcua_connectivity_only_without_tags(opc):
    src = _opcua_src(opc["endpoint"])
    src["tags"] = []
    assert ops.run("test_source", {"source": src})["ok"] is True


def test_browse_op(opc):
    items = ops.run("browse", {"source": _opcua_src(opc["endpoint"]), "node_id": None})["items"]
    assert "Dev" in {i["name"] for i in items}
    with pytest.raises(ops.OpError):
        ops.run("browse", {"source": {"protocol": "sim", "connection": {}}})


# -- command channel ---------------------------------------------------------

class _Bridge:
    def __init__(self):
        self.out: list[tuple[str, dict]] = []
        self.evt = threading.Event()

    def publish_json(self, topic, payload):
        self.out.append((topic, payload))
        self.evt.set()


def _handler():
    cfg = Config(org_id="o", site_id="s", edge_id="e")
    clock = SimpleNamespace(clock_ok=True, now=lambda: __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc))
    holder = SimpleNamespace(get=lambda: pytest.fail("ops must not touch the live holder"))
    br = _Bridge()
    return CommandHandler(cfg, holder, clock, br), br


def _msg(cid, body):
    return SimpleNamespace(topic=f"v2/o/s/e/cmd/{cid}", retain=False,
                           payload=json.dumps(body).encode())


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def test_command_channel_runs_op_and_responds(opc):
    h, br = _handler()
    h.handle_message(_msg("c1", {"command_id": "c1", "op": "test_source",
                                 "issued_at": _now_iso(), "ttl_s": 10,
                                 "source": _opcua_src(opc["endpoint"], opc["node"])}))
    assert br.evt.wait(10)
    topic, resp = br.out[0]
    assert topic.endswith("/cmd-resp/c1")
    assert resp["command_id"] == "c1" and resp["status"] == "acknowledged"
    assert resp["result"]["ok"] is True


def test_command_channel_op_errors_and_unknown_op():
    h, br = _handler()
    h.handle_message(_msg("c2", {"command_id": "c2", "op": "browse",
                                 "issued_at": _now_iso(), "ttl_s": 10,
                                 "source": {"protocol": "sim"}}))
    assert br.evt.wait(10)
    assert br.out[0][1]["status"] == "failed"
    h2, br2 = _handler()
    h2.handle_message(_msg("c3", {"command_id": "c3", "op": "rm_rf",
                                  "issued_at": _now_iso()}))
    assert br2.out[0][1]["status"] == "failed" and br2.out[0][1]["reason"] == "unknown_op"


def test_user_auth_without_encryption_never_connects(opc):
    src = _opcua_src(opc["endpoint"], opc["node"], auth="user")
    src["secrets"] = {"username": "u", "password": "p"}
    res = ops.run("test_source", {"source": src})
    assert res["ok"] is False and res["detail"] == "user_auth_requires_encryption"


def test_missing_endpoint_is_bad_not_crash():
    src = _opcua_src("x")
    src["connection"].pop("endpoint")
    res = ops.run("test_source", {"source": src})
    assert res["ok"] is False and res["detail"] == "missing_endpoint"


def test_browse_batched_attributes(opc):
    items = ops.run("browse", {"source": _opcua_src(opc["endpoint"]),
                               "node_id": None})["items"]
    dev = next(i for i in items if i["name"] == "Dev")
    kids = ops.run("browse", {"source": _opcua_src(opc["endpoint"]),
                              "node_id": dev["node_id"]})["items"]
    assert kids == [{"node_id": opc["node"], "name": "Speed", "node_class": "Variable",
                     "data_type": "Double", "writable": False}]


def test_op_deadline_expired_raises_timeout(opc):
    with pytest.raises(ops.OpError, match="timeout"):
        ops.run("test_source", {"source": _opcua_src(opc["endpoint"], opc["node"])},
                deadline_s=-1)
    with pytest.raises(ops.OpError, match="timeout"):
        ops.run("browse", {"source": _opcua_src(opc["endpoint"])}, deadline_s=-1)


def test_op_deadline_closes_adapter_and_replies_timeout(monkeypatch):
    closed = []

    class Slow:
        deadline = None

        def tag_map(self):
            return {"t": {}}

        def read_all(self):
            time.sleep(0.3)
            return []

        def close(self):
            closed.append(1)

    monkeypatch.setattr(ops, "make_source_adapter", lambda s, site: Slow())
    with pytest.raises(ops.OpError, match="timeout"):
        ops.run("test_source", {"source": {"protocol": "sim"}}, deadline_s=0.05)
    assert closed == [1]


def test_command_channel_deadline_reply(monkeypatch):
    def boom(op, payload):
        raise ops.OpError("timeout")

    monkeypatch.setattr(ops, "run", boom)
    h, br = _handler()
    h.handle_message(_msg("c4", {"command_id": "c4", "op": "browse",
                                 "issued_at": _now_iso(), "ttl_s": 10, "source": {}}))
    assert br.evt.wait(10)
    resp = br.out[0][1]
    assert resp["status"] == "failed" and resp["reason"] == "timeout"
    assert resp["result"] == {"ok": False, "detail": "timeout"}


def test_command_channel_busy_cap(monkeypatch):
    gate = threading.Event()
    started = threading.Semaphore(0)

    def blocked(op, payload):
        started.release()
        gate.wait(10)
        return {"items": []}

    monkeypatch.setattr(ops, "run", blocked)
    h, br = _handler()
    for i in range(7):
        h.handle_message(_msg(f"b{i}", {"command_id": f"b{i}", "op": "browse",
                                        "issued_at": _now_iso(), "ttl_s": 10, "source": {}}))
    # 2 workers running + 2 queued = 4 in flight; the other 3 are refused at once
    assert started.acquire(timeout=5) and started.acquire(timeout=5)
    busy = [r for _, r in br.out]
    assert len(busy) == 3
    assert all(r["status"] == "failed" and r["reason"] == "busy"
               and r["result"] == {"ok": False, "detail": "busy"} for r in busy)
    gate.set()
    deadline = time.time() + 10
    while len(br.out) < 7 and time.time() < deadline:
        time.sleep(0.05)
    assert len(br.out) == 7
    assert sum(1 for _, r in br.out if r["status"] == "acknowledged") == 4
    assert h._op_inflight == 0
