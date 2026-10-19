"""Derived-tag engine (spec 2026-10-19 §7).

Every stored sample reaches `on_sample` (production/ingest.py). A sample of a
tag that some formula reads marks that formula dirty; a 1 s tick evaluates the
dirty ones and writes the result through the same path as device telemetry, so
a calculated tag has alarms, history, trends and live updates like any other.
That tick is also the throttle: a derived tag is computed at most once a second
however fast its inputs change.

Only one backend instance computes (a session-level advisory lock held on a
dedicated connection); the others keep their index warm and take over if the
leader goes away.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from uuid import UUID

from ..core import config
from ..db.context import active_org_ids, tenant_tx
from ..db.util import utcnow
from .formula import (Compiled, FormulaError, WindowStore, check_variables,
                      combine_quality, compile_formula, evaluate)

log = logging.getLogger("wds.derived")

LEADER_LOCK = 0x57444552  # "WDER"
TICK_S = 1.0
RELOAD_S = 30.0
REFRESH_S = 30.0          # re-evaluate quiet formulas so stale inputs show up
STALE_INPUT_S = config.DERIVED_STALE_S


@dataclass
class Entry:
    tag_id: UUID
    org_id: UUID
    site_id: UUID
    expr: str
    version: int
    inputs: dict            # variable -> input tag id
    compiled: Compiled
    store: WindowStore
    last_eval: float = 0.0


class DerivedEngine:
    def __init__(self, pools, registry, emit):
        """`emit(tag, org_id, site_id, v, q, ts)` writes one sample."""
        self.pools, self.registry, self.emit = pools, registry, emit
        self.entries: dict[UUID, Entry] = {}
        self.users: dict[UUID, set[UUID]] = {}            # input tag -> derived tags
        self.latest: dict[UUID, tuple] = {}               # input tag -> (v, q, ts)
        self.dirty: set[UUID] = set()
        self._conn = None
        self.leader = False
        self._reload_at = 0.0

    # ── index ────────────────────────────────────────────────────────────
    async def reload(self, only: UUID | None = None) -> None:
        """Rebuild the index from tag_formulas — every org, or just `only`
        (after an API change) while keeping the others as they are."""
        entries: dict[UUID, Entry] = (
            {k: v for k, v in self.entries.items() if v.org_id != only} if only else {})
        for org_id in ([only] if only else await active_org_ids(self.pools.system)):
            async with tenant_tx(self.pools.system, org_id) as tc:
                rows = await tc.fetch(
                    "SELECT f.tag_id, t.site_id, f.expr, f.inputs, f.version"
                    " FROM tag_formulas f JOIN tags t ON t.org_id=f.org_id AND t.id=f.tag_id")
                seed_ids: set[UUID] = set()
                for r in rows:
                    e = self._build(org_id, r)
                    if e is not None:
                        entries[e.tag_id] = e
                        seed_ids.update(e.inputs.values())
                missing = [i for i in seed_ids if i not in self.latest]
                if missing:
                    for r in await tc.fetch(
                            "SELECT tag_id, v, q, ts FROM tag_latest WHERE tag_id = ANY($1::uuid[])",
                            missing):
                        self.latest[r["tag_id"]] = (r["v"], r["q"], r["ts"])
        users: dict[UUID, set[UUID]] = {}
        for e in entries.values():
            for tid in e.inputs.values():
                users.setdefault(tid, set()).add(e.tag_id)
        self.entries, self.users = entries, users
        self.dirty &= set(entries)
        if only is None:
            self._reload_at = time.monotonic()

    def _build(self, org_id: UUID, r) -> Entry | None:
        old = self.entries.get(r["tag_id"])
        if old is not None and old.version == r["version"] and old.expr == r["expr"]:
            return old                                    # keep its window state
        try:
            inputs = {k: UUID(v) for k, v in dict(_json(r["inputs"])).items()}
            c = compile_formula(r["expr"])
            check_variables(c, inputs)
        except (FormulaError, ValueError, TypeError):
            log.warning("derived tag has an invalid formula — skipped",
                        extra={"tag": str(r["tag_id"])})
            return None
        return Entry(r["tag_id"], org_id, r["site_id"], r["expr"], r["version"],
                     {k: v for k, v in inputs.items() if k in c.variables}, c,
                     WindowStore(c.windows))

    # ── fan-in ───────────────────────────────────────────────────────────
    def on_sample(self, tag_id: UUID, v, q: str, ts) -> None:
        users = self.users.get(tag_id)
        if not users:
            return
        cur = self.latest.get(tag_id)
        if cur is None or cur[2] <= ts:                   # never let a late replay win
            self.latest[tag_id] = (v, q, ts)
        self.dirty |= users

    # ── evaluation ───────────────────────────────────────────────────────
    def compute(self, e: Entry, now_ts) -> tuple | None:
        """(value, quality) for one entry, or None when an input has no sample yet."""
        env, qs = {}, []
        for var, tid in e.inputs.items():
            cur = self.latest.get(tid)
            if cur is None:
                return None
            v, q, ts = cur
            if isinstance(v, bool):
                env[var] = 1.0 if v else 0.0
            elif isinstance(v, (int, float)):
                env[var] = float(v)
            else:
                qs.append("bad")
                env[var] = 0.0
            stale = (now_ts - ts).total_seconds() > STALE_INPUT_S
            qs.append("stale" if stale and q == "good" else q)
        val = evaluate(e.compiled, env, e.store, now_ts.timestamp())
        q = combine_quality(qs)
        if val is None:
            return (False if e.compiled.is_bool else 0.0), "bad"   # placeholder; quality says why
        return val, q

    async def tick(self) -> int:
        """One pass: evaluate dirty and overdue formulas, emit their samples."""
        if time.monotonic() - self._reload_at > RELOAD_S:
            await self.reload()
        if not await self._lead():
            return 0
        mono = time.monotonic()
        todo = set(self.dirty)
        self.dirty.clear()
        todo |= {i for i, e in self.entries.items() if mono - e.last_eval > REFRESH_S}
        n = 0
        for tid in todo:
            e = self.entries.get(tid)
            tag = self.registry.by_id(tid) if e else None
            if e is None or tag is None:
                continue
            now = utcnow()
            out = self.compute(e, now)
            if out is None:
                continue
            e.last_eval = mono
            try:
                await self.emit(tag, e.org_id, e.site_id, out[0], out[1], now)
                n += 1
            except Exception:  # noqa: BLE001 — one tag must not stop the rest
                log.exception("derived emit failed", extra={"tag": str(tid)})
        return n

    # ── leadership ───────────────────────────────────────────────────────
    async def _lead(self) -> bool:
        try:
            if self._conn is None:
                conn = await self.pools.system.acquire()
                if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", LEADER_LOCK):
                    await self.pools.system.release(conn)
                    self.leader = False
                    return False
                self._conn = conn
            else:
                await self._conn.fetchval("SELECT 1")     # still alive -> still the leader
            self.leader = True
            return True
        except Exception:  # noqa: BLE001 — a dead connection also dropped the lock
            await self._drop()
            return False

    async def _drop(self) -> None:
        conn, self._conn, self.leader = self._conn, None, False
        if conn is not None:
            try:
                await self.pools.system.release(conn)
            except Exception:  # noqa: BLE001
                pass

    async def run_forever(self) -> None:
        try:
            await self.reload()
        except Exception:  # noqa: BLE001
            log.exception("derived reload failed — will retry")
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
            except asyncio.CancelledError:
                await self._drop()
                raise
            except Exception:  # noqa: BLE001
                log.exception("derived tick failed")


def _json(v):
    if isinstance(v, str):
        import json
        return json.loads(v)
    return v
