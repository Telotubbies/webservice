"""Alarm engine (FR-D1/D2) on Postgres.

Safety invariants (tests/INVARIANTS.md):
  I1/I2  only FRESH, GOOD samples may raise or clear an alarm. Bad / stale /
         uncertain quality, or a sample older than ALARM_FRESH_S (backfill
         replay after an outage), means we don't know the process value now —
         it can neither "resolve" a critical alarm nor raise a new one.
Rule kinds: hi/hihi (v > threshold), lo/lolo (v < threshold) with deadband on
clear; stale (no fresh good sample for stale_s) evaluated by a periodic sweep.
One open (active|acked) alarm per rule is enforced by a partial unique index.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

import asyncpg

from . import config
from .db import audit
from .db.context import TenantConn, tenant_tx
from .db.util import iso_z, utcnow

log = logging.getLogger("backend.alarms")

OPEN_STATES = ("active", "acked")


@dataclass(frozen=True)
class Rule:
    id: UUID
    tag_id: UUID
    name: str
    kind: str
    threshold: float | None
    stale_s: int | None
    deadband: float
    severity: str


def triggered(rule: Rule, v: float) -> bool:
    if rule.kind in ("hi", "hihi"):
        return v > rule.threshold
    if rule.kind in ("lo", "lolo"):
        return v < rule.threshold
    return False


def cleared(rule: Rule, v: float) -> bool:
    if rule.kind in ("hi", "hihi"):
        return v <= rule.threshold - rule.deadband
    if rule.kind in ("lo", "lolo"):
        return v >= rule.threshold + rule.deadband
    return True  # stale: any fresh good sample clears


def is_evaluable(q: str, ts: datetime, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return q == "good" and (now - ts).total_seconds() <= config.ALARM_FRESH_S


ALARM_SQL = """
SELECT a.id, a.tag_id, a.rule_id, r.name AS rule, a.severity, a.state, a.raised_at,
       a.acked_at, a.cleared_at, a.version, u.display_name AS acked_by
FROM alarms a JOIN alarm_rules r ON r.id = a.rule_id
LEFT JOIN users u ON u.id = a.acked_by
"""


class AlarmEngine:
    def __init__(self, pools, ws, registry):
        self.pools = pools
        self.ws = ws
        self.registry = registry
        self._rules: dict[UUID, list[Rule]] = {}
        # v4 T8 — engine counters, exported by /metrics + /api/system/health
        self.counters = {"alarms_raised": 0, "alarms_cleared": 0,
                         "alarms_acked": 0}

    async def load_rules(self) -> None:
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            rows = await tc.fetch(
                "SELECT id, tag_id, name, kind, threshold, stale_s, deadband, severity"
                " FROM alarm_rules WHERE enabled")
        by_tag: dict[UUID, list[Rule]] = {}
        for r in rows:
            by_tag.setdefault(r["tag_id"], []).append(Rule(**dict(r)))
        self._rules = by_tag

    # ------------------------------------------------------------ evaluation
    async def evaluate(self, tc: TenantConn, tag_id: UUID, v, q: str, ts: datetime) -> None:
        if not is_evaluable(q, ts):
            return
        rules = self._rules.get(tag_id)
        if not rules:
            return
        numeric = isinstance(v, (int, float)) and not isinstance(v, bool)
        for rule in rules:
            open_row = await tc.fetchrow(
                "SELECT id FROM alarms WHERE rule_id=$1 AND state = ANY($2::text[])",
                rule.id, list(OPEN_STATES))
            if rule.kind == "stale":
                if open_row is not None:
                    await self._clear(tc, open_row["id"], rule)
                continue
            if not numeric:
                continue
            if open_row is None and triggered(rule, float(v)):
                await self._raise(tc, rule, ts)
            elif open_row is not None and cleared(rule, float(v)):
                await self._clear(tc, open_row["id"], rule)

    async def sweep_stale(self) -> None:
        """Raise `stale` rules whose tag has no fresh good sample within stale_s."""
        now = utcnow()
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            for rules in self._rules.values():
                for rule in (r for r in rules if r.kind == "stale"):
                    last = await tc.fetchval(
                        "SELECT max(ts) FROM tag_history WHERE tag_id=$1 AND q='good'"
                        " AND ts > $2", rule.tag_id, now - timedelta(seconds=rule.stale_s))
                    if last is not None:
                        continue
                    exists = await tc.fetchval(
                        "SELECT 1 FROM alarms WHERE rule_id=$1 AND state = ANY($2::text[])",
                        rule.id, list(OPEN_STATES))
                    if not exists:
                        await self._raise(tc, rule, now)

    async def _raise(self, tc: TenantConn, rule: Rule, ts: datetime) -> None:
        try:
            async with tc.conn.transaction():  # savepoint: losing the race is fine
                aid = await tc.fetchval(
                    "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state, raised_at)"
                    " VALUES ($1,$2,$3,$4,'active',$5) RETURNING id",
                    tc.org_id, rule.tag_id, rule.id, rule.severity, ts)
        except asyncpg.UniqueViolationError:
            return
        await audit.append(tc, "alarm-engine", "alarm.raise",
                           {"alarm_id": str(aid), "tag_id": str(rule.tag_id)}, {"rule": rule.name})
        alarm = await self._serialize(tc, aid)
        self.counters["alarms_raised"] += 1
        log.warning("alarm raised", extra={"alarm_id": str(aid), "rule": rule.name})
        self.ws.broadcast({"type": "alarm", **alarm})

    async def _clear(self, tc: TenantConn, alarm_id: UUID, rule: Rule) -> None:
        n = await tc.execute(
            "UPDATE alarms SET state='cleared', cleared_at=now(), version=version+1"
            " WHERE id=$1 AND state = ANY($2::text[])", alarm_id, list(OPEN_STATES))
        if n == "UPDATE 0":
            return
        await audit.append(tc, "alarm-engine", "alarm.clear",
                           {"alarm_id": str(alarm_id), "tag_id": str(rule.tag_id)},
                           {"rule": rule.name})
        self.counters["alarms_cleared"] += 1
        self.ws.broadcast({"type": "alarm_update", **await self._serialize(tc, alarm_id)})

    # ------------------------------------------------------------ API side
    async def list_alarms(self, tc: TenantConn, state: str | None, severity: str | None,
                          limit: int) -> list[dict]:
        rows = await tc.fetch(
            ALARM_SQL + " WHERE ($1::text IS NULL OR a.state=$1)"
            " AND ($2::text IS NULL OR a.severity=$2) ORDER BY a.raised_at DESC LIMIT $3",
            state, severity, limit)
        return [self._v1(r) for r in rows]

    async def ack(self, tc: TenantConn, alarm_id: UUID, user_id: UUID, actor: str) -> dict | None:
        row = await tc.fetchrow("SELECT id, tag_id, state FROM alarms WHERE id=$1", alarm_id)
        if row is None:
            return None
        if row["state"] == "active":
            await tc.execute(
                "UPDATE alarms SET state='acked', acked_at=now(), acked_by=$2, version=version+1"
                " WHERE id=$1 AND state='active'", alarm_id, user_id)
            await audit.append(tc, actor, "alarm.ack",
                               {"alarm_id": str(alarm_id), "tag_id": str(row["tag_id"])})
            self.counters["alarms_acked"] += 1
            alarm = await self._serialize(tc, alarm_id)
            self.ws.broadcast({"type": "alarm_update", **alarm})
            return alarm
        return await self._serialize(tc, alarm_id)

    async def _serialize(self, tc: TenantConn, alarm_id: UUID) -> dict:
        return self._v1(await tc.fetchrow(ALARM_SQL + " WHERE a.id=$1", alarm_id))

    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            "tag": tag.v1_name if tag else str(r["tag_id"]),
            "rule": r["rule"],
            "severity": r["severity"],
            "state": r["state"],
            "ts": iso_z(r["raised_at"]),
            "acked_by": r["acked_by"],
            "version": r["version"],
        }
