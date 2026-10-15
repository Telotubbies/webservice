"""Adapter factory — picks and configures the TagAdapter from env + tags.yaml."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import yaml

from .base import TagAdapter
from .sim import SimAdapter
from .modbus import ModbusAdapter
from .multi import MultiAdapter

__all__ = ["MultiAdapter", "make_adapter", "make_source_adapter", "load_tags_config"]

log = logging.getLogger("edge_bridge.adapters")

_REGISTRY = {"sim": SimAdapter, "modbus": ModbusAdapter}


def load_tags_config(path: str | Path) -> dict:
    p = Path(path)
    if not p.is_file():
        log.info("tags config %s not found — using adapter defaults", p)
        return {}
    try:
        return yaml.safe_load(p.read_text()) or {}
    except yaml.YAMLError as exc:
        log.error("tags config %s failed to parse: %s — using defaults", p, exc)
        return {}


def make_adapter(name: str, site: str, tags_config: dict,
                 now=None) -> TagAdapter:
    cls = _REGISTRY.get(name)
    if cls is None:
        raise ValueError(
            f"unknown adapter {name!r} (choices: {sorted(_REGISTRY)})")
    if name == "sim":
        return cls(site, tags_config.get("sim", {}).get("tags"), now=now)
    cfg = dict(tags_config.get(name, {}))
    if name == "modbus":  # container -> Factory I/O on the Docker host: no yaml edit needed
        cfg["host"] = os.getenv("MODBUS_HOST", cfg.get("host", "127.0.0.1"))
        cfg["port"] = int(os.getenv("MODBUS_PORT", cfg.get("port", 502)))
    return cls(site, cfg, now=now)


def make_source_adapter(source: dict, site: str, now=None) -> TagAdapter:
    """Build one adapter from a per-source config pushed by the web console."""
    protocol = source.get("protocol")
    tags = source.get("tags") or []
    conn = source.get("connection") or {}

    def key(t: dict) -> str:
        return f"{site}.{t['path'].replace('/', '.')}"

    if protocol == "sim":
        spec = {}
        for t in tags:
            addr = t.get("address") or {}
            meta = {"behavior": addr.get("behavior", "random_walk"),
                    "initial": addr.get("initial", 0.0),
                    "writable": bool(t.get("writable", False))}
            for k in ("min", "max"):
                if t.get(k) is not None:
                    meta[k] = t[k]
            spec[key(t)] = meta
        return SimAdapter(site, spec, now=now)
    if protocol == "modbus":
        cfg = {k: conn[k] for k in ("host", "port", "unit_id", "request_timeout_ms")
               if k in conn}
        cfg["tags"] = {}
        for t in tags:
            addr = t.get("address")
            if not isinstance(addr, dict):
                raise ValueError(f"modbus tag {t.get('path')!r}: address must be an object")
            cfg["tags"][key(t)] = {
                "type": addr.get("area"), "address": addr,
                "scale": t.get("scale", 1.0), "offset": t.get("offset", 0.0),
                "writable": bool(t.get("writable", False)),
                "min": t.get("min"), "max": t.get("max"),
            }
        return ModbusAdapter(site, cfg, now=now)
    raise ValueError(f"unknown source protocol {protocol!r} (choices: modbus, sim)")
