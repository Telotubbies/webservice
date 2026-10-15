"""Siemens S7 adapter against the in-process snap7 server."""

from __future__ import annotations

import ctypes
import socket
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

snap7 = pytest.importorskip("snap7")
try:
    from snap7.server import Server
    from snap7.type import SrvArea
except Exception:  # pragma: no cover
    pytest.skip("snap7 server unavailable", allow_module_level=True)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from edge_bridge.adapters import make_source_adapter  # noqa: E402
from edge_bridge.adapters.base import Quality  # noqa: E402


def NOW():
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def plc():
    db = (ctypes.c_uint8 * 512)()
    mk = (ctypes.c_uint8 * 32)()
    srv = Server()
    srv.register_area(SrvArea.DB, 1, db)
    srv.register_area(SrvArea.MK, 0, mk)
    port = _free_port()
    srv.start(tcp_port=port)
    yield port, db, mk
    srv.stop()
    srv.destroy()


def _tag(path, datatype, area="DB", db=1, byte=0, bit=None, **kw):
    addr = {"area": area, "byte": byte, "datatype": datatype}
    if area == "DB":
        addr["db"] = db
    if bit is not None:
        addr["bit"] = bit
    return {"id": path, "path": path, "type": "bool" if datatype == "bool" else "float",
            "address": addr, "scale": 1.0, "offset": 0.0, "writable": False,
            "min": None, "max": None, **kw}


def _adapter(port, tags):
    src = {"id": "s", "protocol": "s7", "poll_ms": 1000, "enabled": True,
           "connection": {"host": "127.0.0.1", "rack": 0, "slot": 1,
                          "timeout_ms": 500, "port": port},
           "secrets": {}, "tags": tags}
    return make_source_adapter(src, "plant", now=NOW)


def _by_name(vals):
    return {v.name: v for v in vals}


def test_read_real_from_db(plc):
    port, db, _ = plc
    db[4:8] = struct.pack(">f", 12.5)
    db[10:12] = struct.pack(">h", -7)
    db[12:16] = struct.pack(">i", 100000)
    db[20:22] = struct.pack(">H", 65000)
    a = _adapter(port, [
        _tag("a/r", "real", byte=4, scale=2.0, offset=1.0),
        _tag("a/i", "int", byte=10), _tag("a/d", "dint", byte=12),
        _tag("a/w", "word", byte=20)])
    try:
        v = _by_name(a.read_all())
        assert v["plant.a.r"].v == 26.0 and v["plant.a.r"].q == Quality.GOOD
        assert v["plant.a.i"].v == -7
        assert v["plant.a.d"].v == 100000
        assert v["plant.a.w"].v == 65000
    finally:
        a.close()


def test_read_bit_m(plc):
    port, _, mk = plc
    mk[2] = 0b00000100
    a = _adapter(port, [_tag("m/on", "bool", area="M", byte=2, bit=2),
                        _tag("m/off", "bool", area="M", byte=2, bit=3)])
    try:
        v = _by_name(a.read_all())
        assert v["plant.m.on"].v is True and v["plant.m.off"].v is False
    finally:
        a.close()


def test_write_bit_preserves_neighbours(plc):
    port, _, mk = plc
    mk[1] = 0b10100001
    a = _adapter(port, [_tag("m/b", "bool", area="M", byte=1, bit=1, writable=True)])
    try:
        assert a.write("plant.m.b", True).ok
        assert mk[1] == 0b10100011
        assert a.write("plant.m.b", False).ok
        assert mk[1] == 0b10100001
    finally:
        a.close()


def test_write_numeric_inverts_scale(plc):
    port, db, _ = plc
    a = _adapter(port, [_tag("a/r", "real", byte=4, scale=2.0, offset=1.0,
                             writable=True),
                        _tag("a/i", "int", byte=10, writable=True)])
    try:
        assert a.write("plant.a.r", 11.0).ok
        assert struct.unpack(">f", bytes(db[4:8]))[0] == 5.0
        assert a.write("plant.a.i", -3).ok
        assert struct.unpack(">h", bytes(db[10:12]))[0] == -3
    finally:
        a.close()


def test_unreachable_gives_bad():
    a = _adapter(_free_port(), [_tag("a/r", "real", byte=4, writable=True)])
    try:
        v = a.read_all()
        assert [x.q for x in v] == [Quality.BAD]
        assert a.write("plant.a.r", 1.0).detail == "adapter_unavailable"
    finally:
        a.close()


def test_out_of_range_denied(plc):
    port, db, _ = plc
    a = _adapter(port, [_tag("a/r", "real", byte=4, writable=True, min=0, max=10)])
    try:
        assert a.write("plant.a.r", 11).detail == "out_of_range"
        assert a.write("plant.a.nope", 1).detail == "not_writable"
        assert bytes(db[4:8]) == b"\x00" * 4
    finally:
        a.close()


def test_not_writable_and_no_reconnect_after_close(plc):
    port, _, _ = plc
    a = _adapter(port, [_tag("a/r", "real", byte=4)])
    assert a.write("plant.a.r", 1).detail == "not_writable"
    a.close()
    assert [x.q for x in a.read_all()] == [Quality.BAD]


def test_batches_one_read_per_span(plc):
    port, _, _ = plc
    a = _adapter(port, [_tag("a/1", "real", byte=0), _tag("a/2", "real", byte=100),
                        _tag("a/3", "real", byte=400)])
    calls = []
    try:
        a.read_all()
        real = a._client.read_area
        a._client.read_area = lambda *x: (calls.append(x), real(*x))[1]
        a.read_all()
        assert [(c[1], c[2], c[3]) for c in calls] == [(1, 0, 104), (1, 400, 4)]
    finally:
        a.close()
