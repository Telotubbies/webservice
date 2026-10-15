"""Adapter factory — picks and configures the TagAdapter from env + tags.yaml."""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from .base import TagAdapter
from .sim import SimAdapter
from .modbus import ModbusAdapter

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
