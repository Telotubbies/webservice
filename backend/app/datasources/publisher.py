"""Edge config delivery (spec 5.4): backend -> edge over MQTT.

  backend -> edge  v2/{org}/{site}/{edge}/cfg      full config, QoS1, retain=False
  edge -> backend  .../cfg-req  {"have_version": int|null}
  edge -> backend  .../cfg-ack  {"version", "ok", "errors":[{source_id|tag_id, detail}]}

Pure helpers (`cfg_payload`, `parse_cfg_req`, `parse_cfg_ack`) carry the wire
rules; `CfgPublisher` does the DB/MQTT plumbing. Secrets are opened only to
build the payload and are never logged.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from uuid import UUID

from ..db.context import tenant_tx
from . import secretbox
from .routes import _TAG_SELECT, CFG_CHANNEL, _tag_json

log = logging.getLogger("wds.cfgpub")

MAX_ERR_DETAIL = 300
MAX_ERRORS = 100
ERR_SUMMARY_MAX = 500


def cfg_topic(org_id, site_id, edge_id, leaf: str = "cfg") -> str:
    return f"v2/{org_id}/{site_id}/{edge_id}/{leaf}"


# ------------------------------------------------------------------- pure
def cfg_payload(version: int, sources: list[dict], tags_by_source: dict[str, list[dict]]) -> dict:
    """`sources`: rows as dicts (id, protocol, connection, poll_ms, enabled,
    secrets = opened dict|None). `tags_by_source`: `_tag_json`-shaped dicts."""
    out = []
    for s in sources:
        if not s["enabled"]:
            continue
        sid = str(s["id"])
        out.append({
            "id": sid, "protocol": s["protocol"], "connection": s["connection"],
            "secrets": s.get("secrets") or None, "poll_ms": s["poll_ms"], "enabled": True,
            "tags": [{
                "id": t["id"], "path": t["path"], "type": t["type"],
                "address": t["address"], "scale": t["scale"], "offset": t["offset"],
                "writable": t["writable"], "min": t["min"], "max": t["max"],
            } for t in tags_by_source.get(sid, [])],
        })
    return {"version": int(version), "sources": out}


def parse_cfg_req(raw) -> tuple[bool, int | None]:
    """-> (valid, have_version). Anything but an object with null/int
    have_version is invalid; a missing key counts as null."""
    if not isinstance(raw, dict):
        return False, None
    hv = raw.get("have_version")
    if hv is None:
        return True, None
    if isinstance(hv, int) and not isinstance(hv, bool):
        return True, hv
    return False, None


def stale_publish(version: int, last_sent: int | None) -> bool:
    """True when publishing `version` would regress what was already sent."""
    return last_sent is not None and version < last_sent


def should_send(have_version: int | None, current: int) -> bool:
    return have_version is None or have_version < current


@dataclass(frozen=True)
class Ack:
    version: int
    ok: bool
    errors: tuple  # of (source_id | None, tag_id | None, detail)

    @property
    def error_source_ids(self) -> set[str]:
        return {s for s, _t, _d in self.errors if s}

    def summary(self) -> str | None:
        if self.ok and not self.errors:
            return None
        parts = []
        for s, t, d in self.errors:
            who = f"source {s}" if s else (f"tag {t}" if t else "config")
            parts.append(f"{who}: {d}")
        text = "; ".join(parts) or "edge reported failure"
        return text[:ERR_SUMMARY_MAX]

    def source_detail(self, source_id: str) -> str:
        text = "; ".join(d for s, _t, d in self.errors if s == source_id)
        return text[:ERR_SUMMARY_MAX] or "error"


def _str(v, limit: int) -> str | None:
    return v[:limit] if isinstance(v, str) and v else None


def parse_cfg_ack(raw) -> Ack | None:
    """Defensive parse; None when malformed."""
    if not isinstance(raw, dict):
        return None
    ver, ok = raw.get("version"), raw.get("ok")
    if not isinstance(ver, int) or isinstance(ver, bool) or ver < 0:
        return None
    if not isinstance(ok, bool):
        return None
    raw_errs = raw.get("errors")
    if raw_errs is not None and not isinstance(raw_errs, list):
        return None
    errs = []
    for e in (raw_errs or [])[:MAX_ERRORS]:
        if not isinstance(e, dict):
            continue
        errs.append((_str(e.get("source_id"), 64), _str(e.get("tag_id"), 64),
                     _str(e.get("detail"), MAX_ERR_DETAIL) or "error"))
    return Ack(ver, ok, tuple(errs))


# --------------------------------------------------------------------- db
async def build_cfg(pool, org_id: UUID, edge_id: UUID) -> dict:
    """Full config for one edge. Runs at READ COMMITTED (tenant_tx has already
    issued a query, so the isolation level cannot be raised), and the version
    is read first: data can only be newer than the label, never older, and the
    newer bump's own NOTIFY re-publishes. `pool` must be the system pool."""
    async with tenant_tx(pool, org_id) as tc:
        version = await tc.fetchval(
            "SELECT config_version FROM edges WHERE id=$1", edge_id)
        srcs = await tc.fetch(
            "SELECT * FROM data_sources WHERE edge_id=$1 AND enabled ORDER BY name", edge_id)
        trows = await tc.fetch(
            _TAG_SELECT + " WHERE t.edge_id=$1 AND t.source_id IS NOT NULL ORDER BY t.path",
            edge_id)
    by_src: dict[str, list[dict]] = {}
    for r in trows:
        t = _tag_json(r)
        by_src.setdefault(t["source_id"], []).append(t)
    sources = []
    for r in srcs:
        d = dict(r)
        d["secrets"] = secretbox.open_(r["secret_enc"]) if r["secret_enc"] else None
        sources.append(d)
    return cfg_payload(version or 0, sources, by_src)


class CfgPublisher:
    def __init__(self, pools, mqtt, registry):
        self.pools = pools
        self.mqtt = mqtt
        self.registry = registry
        self._sent: dict[UUID, int] = {}  # edge -> last version published
        self._locks: dict[UUID, asyncio.Lock] = {}

    async def publish_edge(self, org_id: UUID, site_id: UUID, edge_id: UUID) -> bool:
        # serialize build+publish per edge: a slower, older build must not be
        # published after a newer one
        async with self._locks.setdefault(edge_id, asyncio.Lock()):
            cfg = await build_cfg(self.pools.system, org_id, edge_id)
            if stale_publish(cfg["version"], self._sent.get(edge_id)):
                return False
            ok = self.mqtt.publish_cfg(cfg_topic(org_id, site_id, edge_id), cfg)
            if ok:
                self._sent[edge_id] = cfg["version"]
                log.info("cfg published", extra={
                    "edge_id": str(edge_id), "version": cfg["version"],
                    "sources": len(cfg["sources"])})
            return ok

    async def publish_edge_id(self, edge_id: UUID) -> None:
        edge = self.registry.edge(edge_id)
        if edge is None:
            await self.registry.refresh()
            edge = self.registry.edge(edge_id)
        if edge is None or edge.status != "active":
            return
        await self.publish_edge(edge.org_id, edge.site_id, edge.id)

    async def resync(self) -> None:
        """Publish every active edge whose config changed since we last
        published it (all of them after a restart)."""
        await self.registry.refresh()
        for edge in self.registry.edges():
            if edge.status != "active":
                continue
            try:
                async with tenant_tx(self.pools.system, edge.org_id) as tc:
                    cur = await tc.fetchval(
                        "SELECT config_version FROM edges WHERE id=$1", edge.id)
                if self._sent.get(edge.id) != cur:
                    await self.publish_edge(edge.org_id, edge.site_id, edge.id)
            except Exception:  # noqa: BLE001
                log.exception("cfg resync failed", extra={"edge_id": str(edge.id)})

    async def on_request(self, edge, have_version: int | None) -> None:
        async with tenant_tx(self.pools.system, edge.org_id) as tc:
            cur = await tc.fetchval("SELECT config_version FROM edges WHERE id=$1", edge.id)
        if cur is None or not should_send(have_version, cur):
            return
        await self.publish_edge(edge.org_id, edge.site_id, edge.id)

    async def on_ack(self, edge, payload) -> None:
        ack = parse_cfg_ack(payload)
        if ack is None:
            log.warning("bad cfg-ack payload", extra={"edge_id": str(edge.id)})
            return
        async with tenant_tx(self.pools.system, edge.org_id) as tc:
            row = await tc.fetchrow(
                "SELECT config_version, config_applied FROM edges WHERE id=$1 FOR UPDATE",
                edge.id)
            if row is None or ack.version > row["config_version"]:
                log.warning("cfg-ack for future version ignored",
                            extra={"edge_id": str(edge.id), "version": ack.version})
                return
            applied = row["config_applied"]
            if applied is None or ack.version > applied:
                await tc.execute(
                    "UPDATE edges SET config_applied=$2, config_error=$3 WHERE id=$1",
                    edge.id, ack.version, ack.summary())
            elif ack.version == applied:
                await tc.execute("UPDATE edges SET config_error=$2 WHERE id=$1",
                                 edge.id, ack.summary())
            # per-source status only when the ack covers the current config
            if ack.version == row["config_version"]:
                bad = ack.error_source_ids
                srcs = await tc.fetch(
                    "SELECT id FROM data_sources WHERE edge_id=$1 AND enabled", edge.id)
                for s in srcs:
                    sid = str(s["id"])
                    if sid in bad:
                        await tc.execute(
                            "UPDATE data_sources SET status='error', status_detail=$2,"
                            " status_at=now() WHERE id=$1", s["id"], ack.source_detail(sid))
                    else:
                        await tc.execute(
                            "UPDATE data_sources SET status='ok', status_detail=NULL,"
                            " status_at=now() WHERE id=$1", s["id"])

    async def start(self) -> None:
        """LISTEN wds_cfg (edge id payload) -> publish. Reconnects forever;
        a full resync follows every (re)subscribe so NOTIFYs lost while the
        socket was down are recovered."""
        pending: set[UUID] = set()
        wake = asyncio.Event()

        def kick(_c, _pid, _ch, payload):
            try:
                pending.add(UUID(payload))
            except ValueError:
                return
            wake.set()

        while True:
            conn = None
            try:
                conn = await self.pools.system.acquire()
                await conn.add_listener(CFG_CHANNEL, kick)
                log.info("wds_cfg listener connected")
                await self.resync()
                while not conn.is_closed():
                    try:
                        await asyncio.wait_for(wake.wait(), timeout=30)
                    except asyncio.TimeoutError:
                        continue
                    wake.clear()
                    batch = list(pending)
                    pending.clear()
                    for eid in batch:
                        try:
                            await self.publish_edge_id(eid)
                        except Exception:  # noqa: BLE001
                            log.exception("cfg publish failed",
                                          extra={"edge_id": str(eid)})
                raise ConnectionError("wds_cfg listener connection closed")
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("wds_cfg listener down - retrying in 5s")
                await asyncio.sleep(5)
            finally:
                if conn is not None:
                    with contextlib.suppress(Exception):
                        await self.pools.system.release(conn)


__all__ = ["CfgPublisher", "build_cfg", "cfg_payload", "cfg_topic",
           "parse_cfg_ack", "parse_cfg_req", "should_send"]
