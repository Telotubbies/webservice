"""OPC UA adapter (asyncua sync client).

One batched `read_values` per poll. Any failure yields q=BAD, never a fake
value. The connection is lazy and dropped on error so the next poll
reconnects; close() is final. Only security "none" is supported for now;
sign/signencrypt report `security_mode_not_supported_yet` (q=BAD).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from .base import Quality, TagAdapter, TagValue, WriteResult

log = logging.getLogger("edge_bridge.opcua")

try:
    from asyncua import ua  # type: ignore
    from asyncua.sync import Client as _Client  # type: ignore
    from asyncua.sync import ThreadLoop as _ThreadLoop  # type: ignore
except Exception:  # pragma: no cover - exercised only when lib missing
    ua = None  # type: ignore[assignment]
    _Client = None  # type: ignore[assignment]
    _ThreadLoop = None  # type: ignore[assignment]

BROWSE_MAX = 500
SECURITY_UNSUPPORTED = "security_mode_not_supported_yet"
USER_AUTH_PLAINTEXT = "user_auth_requires_encryption"
_INT_TYPES = ("SByte", "Byte", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64")


def _val(dv):
    """Value of a good DataValue, else None."""
    try:
        if dv.StatusCode.is_good() and dv.Value is not None:
            return dv.Value.Value
    except Exception:
        pass
    return None


def _type_name(nid) -> str | None:
    if nid is None:
        return None
    if getattr(nid, "NamespaceIndex", None) == 0 and isinstance(nid.Identifier, int):
        try:
            return ua.VariantType(nid.Identifier).name
        except ValueError:
            pass
    return nid.to_string()


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
        self._tloop = None
        self.deadline: float | None = None  # time.monotonic(); set by ops
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
        if self._cfg.get("auth") == "user":
            # never send a password over an unencrypted channel
            self.last_error = USER_AUTH_PLAINTEXT
            return None
        endpoint = self._cfg.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint:
            self.last_error = "missing_endpoint"
            return None
        timeout = float(self._cfg.get("timeout_ms", 4000)) / 1000.0
        rem = self._remaining()
        if rem is not None:
            timeout = max(0.1, min(timeout, rem))
        # own the ThreadLoop so it is stopped on every failure path
        tloop = _ThreadLoop()
        tloop.start()
        client = None
        try:
            client = _Client(endpoint, timeout=timeout, tloop=tloop)
            client.connect()
        except Exception as exc:
            self.last_error = (f"connect_failed: {type(exc).__name__}"
                               + (f": {exc}" if str(exc) else ""))
            log.warning("opcua connect failed: %s", self.last_error)
            if client is not None:
                try:
                    client.disconnect()
                except Exception:
                    pass
            self._stop_loop(tloop)
            return None
        self._client = client
        self._tloop = tloop
        self.last_error = None
        return client

    @staticmethod
    def _stop_loop(tloop) -> None:
        try:
            tloop.stop()
        except Exception:
            pass

    def _remaining(self) -> float | None:
        return None if self.deadline is None else self.deadline - time.monotonic()

    def _check_deadline(self) -> None:
        rem = self._remaining()
        if rem is not None and rem <= 0:
            raise TimeoutError("timeout")

    def _drop(self):
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
            self._client = None
        if self._tloop is not None:
            self._stop_loop(self._tloop)
            self._tloop = None

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

    def _read_each(self, nodes) -> list:
        """Batch failed (e.g. one bad node id): isolate it; if every node
        fails the connection itself is suspect."""
        out, failed = [], 0
        for nd in nodes:
            self._check_deadline()
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
            kids = parent.get_children()[:BROWSE_MAX]
            if not kids:
                return []
            self._check_deadline()
            attr = ua.AttributeIds
            classes = client.read_attributes(kids, attr.NodeClass)
            names = client.read_attributes(kids, attr.BrowseName)
            var_idx = [i for i, dv in enumerate(classes)
                       if _val(dv) == ua.NodeClass.Variable.value]
            types: dict[int, object] = {}
            levels: dict[int, object] = {}
            if var_idx:
                self._check_deadline()
                vn = [kids[i] for i in var_idx]
                types = dict(zip(var_idx, client.read_attributes(vn, attr.DataType)))
                levels = dict(zip(var_idx, client.read_attributes(vn, attr.UserAccessLevel)))
            items: list[dict] = []
            for i, ch in enumerate(kids):
                cls, bn = _val(classes[i]), _val(names[i])
                if cls is None or bn is None:
                    continue
                item = {"node_id": ch.nodeid.to_string(), "name": bn.Name,
                        "node_class": ua.NodeClass(cls).name,
                        "data_type": None, "writable": False}
                if i in types:
                    item["data_type"] = _type_name(_val(types[i]))
                    lv = _val(levels[i])
                    if lv is not None:
                        item["writable"] = (
                            ua.AccessLevel.CurrentWrite in ua.AccessLevel.parse_bitfield(lv))
                items.append(item)
            return items

    def tag_map(self) -> dict[str, dict]:
        return {t: dict(m) for t, m in self._tags.items()}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._drop()
