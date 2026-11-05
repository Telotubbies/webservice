"""vision/caps ingestion: payload bounds + handle_caps writes through the real
tenant_tx path with a fake pool — edge identity comes only from the topic.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app.vision.stream import CAPS_MAX_BYTES, _caps_payload, handle_caps


def run(coro):
    return asyncio.run(coro)


ORG, EDGE = uuid.uuid4(), uuid.uuid4()
EDGE_UUID = str(uuid.uuid4())


def _doc(**kw):
    d = {"cpu_cores": 8, "ram_mb": 32768, "device": "cpu",
         "providers": ["CPUExecutionProvider", "CUDAExecutionProvider"],
         "loaded": [EDGE_UUID]}
    d.update(kw)
    return json.dumps(d).encode()


class FakeConn:
    def __init__(self):
        self.writes = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def execute(self, sql, *args):
        if "set_config" not in sql:
            self.writes.append((sql, args))
        return "OK"


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _st(conn):
    return SimpleNamespace(pools=SimpleNamespace(system=FakePool(conn)))


def _edge():
    return SimpleNamespace(org_id=ORG, id=EDGE)


# ------------------------------------------------------------------ payload
def test_caps_payload_valid():
    caps = _caps_payload(_doc())
    assert caps["cpu_cores"] == 8 and caps["ram_mb"] == 32768
    assert caps["device"] == "cpu"
    assert caps["providers"] == ["CPUExecutionProvider", "CUDAExecutionProvider"]
    assert caps["loaded"] == [EDGE_UUID]


def test_caps_payload_bounds():
    caps = _caps_payload(_doc(cpu_cores=4096, ram_mb=2 ** 50,
                              providers=["x" * 200] * 50, loaded=[EDGE_UUID] * 300))
    assert caps["cpu_cores"] == 4096 and caps["ram_mb"] == 2 ** 50
    assert len(caps["providers"]) == 32 and all(len(p) <= 80 for p in caps["providers"])
    assert len(caps["loaded"]) == 256


def test_caps_payload_rejects_malformed():
    assert _caps_payload(b"not json") is None
    assert _caps_payload(b"[1]") is None
    assert _caps_payload(b"x" * (CAPS_MAX_BYTES + 1)) is None
    # cpu_cores is the one required field
    for bad in (0, -1, 4097, 1.5, True, "8", None):
        assert _caps_payload(_doc(cpu_cores=bad)) is None, bad
    # malformed arrays drop the whole report
    assert _caps_payload(_doc(providers={"a": 1})) is None
    assert _caps_payload(_doc(loaded=12)) is None
    # junk entries are filtered, not fatal
    caps = _caps_payload(_doc(providers=["ok", 5, "x" * 100], loaded=[EDGE_UUID, "nope", 4]))
    assert caps["providers"] == ["ok", "x" * 80] and caps["loaded"] == [EDGE_UUID]


def test_caps_payload_ram_validation():
    assert _caps_payload(_doc(ram_mb=None))["ram_mb"] is None
    for bad in (-1, 2 ** 50 + 1, float("nan"), float("inf"), True, "x"):
        assert _caps_payload(_doc(ram_mb=bad))["ram_mb"] is None, bad
    # huge int beyond float range must not raise
    assert _caps_payload(_doc(ram_mb=10 ** 400))["ram_mb"] is None
    # long device string is capped, non-str dropped
    assert _caps_payload(_doc(device="d" * 200))["device"] == "d" * 80
    assert _caps_payload(_doc(device={"x": 1}))["device"] is None


# ------------------------------------------------------------------ handler
def test_handle_caps_upserts_for_topic_edge_only():
    conn = FakeConn()
    msg = SimpleNamespace(payload=_doc(**{"edge_id": str(uuid.uuid4()), "org_id": str(uuid.uuid4())}))
    run(handle_caps(_st(conn), msg, _edge()))
    assert len(conn.writes) == 1
    sql, args = conn.writes[0]
    assert "edge_capabilities" in sql and "ON CONFLICT" in sql
    # identity strictly from the validated topic edge — payload ids ignored
    assert args[0] == ORG and args[1] == EDGE
    assert args[2] == 8 and args[3] == 32768
    assert args[5] == ["CPUExecutionProvider", "CUDAExecutionProvider"]


def test_handle_caps_ignores_malformed():
    conn = FakeConn()
    msg = SimpleNamespace(payload=b"{}")
    run(handle_caps(_st(conn), msg, _edge()))
    assert conn.writes == []
