"""Siemens S7 adapter (python-snap7).

Reads are batched per (area, db): tags are merged into contiguous byte spans
(gaps up to MAX_GAP bytes are bridged) and each span costs one `read_area`
per poll. Any failure yields q=BAD, never a fake value. The connection is
lazy and dropped on error so the next poll reconnects; close() is final.
"""

from __future__ import annotations

import logging
import struct
import threading
from datetime import datetime, timezone
from typing import Callable

from .base import Quality, TagAdapter, TagValue, WriteResult

log = logging.getLogger("edge_bridge.s7")

try:
    import snap7  # type: ignore
    from snap7.type import Area  # type: ignore
    _AREA = {"DB": Area.DB, "M": Area.MK, "I": Area.PE, "Q": Area.PA}
except Exception:  # pragma: no cover - exercised only when lib missing
    snap7 = None  # type: ignore[assignment]
    _AREA = {}

MAX_GAP = 200
_FMT = {"int": ">h", "dint": ">i", "real": ">f", "word": ">H"}
_SIZE = {"bool": 1, "int": 2, "dint": 4, "real": 4, "word": 2}
_INT_RANGE = {"int": (-32768, 32767), "dint": (-2**31, 2**31 - 1), "word": (0, 65535)}


class S7Adapter(TagAdapter):
    name = "s7"

    def __init__(self, site: str, cfg: dict,
                 now: Callable[[], datetime] | None = None):
        self._site = site
        self._cfg = cfg
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._client = None
        self._closed = False
        self._tags = dict(cfg.get("tags") or {})
        if snap7 is None:
            log.warning("python-snap7 not installed — s7 adapter will emit q=bad")
        self._plan = self._build_plan()

    def _build_plan(self) -> list[tuple[str, int, int, int, list]]:
        """[(area, db, start, end, [(tag, addr), ...])] — one entry per read."""
        groups: dict[tuple[str, int], list] = {}
        for tag, meta in self._tags.items():
            a = meta["address"]
            groups.setdefault((a["area"], int(a.get("db", 0))), []).append((tag, a))
        plan = []
        for (area, db), items in groups.items():
            items.sort(key=lambda it: it[1]["byte"])
            span = None
            for tag, a in items:
                s = int(a["byte"])
                e = s + _SIZE[a["datatype"]]
                if span and s - span[1] <= MAX_GAP:
                    span[1] = max(span[1], e)
                    span[2].append((tag, a))
                else:
                    span = [s, e, [(tag, a)]]
                    plan.append((area, db, span))
        return [(ar, db, sp[0], sp[1], sp[2]) for ar, db, sp in plan]

    # -- connection --------------------------------------------------------

    def _connect(self):
        """Caller holds the lock. Returns a connected client or None."""
        if snap7 is None or self._closed:
            return None
        if self._client is None:
            self._client = snap7.client.Client()
            ms = int(self._cfg.get("timeout_ms", 2000))
            try:
                self._client.set_param(snap7.type.Parameter.PingTimeout, ms)
                self._client.set_param(snap7.type.Parameter.RecvTimeout, ms)
            except Exception:
                pass
        try:
            if not self._client.get_connected():
                self._client.connect(self._cfg.get("host", "127.0.0.1"),
                                     int(self._cfg.get("rack", 0)),
                                     int(self._cfg.get("slot", 1)),
                                     int(self._cfg.get("port", 102)))
        except Exception as exc:
            log.warning("s7 connect failed: %s", exc)
            self._drop()
            return None
        return self._client

    def _drop(self):
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
            self._client = None

    # -- poll --------------------------------------------------------------

    @staticmethod
    def _decode(buf: bytes, off: int, a: dict):
        dt = a["datatype"]
        if dt == "bool":
            return bool((buf[off] >> int(a["bit"])) & 1)
        return struct.unpack_from(_FMT[dt], buf, off)[0]

    def read_all(self) -> list[TagValue]:
        ts = self._now()
        results: dict[str, tuple[object, Quality]] = {}
        with self._lock:
            client = self._connect()
            for area, db, start, end, items in self._plan:
                buf = None
                if client is not None:
                    try:
                        buf = bytes(client.read_area(_AREA[area], db, start, end - start))
                    except Exception as exc:
                        log.warning("s7 read failed %s db=%s: %s", area, db, exc)
                        self._drop()
                        client = None
                for tag, a in items:
                    meta = self._tags[tag]
                    if buf is None:
                        results[tag] = (0.0, Quality.BAD)
                        continue
                    try:
                        raw = self._decode(buf, int(a["byte"]) - start, a)
                        if a["datatype"] == "bool":
                            results[tag] = (raw, Quality.GOOD)
                        else:
                            results[tag] = (raw * float(meta.get("scale", 1.0))
                                            + float(meta.get("offset", 0.0)), Quality.GOOD)
                    except Exception as exc:
                        log.warning("s7 decode failed tag=%s: %s", tag, exc)
                        results[tag] = (0.0, Quality.BAD)
        return [TagValue(name=t, v=results[t][0], q=results[t][1], ts=ts)  # type: ignore[arg-type]
                for t in self._tags]

    # -- command write-back --------------------------------------------------

    def write(self, tag: str, value: object) -> WriteResult:
        meta = self._tags.get(tag)
        if meta is None or not meta.get("writable", False):
            return WriteResult.denied("not_writable")
        a = meta["address"]
        dt = a["datatype"]
        lo, hi = meta.get("min"), meta.get("max")
        if lo is not None or hi is not None:
            try:
                num = float(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return WriteResult.denied("invalid_value")
            if (lo is not None and num < lo) or (hi is not None and num > hi):
                return WriteResult.denied("out_of_range")
        payload = None
        if dt != "bool":
            try:
                scale = float(meta.get("scale", 1.0)) or 1.0
                raw = (float(value) - float(meta.get("offset", 0.0))) / scale  # type: ignore[arg-type]
                if dt == "real":
                    payload = struct.pack(">f", raw)
                else:
                    iv = int(round(raw))
                    rlo, rhi = _INT_RANGE[dt]
                    if not rlo <= iv <= rhi:
                        return WriteResult.denied("out_of_range")
                    payload = struct.pack(_FMT[dt], iv)
            except (TypeError, ValueError, OverflowError, struct.error):
                return WriteResult.denied("invalid_value")

        with self._lock:
            client = self._connect()
            if client is None:
                return WriteResult.denied("adapter_unavailable")
            area, db, byte = _AREA[a["area"]], int(a.get("db", 0)), int(a["byte"])
            try:
                if dt == "bool":
                    cur = bytearray(client.read_area(area, db, byte, 1))
                    mask = 1 << int(a["bit"])
                    cur[0] = (cur[0] | mask) if bool(value) else (cur[0] & ~mask & 0xFF)
                    client.write_area(area, db, byte, cur)
                else:
                    client.write_area(area, db, byte, bytearray(payload))
            except Exception as exc:
                log.warning("s7 write failed tag=%s: %s", tag, exc)
                self._drop()
                return WriteResult.denied("write_failed")
        return WriteResult.done()

    def tag_map(self) -> dict[str, dict]:
        return {t: dict(m) for t, m in self._tags.items()}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._drop()
