"""Edge adapter factory: per-source config, Modbus codecs, MultiAdapter."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "edge-bridge"))

from edge_bridge.adapters import make_adapter, make_source_adapter  # noqa: E402
from edge_bridge.adapters.base import Quality, TagAdapter, TagValue, WriteResult  # noqa: E402
from edge_bridge.adapters.modbus import ModbusAdapter  # noqa: E402
from edge_bridge.adapters.multi import MultiAdapter  # noqa: E402


class FakeClient:
    connected = True

    def __init__(self, regs: dict[int, list[int]] | None = None):
        self.regs = regs or {}
        self.reads: list[tuple[int, int]] = []
        self.writes: list[tuple[int, list[int]]] = []

    def connect(self):
        return True

    def read_holding_registers(self, address, count=1, slave=1):
        self.reads.append((address, count))
        return SimpleNamespace(isError=lambda: False,
                               registers=self.regs[address][:count])

    def write_register(self, address, value, slave=1):
        self.writes.append((address, [value]))
        return SimpleNamespace(isError=lambda: False)

    def write_registers(self, address, values, slave=1):
        self.writes.append((address, list(values)))
        return SimpleNamespace(isError=lambda: False)


def _modbus(tags: dict, client: FakeClient) -> ModbusAdapter:
    ad = ModbusAdapter("s1", {"tags": tags})
    ad._client = client
    return ad


def test_make_adapter_modbus_env_does_not_crash(monkeypatch):
    monkeypatch.setenv("MODBUS_HOST", "10.1.2.3")
    monkeypatch.setenv("MODBUS_PORT", "1502")
    ad = make_adapter("modbus", "s1", {"modbus": {"tags": {}}})
    assert ad._cfg["host"] == "10.1.2.3" and ad._cfg["port"] == 1502


def test_modbus_address_dict_and_legacy_equivalent():
    client = FakeClient({2: [77]})
    legacy = _modbus({"a": {"type": "holding_register", "address": "%QW2"}}, client)
    new = _modbus({"a": {"type": "holding_register", "address": {
        "area": "holding_register", "index": 2, "datatype": "uint16"}}}, client)
    assert legacy.read_all()[0].v == new.read_all()[0].v == 77
    assert client.reads == [(2, 1), (2, 1)]


def test_scale_offset_applied_and_inverted_on_write():
    client = FakeClient({0: [100]})
    ad = _modbus({"t": {"type": "holding_register", "scale": 0.5, "offset": 10,
                        "writable": True,
                        "address": {"area": "holding_register", "index": 0,
                                    "datatype": "int16"}}}, client)
    assert ad.read_all()[0].v == 60.0
    assert ad.write("s1.t", 60.0).ok
    assert client.writes == [(0, [100])]


def test_float32_word_order():
    cfg = lambda wo: {"f": {"type": "holding_register", "address": {  # noqa: E731
        "area": "holding_register", "index": 0, "datatype": "float32",
        "word_order": wo}}}
    big = _modbus(cfg("big"), FakeClient({0: [0x4148, 0x0000]}))
    assert big.read_all()[0].v == 12.5
    little = _modbus(cfg("little"), FakeClient({0: [0x0000, 0x4148]}))
    assert little.read_all()[0].v == 12.5


def test_sim_source_uses_address_behavior():
    src = {"id": "x", "protocol": "sim", "connection": {}, "tags": [
        {"id": "1", "path": "a/b/c", "type": "float", "writable": False,
         "address": {"behavior": "random_walk", "initial": 5.0}},
        {"id": "2", "path": "a/b/d", "type": "float", "writable": True,
         "address": {"behavior": "state", "initial": 7.0}},
    ]}
    ad = make_source_adapter(src, "s1")
    vals = {t.name: t.v for t in ad.read_all()}
    assert set(vals) == {"s1.a.b.c", "s1.a.b.d"}
    assert vals["s1.a.b.d"] == 7.0
    assert abs(vals["s1.a.b.c"] - 5.0) < 0.1
    assert ad.write("s1.a.b.d", 9.0).ok
    assert {t.name: t.v for t in ad.read_all()}["s1.a.b.d"] == 9.0


def test_make_source_adapter_modbus_and_unknown():
    src = {"id": "x", "protocol": "modbus", "connection": {"host": "h", "port": 1502},
           "tags": [{"id": "1", "path": "p/q", "type": "float", "scale": 1,
                     "offset": 0, "writable": False,
                     "address": {"area": "holding_register", "index": 1,
                                 "datatype": "uint16"}}]}
    ad = make_source_adapter(src, "s1")
    assert list(ad.tag_map()) == ["s1.p.q"] and ad._cfg["port"] == 1502
    with pytest.raises(ValueError):
        make_source_adapter({"protocol": "plc9000", "tags": []}, "s1")


class _Stub(TagAdapter):
    def __init__(self, tags, fail=False):
        self.tags, self.fail, self.written = tags, fail, []

    def read_all(self):
        if self.fail:
            raise RuntimeError("boom")
        return [TagValue(t, 1.0, Quality.GOOD, None) for t in self.tags]

    def write(self, tag, value):
        self.written.append((tag, value))
        return WriteResult.done()

    def tag_map(self):
        return {t: {} for t in self.tags}


def test_multi_routes_write_to_owner():
    a, b = _Stub(["s.a"]), _Stub(["s.b"])
    m = MultiAdapter({"A": a, "B": b})
    assert m.write("s.b", 3).ok
    assert b.written == [("s.b", 3)] and a.written == []
    assert m.write("s.nope", 1).detail == "not_writable"
    assert m.name == "multi"


def test_multi_failing_source_yields_bad():
    m = MultiAdapter({"A": _Stub(["s.a"]), "B": _Stub(["s.b"], fail=True)})
    vals = {t.name: t.q for t in m.read_all()}
    assert vals == {"s.a": Quality.GOOD, "s.b": Quality.BAD}
    assert "B" in m.source_errors() and "boom" in m.source_errors()["B"]
