"""OPC UA adapter (asyncua sync client).

One batched `read_values` per poll. Any failure yields q=BAD, never a fake
value. The connection is lazy and dropped on error so the next poll
reconnects; close() is final. Only security "none" is supported for now;
sign/signencrypt report `security_mode_not_supported_yet` (q=BAD).
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Callable

from .base import Quality, TagAdapter, TagValue, WriteResult

log = logging.getLogger("edge_bridge.opcua")

try:
    from asyncua import ua  # type: ignore
    from asyncua.sync import Client as _Client  # type: ignore
except Exception:  # pragma: no cover - exercised only when lib missing
    ua = None  # type: ignore[assignment]
    _Client = None  # type: ignore[assignment]

BROWSE_MAX = 500
SECURITY_UNSUPPORTED = "security_mode_not_supported_yet"
_INT_TYPES = ("SByte", "Byte", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64")


class OpcUaAdapter(TagAdapter):
    name = "opcua"

    def __init__(self, site: str, cfg: dict,
                 now: Callable[[], datetime] | None = None):
        self._site = site
        self._cfg = cfg
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._client = None
        self._closed = False
        self._tags = dict(cfg.get("tags") or {})
        self.last_error: str | None = None
        if _Client is None:
            log.warning("asyncua not installed — opcua adapter will emit q=bad")

    # -- connection --------------------------------------------------------

    def _connect(self):
        """Caller holds the lock. Returns a connected client or None."""
        if _Client is None or self._closed:
            self.last_error = self.last_error or "adapter_unavailable"
            return None
        if self._cfg.get("security", "none") != "none":
            self.last_error = SECURITY_UNSUPPORTED
            return None
        if self._client is not None:
            return self._client
        timeout = float(self._cfg.get("timeout_ms", 4000)) / 1000.0
        client = _Client(self._cfg["endpoint"], timeout=timeout)
        if self._cfg.get("auth") == "user":
            client.set_user(self._cfg.get("username") or "")
            client.set_password(self._cfg.get("password") or "")
        try:
            client.connect()
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            log.warning("opcua connect failed: %s", self.last_error)
            try:
                client.disconnect()
            except Exception:
                pass
            return None
        self._client = client
        self.last_error = None
        return client

    def _drop(self):
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
            self._client = None

    # -- poll --------------------------------------------------------------

    def read_all(self) -> list[TagValue]:
        ts = self._now()
        names = list(self._tags)
        results: dict[str, tuple[object, Quality]] = {n: (0.0, Quality.BAD) for n in names}
        with self._lock:
            client = self._connect()
            if client is not None and names:
                try:
                    nodes = [client.get_node(self._tags[n]["address"]["node_id"])
                             for n in names]
                    try:
                        values = client.read_values(nodes)
                    except Exception:
                        values = self._read_each(nodes)
                    for n, raw in zip(names, values):
                        results[n] = self._convert(n, raw)
                except Exception as exc:
                    self.last_error = f"{type(exc).__name__}: {exc}"
                    log.warning("opcua read failed: %s", self.last_error)
                    self._drop()
        return [TagValue(name=n, v=results[n][0], q=results[n][1], ts=ts)  # type: ignore[arg-type]
                for n in names]

    @staticmethod
    def _read_each(nodes) -> list:
        """Batch failed (e.g. one bad node id): isolate it; if every node
        fails the connection itself is suspect."""
        out, failed = [], 0
        for nd in nodes:
            try:
                out.append(nd.read_value())
            except Exception:
                out.append(None)
                failed += 1
        if nodes and failed == len(nodes):
            raise ConnectionError("all node reads failed")
        return out

    def _convert(self, tag: str, raw) -> tuple[object, Quality]:
        if raw is None:
            return 0.0, Quality.BAD
        if isinstance(raw, bool):
            return raw, Quality.GOOD
        try:
            meta = self._tags[tag]
            return (float(raw) * float(meta.get("scale", 1.0))
                    + float(meta.get("offset", 0.0)), Quality.GOOD)
        except (TypeError, ValueError):
            return 0.0, Quality.BAD

    # -- command write-back --------------------------------------------------

    def write(self, tag: str, value: object) -> WriteResult:
        meta = self._tags.get(tag)
        if meta is None or not meta.get("writable", False):
            return WriteResult.denied("not_writable")
        lo, hi = meta.get("min"), meta.get("max")
        num = None
        if not isinstance(value, bool):
            try:
                num = float(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return WriteResult.denied("invalid_value")
            if (lo is not None and num < lo) or (hi is not None and num > hi):
                return WriteResult.denied("out_of_range")
        with self._lock:
            client = self._connect()
            if client is None:
                return WriteResult.denied("adapter_unavailable")
            try:
                node = client.get_node(meta["address"]["node_id"])
                vt = node.read_data_type_as_variant_type()
                scale = float(meta.get("scale", 1.0)) or 1.0
                offset = float(meta.get("offset", 0.0))
                if vt == ua.VariantType.Boolean:
                    out: object = bool(value)
                elif num is None:
                    return WriteResult.denied("invalid_value")
                elif vt.name in _INT_TYPES:
                    out = int(round((num - offset) / scale))
                elif vt in (ua.VariantType.Float, ua.VariantType.Double):
                    out = (num - offset) / scale
                else:
                    return WriteResult.denied("invalid_value")
                node.write_value(ua.DataValue(ua.Variant(out, vt)))
            except (TypeError, ValueError, OverflowError):
                return WriteResult.denied("invalid_value")
            except Exception as exc:
                log.warning("opcua write failed tag=%s: %s", tag, exc)
                self._drop()
                return WriteResult.denied("write_failed")
        return WriteResult.done()

    # -- browse (one level) ----------------------------------------------------

    def browse(self, node_id: str | None = None) -> list[dict]:
        """Children of `node_id` (default Objects folder), max BROWSE_MAX."""
        with self._lock:
            client = self._connect()
            if client is None:
                raise ConnectionError(self.last_error or "adapter_unavailable")
            parent = client.get_node(node_id) if node_id else client.nodes.objects
            items: list[dict] = []
            for ch in parent.get_children():
                if len(items) >= BROWSE_MAX:
                    break
                try:
                    nc = ch.read_node_class()
                    item = {"node_id": ch.nodeid.to_string(),
                            "name": ch.read_browse_name().Name,
                            "node_class": nc.name,
                            "data_type": None, "writable": False}
                    if nc == ua.NodeClass.Variable:
                        try:
                            item["data_type"] = ch.read_data_type_as_variant_type().name
                        except Exception:
                            pass
                        try:
                            item["writable"] = (
                                ua.AccessLevel.CurrentWrite in ch.get_user_access_level())
                        except Exception:
                            pass
                    items.append(item)
                except Exception as exc:
                    log.debug("opcua browse skip child: %s", exc)
            return items

    def tag_map(self) -> dict[str, dict]:
        return {t: dict(m) for t, m in self._tags.items()}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._drop()
