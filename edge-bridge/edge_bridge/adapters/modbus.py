"""Modbus TCP adapter — stub with real structure.

Register-map driven by the `modbus:` section of tags.yaml. `pymodbus` is an
OPTIONAL import: without it (or without a reachable device) every tag is
published with q="bad", which is exactly what a real adapter must do when
its OT connection is down — the rest of the bridge cannot tell the
difference. That is the abstraction boundary this stub exists to prove.

To run for real:  pip install pymodbus  (pymodbus 3.x API shown; the 2.x
sync client also works through the small shims below), set ADAPTER=modbus
and point `modbus.host` in tags.yaml at the PLC / Factory I/O / OpenPLC.
"""

from __future__ import annotations

import logging
import re
import struct
import threading
from datetime import datetime, timezone
from typing import Callable

from .base import Quality, TagAdapter, TagValue, WriteResult

log = logging.getLogger("edge_bridge.modbus")

try:  # pymodbus 3.x
    from pymodbus.client import ModbusTcpClient  # type: ignore
except ImportError:  # pragma: no cover - exercised only when lib missing
    try:  # pymodbus 2.x
        from pymodbus.client.sync import ModbusTcpClient  # type: ignore
    except ImportError:
        ModbusTcpClient = None  # type: ignore[assignment,misc]

_READ_FC = {
    "coil": "read_coils",
    "discrete_input": "read_discrete_inputs",
    "holding_register": "read_holding_registers",
    "input_register": "read_input_registers",
}


def _parse_address(addr: object) -> int:
    """Accept plain ints or IEC-style '%QX0.0'/'%QW16' — bit index -> 8*byte+bit."""
    if isinstance(addr, int):
        return addr
    m = re.fullmatch(r"%[QI][XW](\d+)(?:\.(\d+))?", str(addr).strip())
    if not m:
        raise ValueError(f"unparseable modbus address: {addr!r}")
    base, bit = int(m.group(1)), m.group(2)
    return base * 8 + int(bit) if bit is not None else base


_DT_WORDS = {"int16": 1, "uint16": 1, "int32": 2, "uint32": 2, "float32": 2}
_DT_FMT = {"int16": "h", "uint16": "H", "int32": "i", "uint32": "I", "float32": "f"}


def _resolve(meta: dict) -> dict:
    """Normalize a tag meta (legacy string address or address dict) to
    {type, address, datatype, word_order}."""
    addr = meta["address"]
    if isinstance(addr, dict):
        area = addr.get("area", meta.get("type"))
        if area not in _READ_FC:
            raise ValueError(f"unknown modbus area: {area!r}")
        dt = addr.get("datatype", "uint16")
        if dt not in _DT_WORDS:
            raise ValueError(f"unknown modbus datatype: {dt!r}")
        return {"type": area, "address": _parse_address(addr["index"]),
                "datatype": dt, "word_order": addr.get("word_order", "big")}
    dt = meta.get("datatype", "uint16")
    if dt not in _DT_WORDS:
        raise ValueError(f"unknown modbus datatype: {dt!r}")
    return {"type": meta["type"], "address": _parse_address(addr),
            "datatype": dt, "word_order": meta.get("word_order", "big")}


def _decode(regs: list[int], datatype: str, word_order: str) -> float | int:
    n = _DT_WORDS[datatype]
    words = list(regs[:n])
    if n == 2 and word_order == "little":
        words.reverse()
    raw = b"".join(struct.pack(">H", w & 0xFFFF) for w in words)
    return struct.unpack(">" + _DT_FMT[datatype], raw)[0]


def _encode(value: float, datatype: str, word_order: str) -> list[int]:
    fmt = ">" + _DT_FMT[datatype]
    raw = struct.pack(fmt, float(value) if datatype == "float32" else int(round(value)))
    words = list(struct.unpack(">" + "H" * (len(raw) // 2), raw))
    if len(words) == 2 and word_order == "little":
        words.reverse()
    return words


class ModbusAdapter(TagAdapter):
    name = "modbus"

    def __init__(self, site: str, cfg: dict,
                 now: Callable[[], datetime] | None = None):
        self._site = site
        self._cfg = cfg
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._client = None
        self._tags = {
            (t if t.startswith(f"{site}.") else f"{site}.{t}"): meta
            for t, meta in (cfg.get("tags") or {}).items()
        }
        if ModbusTcpClient is None:
            log.warning("pymodbus not installed — modbus adapter will emit "
                        "q=bad for all tags (pip install pymodbus to enable)")

    # -- connection --------------------------------------------------------

    def _client_or_none(self):
        if ModbusTcpClient is None:
            return None
        with self._lock:
            if self._client is None:
                self._client = ModbusTcpClient(
                    self._cfg.get("host", "127.0.0.1"),
                    port=int(self._cfg.get("port", 502)),
                    timeout=float(self._cfg.get("request_timeout_ms", 2000)) / 1000.0,
                )
            try:
                if not self._client.connected and not self._client.connect():
                    return None
            except OSError:
                return None
            return self._client

    # -- poll --------------------------------------------------------------

    def read_all(self) -> list[TagValue]:
        ts = self._now()
        client = self._client_or_none()
        values: list[TagValue] = []
        for tag, meta in self._tags.items():
            q, v = Quality.BAD, 0.0
            if client is not None:
                try:
                    v, q = self._read_one(client, meta)
                except Exception as exc:  # device/codec failure -> bad, keep polling others
                    log.warning("modbus read failed tag=%s err=%s", tag, exc)
            values.append(TagValue(name=tag, v=v, q=q, ts=ts))
        return values

    def _read_one(self, client, meta: dict) -> tuple[float | bool, Quality]:
        r = _resolve(meta)
        fc = _READ_FC[r["type"]]
        is_bit = r["type"] in ("coil", "discrete_input")
        count = 1 if is_bit else int(meta.get("count", _DT_WORDS[r["datatype"]]))
        resp = getattr(client, fc)(r["address"], count=count,
                                   slave=int(self._cfg.get("unit_id", 1)))
        if resp.isError():
            return 0.0, Quality.BAD
        if is_bit:
            return bool(resp.bits[0]), Quality.GOOD
        raw = _decode(resp.registers, r["datatype"], r["word_order"])
        scale = float(meta.get("scale", 1.0))
        offset = float(meta.get("offset", 0.0))
        return raw * scale + offset, Quality.GOOD

    # -- command write-back --------------------------------------------------

    def write(self, tag: str, value: object) -> WriteResult:
        meta = self._tags.get(tag)
        if meta is None or not meta.get("writable", False):
            return WriteResult.denied("not_writable")
        lo, hi = meta.get("min"), meta.get("max")
        if lo is not None or hi is not None:
            try:
                num = float(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return WriteResult.denied("invalid_value")
            if (lo is not None and num < lo) or (hi is not None and num > hi):
                return WriteResult.denied("out_of_range")
        client = self._client_or_none()
        if client is None:
            return WriteResult.denied("adapter_unavailable")

        try:
            r = _resolve(meta)
        except (ValueError, KeyError):
            return WriteResult.denied("bad_address")
        unit = int(self._cfg.get("unit_id", 1))
        if r["type"] == "coil":
            resp = client.write_coil(r["address"], bool(value), slave=unit)
        elif r["type"] == "holding_register":
            scale = float(meta.get("scale", 1.0)) or 1.0
            raw = (float(value) - float(meta.get("offset", 0.0))) / scale
            words = _encode(raw, r["datatype"], r["word_order"])
            if len(words) == 1:
                resp = client.write_register(r["address"], words[0], slave=unit)
            else:
                resp = client.write_registers(r["address"], words, slave=unit)
        else:
            # discrete_input / input_register are never writable by Modbus
            return WriteResult.denied("not_writable")
        return WriteResult.done() if not resp.isError() \
            else WriteResult.denied("write_failed")

    def tag_map(self) -> dict[str, dict]:
        return {t: dict(m) for t, m in self._tags.items()}

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:
                    pass
                self._client = None
