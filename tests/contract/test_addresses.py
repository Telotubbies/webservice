"""PLC address / connection validation (pure)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.datasources.addresses import (  # noqa: E402
    AddressError,
    parse_address,
    validate_connection,
)


def mb(area, index, dt):
    return {"area": area, "index": index, "datatype": dt, "word_order": "big"}


@pytest.mark.parametrize("raw,tag_type,expected", [
    ("%QX0.0", "bool", mb("coil", 0, "bool")),
    ("%IX1.2", "bool", mb("discrete_input", 10, "bool")),
    ("%QW2", "float", mb("holding_register", 2, "uint16")),
    ("%IW4", "float", mb("input_register", 4, "uint16")),
    ("40001", "float", mb("holding_register", 0, "uint16")),
    ("30005", "float", mb("input_register", 4, "uint16")),
    ("10003", "bool", mb("discrete_input", 2, "bool")),
    ("00017", "bool", mb("coil", 16, "bool")),
    ("17", "bool", mb("coil", 16, "bool")),
    ({"area": "holding_register", "index": 5, "datatype": "float32",
      "word_order": "little"}, "float",
     mb("holding_register", 5, "float32") | {"word_order": "little"}),
    ({"area": "coil", "index": 3}, "bool", mb("coil", 3, "bool")),
])
def test_modbus_ok(raw, tag_type, expected):
    assert parse_address("modbus", raw, tag_type) == expected


@pytest.mark.parametrize("raw,tag_type,field", [
    ("%IW4", "bool", "address"),
    ("%QX0.0", "float", "address"),
    ("%QX0.9", "bool", "address"),
    ("garbage", "float", "address"),
    ("17", "float", "address"),
    ({"area": "coil", "index": -1}, "bool", "address.index"),
    ({"area": "nope", "index": 1}, "float", "address.area"),
    ({"area": "holding_register", "index": 1, "bogus": 1}, "float", "address.bogus"),
    ({"area": "holding_register", "index": 1, "datatype": "bool"}, "float", "address.datatype"),
    ({"area": "holding_register", "index": 1, "word_order": "mid"}, "float", "address.word_order"),
])
def test_modbus_rejected(raw, tag_type, field):
    with pytest.raises(AddressError) as e:
        parse_address("modbus", raw, tag_type)
    assert e.value.field == field


@pytest.mark.parametrize("raw,tag_type,expected", [
    ("DB1.DBX0.3", "bool", {"area": "DB", "db": 1, "byte": 0, "bit": 3, "datatype": "bool"}),
    ("DB1.DBW2", "int", {"area": "DB", "db": 1, "byte": 2, "datatype": "int"}),
    ("DB1.DBD4", "float", {"area": "DB", "db": 1, "byte": 4, "datatype": "real"}),
    ("DB1.DBD4:dint", "int", {"area": "DB", "db": 1, "byte": 4, "datatype": "dint"}),
    ("M0.1", "bool", {"area": "M", "byte": 0, "bit": 1, "datatype": "bool"}),
    ("MW10", "int", {"area": "M", "byte": 10, "datatype": "int"}),
    ("MD20", "float", {"area": "M", "byte": 20, "datatype": "real"}),
    ("I0.0", "bool", {"area": "I", "byte": 0, "bit": 0, "datatype": "bool"}),
    ("Q0.1", "bool", {"area": "Q", "byte": 0, "bit": 1, "datatype": "bool"}),
    ("IW64", "int", {"area": "I", "byte": 64, "datatype": "int"}),
    ("MW10:word", "int", {"area": "M", "byte": 10, "datatype": "word"}),
    ({"area": "DB", "db": 2, "byte": 1, "bit": 7, "datatype": "bool"}, "bool",
     {"area": "DB", "db": 2, "byte": 1, "bit": 7, "datatype": "bool"}),
])
def test_s7_ok(raw, tag_type, expected):
    assert parse_address("s7", raw, tag_type) == expected


@pytest.mark.parametrize("raw,tag_type,field", [
    ("DB1.DBX0.8", "bool", "address"),
    ("DB1.DBX0", "bool", "address"),
    ("DB1.DBW2.1", "int", "address"),
    ("MW", "int", "address"),
    ("DB1.DBX0.3", "float", "address"),
    ("MW10", "bool", "address"),
    ("M0.1:dint", "bool", "address"),
    ({"area": "M", "db": 1, "byte": 0, "datatype": "int"}, "int", "address.db"),
    ({"area": "DB", "byte": 0, "datatype": "int"}, "int", "address.db"),
    ({"area": "M", "byte": 0, "datatype": "int", "bit": 1}, "int", "address.bit"),
    ({"area": "M", "byte": 0, "datatype": "bool"}, "bool", "address.bit"),
    ({"area": "X", "byte": 0, "datatype": "int"}, "int", "address.area"),
])
def test_s7_rejected(raw, tag_type, field):
    with pytest.raises(AddressError) as e:
        parse_address("s7", raw, tag_type)
    assert e.value.field == field


@pytest.mark.parametrize("raw", [
    "ns=3;s=Motor1.Speed", "ns=0;i=2258", "ns=2;g=09087e75-8e5e-499b-954f-f2a9603db28a",
    "ns=1;b=M/RbKBsRVkePCePcx24oRQ==",
])
def test_opcua_ok(raw):
    assert parse_address("opcua", raw, "float") == {"node_id": raw}
    assert parse_address("opcua", {"node_id": raw}, "float") == {"node_id": raw}


@pytest.mark.parametrize("raw", ["ns=x;s=a", "s=Motor", "ns=3;x=1", "ns=3;s=", "ns=3;i=abc", ""])
def test_opcua_rejected(raw):
    with pytest.raises(AddressError) as e:
        parse_address("opcua", raw, "float")
    assert e.value.field == "address"


def test_sim():
    assert parse_address("sim", {"behavior": "sine"}, "float") == {"behavior": "sine"}
    assert parse_address("sim", {"behavior": "sine", "initial": 1}, "float") \
        == {"behavior": "sine", "initial": 1}
    with pytest.raises(AddressError) as e:
        parse_address("sim", {}, "float")
    assert e.value.field == "address.behavior"


def test_unknown_protocol():
    with pytest.raises(AddressError) as e:
        parse_address("profibus", "1", "bool")
    assert e.value.field == "protocol"


def test_connection_defaults():
    assert validate_connection("modbus", {"host": "10.0.0.5"}) == {
        "host": "10.0.0.5", "port": 502, "unit_id": 1, "timeout_ms": 2000}
    assert validate_connection("s7", {"host": "h"}) == {
        "host": "h", "rack": 0, "slot": 1, "timeout_ms": 2000}
    assert validate_connection("opcua", {"endpoint": "opc.tcp://h:4840"}) == {
        "endpoint": "opc.tcp://h:4840", "security": "none", "auth": "anonymous"}
    assert validate_connection("sim", {}) == {}


@pytest.mark.parametrize("proto,conn,field", [
    ("modbus", {}, "connection.host"),
    ("modbus", {"host": "h", "port": "502"}, "connection.port"),
    ("modbus", {"host": "h", "port": 70000}, "connection.port"),
    ("modbus", {"host": "h", "port": True}, "connection.port"),
    ("modbus", {"host": "h", "extra": 1}, "connection.extra"),
    ("s7", {"host": "h", "slot": -1}, "connection.slot"),
    ("opcua", {"endpoint": "http://x"}, "connection.endpoint"),
    ("opcua", {"endpoint": "opc.tcp://h", "security": "weird"}, "connection.security"),
    ("opcua", {"endpoint": "opc.tcp://h", "password": "x"}, "connection.password"),
    ("sim", {"host": "h"}, "connection.host"),
    ("nope", {}, "protocol"),
])
def test_connection_rejected(proto, conn, field):
    with pytest.raises(AddressError) as e:
        validate_connection(proto, conn)
    assert e.value.field == field


# -- cross-component contract: normalized output must resolve on the edge --

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))
from edge_bridge.adapters.modbus import _resolve  # noqa: E402


@pytest.mark.parametrize("raw,tag_type", [
    ("%QX0.0", "bool"), ("%IX1.2", "bool"), ("%QW2", "float"), ("%IW4", "float"),
    ("40001", "float"), ("30005", "float"), ("10003", "bool"), ("17", "bool"),
    ({"area": "holding_register", "index": 5, "datatype": "float32",
      "word_order": "little"}, "float"),
    ({"area": "holding_register", "index": 5, "datatype": "int32"}, "float"),
    ({"area": "input_register", "index": 5, "datatype": "int16"}, "float"),
    ({"area": "coil", "index": 3, "datatype": "bool"}, "bool"),
    ({"area": "discrete_input", "index": 3}, "bool"),
])
def test_normalized_modbus_resolves_on_edge(raw, tag_type):
    addr = parse_address("modbus", raw, tag_type)
    r = _resolve({"address": addr})
    assert r["type"] == addr["area"]
    assert r["address"] == addr["index"]
    assert r["datatype"] == addr["datatype"]
    assert r["word_order"] == addr["word_order"]


@pytest.mark.parametrize("addr", [
    {"area": "coil", "index": 1, "datatype": "uint16"},
    {"area": "holding_register", "index": 1, "datatype": "bool"},
])
def test_edge_rejects_mismatched_modbus_datatype(addr):
    with pytest.raises(ValueError):
        _resolve({"address": addr})


def test_opcua_user_auth_requires_encryption():
    with pytest.raises(AddressError) as e:
        validate_connection("opcua", {"endpoint": "opc.tcp://h:4840", "auth": "user"})
    assert e.value.field == "connection.auth"
    ok = validate_connection("opcua", {"endpoint": "opc.tcp://h:4840",
                                       "security": "signencrypt", "auth": "user"})
    assert ok["auth"] == "user"
