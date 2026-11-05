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

import base64
import json
import logging
import os
import tempfile
import threading
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .adapters import MultiAdapter, make_source_adapter
from .adapters.base import TagAdapter
from .config import Config

log = logging.getLogger("edge_bridge.cfg")

CACHE_NAME = "cfg.json"


_MAGIC = b"WDS1"   # sealed-cache marker: magic | 12-byte nonce | AES-GCM ciphertext


def _key_bytes(state_key: str | None) -> bytes | None:
    if not state_key:
        return None
    k = base64.urlsafe_b64decode(state_key + "=" * (-len(state_key) % 4))
    if len(k) != 32:
        raise ValueError("state_key must decode to 32 bytes")
    return k


def _seal(data: bytes, state_key: str | None = None) -> bytes:
    """At-rest encryption of the cache (secrets live in it): AES-GCM under the
    enrollment state_key; identity when the gateway has none (env bootstrap)."""
    key = _key_bytes(state_key)
    if key is None:
        return data
    nonce = os.urandom(12)
    return _MAGIC + nonce + AESGCM(key).encrypt(nonce, data, _MAGIC)


def _unseal(data: bytes, state_key: str | None = None) -> bytes:
    if not data.startswith(_MAGIC):
        return data   # plaintext cache written before enrollment
    key = _key_bytes(state_key)
    if key is None:
        raise ValueError("cfg cache is sealed but no state_key is available")
    body = data[len(_MAGIC):]
    return AESGCM(key).decrypt(body[:12], body[12:], _MAGIC)


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
                 now=None, vision=None):
        self._vision = vision          # VisionRunner | None (cameras slice of the cfg)
        self._cfg = cfg
        self._holder = holder
        self._bridge = bridge
        self._site = site_code
        self._now = now
        self._default_poll_ms = holder.poll_ms
        self._lock = threading.Lock()
        self._sources: dict[str, TagAdapter] = {}   # applied per-source adapters
        self._specs: dict[str, dict] = {}           # last good spec per source id
        self._last_ack: dict | None = None
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
            if version == self.version and self._last_ack is not None:
                self._bridge.publish_json(self._cfg.cfg_ack_topic, self._last_ack)
                log.info("re-sent ack for cfg version=%s", version)
                return
            # env-bootstrap/tags.yaml edges ignore v0 (the backend's "no
            # sources" resync must not stop them); an enrolled edge has no
            # fallback, so v0 is its first real answer
            baseline = (self.version if self.version is not None
                        else (-1 if self._cfg.enrolled else 0))
            if version <= baseline:
                log.info("ignored cfg version=%s (applied=%s)", version, self.version)
                return
            errors = self._apply(version, sources)
            cameras = doc.get("cameras") if isinstance(doc.get("cameras"), list) else []
            self._apply_cameras(cameras)
            self._persist({"version": version, "sources": self._effective(sources, errors),
                           "cameras": cameras})
            self._last_ack = {"version": version, "ok": not errors, "errors": errors}
            ack = self._last_ack
        self._bridge.publish_json(self._cfg.cfg_ack_topic, ack)

    # -- cache ------------------------------------------------------------------

    def load_cached(self) -> bool:
        """Apply the cached cfg at startup (no ack — not connected yet)."""
        path = Path(self._cfg.state_dir) / CACHE_NAME
        try:
            doc = json.loads(_unseal(path.read_bytes(), self._cfg.state_key))
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
            cams = doc.get("cameras")
            self._apply_cameras(cams if isinstance(cams, list) else [])
        if errors:
            log.warning("cached cfg applied with errors: %s", errors)
        return True

    def _apply_cameras(self, cameras: list) -> None:
        if self._vision is None:
            return
        try:
            self._vision.apply(cameras)
        except Exception:  # noqa: BLE001 — cameras must never break source config
            log.exception("camera config rejected")

    def _effective(self, sources: list, errors: list[dict]) -> list:
        """Sources as actually running: a failed source is replaced by its
        last good spec (or dropped), so a restart does not lose its tags."""
        failed = {e["source_id"] for e in errors}
        out = []
        for s in sources:
            sid = str(s.get("id")) if isinstance(s, dict) else None
            if sid in failed:
                if sid in self._specs:
                    out.append(self._specs[sid])
            else:
                out.append(s)
        return out

    def _persist(self, doc: dict) -> None:
        d = Path(self._cfg.state_dir)
        try:
            d.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=d, prefix=".cfg-")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(_seal(json.dumps(doc).encode(), self._cfg.state_key))
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
        failed = {e["source_id"] for e in errors}
        for s_ in sources:
            sid = str(s_.get("id")) if isinstance(s_, dict) else None
            if sid in new and sid not in failed:
                self._specs[sid] = s_
        self._specs = {k: v for k, v in self._specs.items() if k in new}
        self.version = version
        log.info("cfg applied version=%d sources=%d errors=%d poll_ms=%d",
                 version, len(new), len(errors), poll_ms,
                 extra={"fields": {"event": "cfg_applied", "version": version,
                                   "errors": len(errors)}})
        return errors
