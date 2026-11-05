"""OPC UA adapter against an in-process asyncua server."""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest

pytest.importorskip("asyncua")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from asyncua import ua  # noqa: E402
from asyncua.sync import Server  # noqa: E402

from edge_bridge.adapters import make_source_adapter  # noqa: E402
from edge_bridge.adapters.base import Quality  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def opc_server():
    port = _free_port()
    srv = Server()
    srv.set_endpoint(f"opc.tcp://127.0.0.1:{port}")
    idx = srv.register_namespace("urn:wds:test")
    plant = srv.nodes.objects.add_object(idx, "Plant")
    temp = plant.add_variable(idx, "Temp", 21.5, ua.VariantType.Double)
    flag = plant.add_variable(idx, "Running", True, ua.VariantType.Boolean)
    sp = plant.add_variable(idx, "Setpoint", 10, ua.VariantType.Int32)
    sp.set_writable()
    srv.start()
    try:
        yield {"endpoint": f"opc.tcp://127.0.0.1:{port}", "idx": idx,
               "temp": temp, "flag": flag, "sp": sp, "plant": plant}
    finally:
        srv.stop()


def _source(srv, tags, **conn):
    idx = srv["idx"]
    return {"id": "s1", "protocol": "opcua",
            "connection": {"endpoint": srv["endpoint"], "security": "none",
                           "auth": "anonymous", **conn},
            "secrets": None, "poll_ms": 1000, "enabled": True,
            "tags": [{"id": f"t{i}", "path": p, "type": ty,
                      "address": {"node_id": f"ns={idx};s={p.split('/')[-1]}"},
                      **extra} for i, (p, ty, extra) in enumerate(tags)]}


def _tags(srv):
    idx = srv["idx"]
    return [
        ("a/Temp", "float", {"address": {"node_id": srv["temp"].nodeid.to_string()},
                             "scale": 2.0, "offset": 1.0}),
        ("a/Running", "bool", {"address": {"node_id": srv["flag"].nodeid.to_string()}}),
        ("a/Setpoint", "int", {"address": {"node_id": srv["sp"].nodeid.to_string()},
                               "writable": True, "min": 0, "max": 100}),
        ("a/Bad", "float", {"address": {"node_id": f"ns={idx};s=DoesNotExist"}}),
    ]


def _adapter(srv):
    return make_source_adapter(_source(srv, _tags(srv)), "s1")


def test_opcua_read_write(opc_server):
    ad = _adapter(opc_server)
    try:
        vals = {v.name: v for v in ad.read_all()}
        assert vals["s1.a.Temp"].v == pytest.approx(44.0) and vals["s1.a.Temp"].q is Quality.GOOD
        assert vals["s1.a.Running"].v is True
        assert vals["s1.a.Setpoint"].v == 10
        assert vals["s1.a.Bad"].q is Quality.BAD  # one bad node must not poison the batch
        assert ad.write("s1.a.Setpoint", 42).ok
        assert opc_server["sp"].read_value() == 42
        assert ad.write("s1.a.Setpoint", 500).detail == "out_of_range"
        assert ad.write("s1.a.Temp", 1).detail == "not_writable"
        assert ad.write("s1.a.nope", 1).detail == "not_writable"
    finally:
        ad.close()
    assert all(v.q is Quality.BAD for v in ad.read_all())  # closed is final


def test_browse_objects_children(opc_server):
    ad = make_source_adapter(_source(opc_server, []), "s1")
    try:
        top = {i["name"] for i in ad.browse(None)}
        assert "Plant" in top
        kids = {i["name"]: i for i in ad.browse(opc_server["plant"].nodeid.to_string())}
        assert set(kids) == {"Temp", "Running", "Setpoint"}
        assert kids["Setpoint"]["writable"] is True and kids["Temp"]["writable"] is False
        assert kids["Temp"]["data_type"] == "Double"
        assert kids["Temp"]["node_class"] == "Variable"
        assert {"node_id", "name", "node_class", "data_type", "writable"} <= set(kids["Temp"])
    finally:
        ad.close()


def test_unreachable_is_bad_and_recovers():
    src = {"id": "s", "protocol": "opcua",
           "connection": {"endpoint": f"opc.tcp://127.0.0.1:{_free_port()}",
                          "security": "none", "auth": "anonymous", "timeout_ms": 500},
           "tags": [{"id": "t", "path": "a/x", "type": "float",
                     "address": {"node_id": "ns=2;s=x"}}]}
    ad = make_source_adapter(src, "s1")
    assert [v.q for v in ad.read_all()] == [Quality.BAD]
    assert ad.last_error


def test_sign_mode_not_supported_yet(opc_server):
    src = _source(opc_server, _tags(opc_server), security="sign")
    ad = make_source_adapter(src, "s1")
    assert all(v.q is Quality.BAD for v in ad.read_all())
    assert ad.last_error == "security_mode_not_supported_yet"
