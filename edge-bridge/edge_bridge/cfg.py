"""Backend-pushed PLC config: apply live, ack, cache for restart.

Wire (backend `datasources/publisher.py`):
  backend -> edge  {prefix}/cfg      {"version", "sources":[...]}  QoS1, not retained
  edge -> backend  {prefix}/cfg-req  {"have_version": int|null}    on every (re)connect
  edge -> backend  {prefix}/cfg-ack  {"version", "ok", "errors":[...]}

Rules: a cfg with version <= the applied one is ignored (out-of-order
delivery); an edge that never applied a cfg (running tags.yaml) also ignores
version 0 (the backend's "no sources" resync must not stop a yaml-driven edge).
Each source is built independently: one bad source is reported in `errors`
and keeps its previous adapter (if any); the others still apply.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from pathlib import Path

from .adapters import MultiAdapter, make_source_adapter
from .adapters.base import TagAdapter
from .config import Config

log = logging.getLogger("edge_bridge.cfg")

CACHE_NAME = "cfg.json"


def _seal(data: bytes) -> bytes:
    """Seam for at-rest encryption of the cache (secrets live in it). Identity for now."""
    return data


def _unseal(data: bytes) -> bytes:
    return data


class AdapterHolder:
    """Current adapter + poll period, shared by the poll loop, heartbeat and
    command handler. Readers call get() every cycle, so a swap is picked up
    on the next read without restarting any thread."""

    def __init__(self, adapter: TagAdapter, poll_ms: int):
        self._lock = threading.Lock()
        self._adapter = adapter
        self.poll_ms = poll_ms

    def get(self) -> TagAdapter:
        with self._lock:
            return self._adapter

    def swap(self, new: TagAdapter, poll_ms: int | None = None,
             close_old: bool = True) -> TagAdapter:
        with self._lock:
            old, self._adapter = self._adapter, new
            if poll_ms is not None:
                self.poll_ms = poll_ms
        if close_old:
            _close(old)
        return old


def _close(adapter: TagAdapter) -> None:
    try:
        adapter.close()
    except Exception:  # noqa: BLE001
        log.exception("closing old adapter failed")


class CfgClient:
    def __init__(self, cfg: Config, holder: AdapterHolder, bridge, site_code: str,
                 now=None):
        self._cfg = cfg
        self._holder = holder
        self._bridge = bridge
        self._site = site_code
        self._now = now
        self._default_poll_ms = holder.poll_ms
        self._lock = threading.Lock()
        self._sources: dict[str, TagAdapter] = {}   # applied per-source adapters
        self.version: int | None = None

    # -- connection -------------------------------------------------------------

    def on_connect(self, bridge=None) -> None:
        """(Re)subscribe and tell the backend what we have."""
        b = bridge or self._bridge
        b.subscribe(self._cfg.cfg_topic, qos=1)
        b.publish_json(self._cfg.cfg_req_topic, {"have_version": self.version})

    # -- inbound ----------------------------------------------------------------

    def handle(self, msg) -> None:
        if getattr(msg, "retain", False):
            log.warning("ignored retained cfg")
            return
        try:
            doc = json.loads(msg.payload)
            version = doc["version"]
            sources = doc.get("sources") or []
            if (not isinstance(doc, dict) or isinstance(version, bool)
                    or not isinstance(version, int) or not isinstance(sources, list)):
                raise ValueError("malformed cfg")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            log.warning("ignored malformed cfg payload")
            return
        with self._lock:
            if version <= (self.version if self.version is not None else 0):
                log.info("ignored cfg version=%s (applied=%s)", version, self.version)
                return
            errors = self._apply(version, sources)
            self._persist({"version": version, "sources": sources})
        self._bridge.publish_json(self._cfg.cfg_ack_topic, {
            "version": version, "ok": not errors, "errors": errors})

    # -- cache ------------------------------------------------------------------

    def load_cached(self) -> bool:
        """Apply the cached cfg at startup (no ack — not connected yet)."""
        path = Path(self._cfg.state_dir) / CACHE_NAME
        try:
            doc = json.loads(_unseal(path.read_bytes()))
            version, sources = doc["version"], doc["sources"]
            if isinstance(version, bool) or not isinstance(version, int) \
                    or not isinstance(sources, list):
                raise ValueError("bad cache")
        except FileNotFoundError:
            return False
        except Exception:  # noqa: BLE001
            log.exception("cfg cache unreadable — falling back to tags config")
            return False
        with self._lock:
            errors = self._apply(version, sources)
        if errors:
            log.warning("cached cfg applied with errors: %s", errors)
        return True

    def _persist(self, doc: dict) -> None:
        d = Path(self._cfg.state_dir)
        try:
            d.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=d, prefix=".cfg-")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(_seal(json.dumps(doc).encode()))
                    f.flush()
                    os.fsync(f.fileno())
                try:
                    os.chmod(tmp, 0o600)
                except OSError:
                    pass  # best effort (Windows)
                os.replace(tmp, d / CACHE_NAME)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        except OSError:
            log.exception("could not persist cfg cache")

    # -- apply ------------------------------------------------------------------

    def _apply(self, version: int, sources: list) -> list[dict]:
        errors: list[dict] = []
        new: dict[str, TagAdapter] = {}
        polls: list[int] = []
        for s in sources:
            if not isinstance(s, dict) or not s.get("enabled", True):
                continue
            sid = str(s.get("id"))
            try:
                src = dict(s)
                src["connection"] = {**(s.get("connection") or {}),
                                     **(s.get("secrets") or {})}
                new[sid] = make_source_adapter(src, self._site, now=self._now)
            except Exception as exc:  # noqa: BLE001 — isolate per source
                errors.append({"source_id": sid, "detail": str(exc) or type(exc).__name__})
                log.warning("source %s rejected: %s", sid, exc)
                if sid in self._sources:
                    new[sid] = self._sources[sid]
            if sid in new:
                try:
                    polls.append(int(s.get("poll_ms")))
                except (TypeError, ValueError):
                    pass
        poll_ms = max(min(polls), 1) if polls else self._default_poll_ms

        first = not self._sources and self.version is None
        old = self._holder.swap(MultiAdapter(new), poll_ms, close_old=False)
        if first:
            _close(old)  # the tags.yaml adapter
        else:
            for sid, ad in self._sources.items():
                if new.get(sid) is not ad:
                    _close(ad)
        self._sources = new
        self.version = version
        log.info("cfg applied version=%d sources=%d errors=%d poll_ms=%d",
                 version, len(new), len(errors), poll_ms,
                 extra={"fields": {"event": "cfg_applied", "version": version,
                                   "errors": len(errors)}})
        return errors
