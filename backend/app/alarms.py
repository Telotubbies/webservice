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
from .db.context import TenantConn, active_org_ids, tenant_tx
from .db.util import iso_z, utcnow

log = logging.getLogger("backend.alarms")

OPEN_STATES = ("active", "acked")


@dataclass(frozen=True)
class Rule:
    id: UUID
    org_id: UUID
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
        """Every org's enabled rules (v4 T9): the system role enumerates live
        orgs, then reads each tenant inside its own tenant_tx."""
        by_tag: dict[UUID, list[Rule]] = {}
        for org_id in await active_org_ids(self.pools.system):
            async with tenant_tx(self.pools.system, org_id) as tc:
                rows = await tc.fetch(
                    "SELECT id, tag_id, name, kind, threshold, stale_s,"
                    " deadband, severity FROM alarm_rules WHERE enabled")
            for r in rows:
                by_tag.setdefault(r["tag_id"], []).append(
                    Rule(org_id=org_id, **dict(r)))
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
        """Raise `stale` rules whose tag has no fresh good sample within
        stale_s — per-org: each tenant's rules run inside that org's
        tenant_tx (v4 T9)."""
        now = utcnow()
        by_org: dict[UUID, list[Rule]] = {}
        for rules in self._rules.values():
            for rule in (r for r in rules if r.kind == "stale"):
                by_org.setdefault(rule.org_id, []).append(rule)
        for org_id, stale_rules in by_org.items():
            async with tenant_tx(self.pools.system, org_id) as tc:
                for rule in stale_rules:
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
        # ids ride along for the v2 wire; `tag` keeps the v1 display name
        self.ws.broadcast({"type": "alarm", **alarm,
                           "org_id": str(tc.org_id),
                           "tag_id": str(rule.tag_id)},
                          org_id=tc.org_id)

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
        alarm = await self._serialize(tc, alarm_id)
        self.ws.broadcast({"type": "alarm_update", **alarm,
                           "org_id": str(tc.org_id),
                           "tag_id": str(rule.tag_id)},
                          org_id=tc.org_id)

    # ------------------------------------------------------------ API side
    async def list_alarms(self, tc: TenantConn, state: str | None, severity: str | None,
                          limit: int, site_id: UUID | None = None) -> list[dict]:
        rows = await tc.fetch(
            ALARM_SQL + " WHERE ($1::text IS NULL OR a.state=$1)"
            " AND ($2::text IS NULL OR a.severity=$2)"
            " AND ($4::uuid IS NULL OR a.tag_id IN"
            "      (SELECT id FROM tags WHERE site_id=$4))"
            " ORDER BY a.raised_at DESC LIMIT $3",
            state, severity, limit, site_id)
        return [self._v1(r) for r in rows]

    async def ack(self, tc: TenantConn, alarm_id: UUID, user_id: UUID,
                  actor: str, site_id: UUID | None = None) -> dict | None:
        # site_id scopes the v2 route (CONTRACT.v2): an alarm id outside the
        # path site is 404-invisible — the same oracle-free rule as RLS.
        row = await tc.fetchrow(
            "SELECT id, tag_id, state FROM alarms WHERE id=$1"
            " AND ($2::uuid IS NULL OR tag_id IN"
            "      (SELECT id FROM tags WHERE site_id=$2))",
            alarm_id, site_id)
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
            self.ws.broadcast({"type": "alarm_update", **alarm,
                               "org_id": str(tc.org_id),
                               "tag_id": str(row["tag_id"])},
                              org_id=tc.org_id)
            return alarm
        return await self._serialize(tc, alarm_id)

    async def list_alarms_v2(self, tc: TenantConn, site_id: UUID,
                             state: str | None, severity: str | None,
                             limit: int) -> list[dict]:
        """CONTRACT.v2 §4 Alarm shape, scoped to one site."""
        rows = await tc.fetch(
            ALARM_SQL + " WHERE ($1::text IS NULL OR a.state=$1)"
            " AND ($2::text IS NULL OR a.severity=$2)"
            " AND a.tag_id IN (SELECT id FROM tags WHERE site_id=$4)"
            " ORDER BY a.raised_at DESC LIMIT $3",
            state, severity, limit, site_id)
        return [self._v2(r) for r in rows]

    async def _serialize(self, tc: TenantConn, alarm_id: UUID) -> dict:
        return self._v1(await tc.fetchrow(ALARM_SQL + " WHERE a.id=$1", alarm_id))

    async def _serialize_v2(self, tc: TenantConn, alarm_id: UUID) -> dict | None:
        r = await tc.fetchrow(ALARM_SQL + " WHERE a.id=$1", alarm_id)
        return self._v2(r) if r else None

    def _v2(self, r) -> dict:
        """CONTRACT.v2 §4 Alarm — ids, not display names."""
        return {
            "id": str(r["id"]),
            "tag_id": str(r["tag_id"]),
            "rule_id": str(r["rule_id"]),
            "rule": r["rule"],                  # display convenience
            "severity": r["severity"],
            "state": r["state"],
            "raised_at": iso_z(r["raised_at"]),
            "acked_at": iso_z(r["acked_at"]) if r["acked_at"] else None,
            "acked_by": r["acked_by"],
            "cleared_at": iso_z(r["cleared_at"]) if r["cleared_at"] else None,
            "version": r["version"],
        }

    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            # real site code, not the shim prefix — the same WS stream may
            # carry another org's alarms to a multi-org member (v4 T9)
            "tag": self.registry.display_name(tag) if tag else str(r["tag_id"]),
            "rule": r["rule"],
            "severity": r["severity"],
            "state": r["state"],
            "ts": iso_z(r["raised_at"]),
            "acked_by": r["acked_by"],
            "version": r["version"],
        }
