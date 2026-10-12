"""Command lifecycle on Postgres — v2 statuses (doc 16 §3), v1 transport.

Phase-2 scope: same dispatch path as v1 (publish directly after commit); the
transactional outbox + PUBACK-confirmed `dispatched` replace it in phase 4.

  accepted ─publish ok→ dispatched ─edge resp→ acknowledged | rejected | failed
      │                     └──── no resp by ttl ───────────→ timeout
      └─ publish error → failed(dispatch_error)

Invariants kept: I7 no automatic retry of writes, I8 one in-flight command per
tag (partial unique index), I9 restart sweep never leaves a tag bricked.
Every transition: command_events row + audit row + WS broadcast.
"""

from __future__ import annotations

import asyncio
import logging
import math
import uuid
from uuid import UUID

import asyncpg

from . import config
from .db import audit
from .db.context import TenantConn, tenant_tx
from .db.util import iso_z, utcnow

log = logging.getLogger("backend.commands")

INFLIGHT = ("accepted", "dispatched")
TERMINAL = ("acknowledged", "rejected", "failed", "timeout")
# edge v1 response vocabulary -> v2 status
RESP_MAP = {"done": "acknowledged", "denied": "rejected", "error": "failed"}
# v2 -> v1 wire names (CONTRACT.md) for the v1 API / WS shim
V1_STATUS = {"accepted": "issued", "dispatched": "sent", "acknowledged": "done",
             "rejected": "denied", "failed": "failed", "timeout": "timeout"}

CMD_SQL = """
SELECT c.id, c.tag_id, c.value, c.status, c.reason, c.idempotency_key, c.ttl_s,
       c.issued_at, c.updated_at, c.version, u.display_name AS actor_name
FROM commands c JOIN users u ON u.id = c.actor_user_id
"""


class CommandManager:
    def __init__(self, pools, ws, mqtt_bridge, registry, cmd_limiter=None):
        self.pools = pools
        self.ws = ws
        self.mqtt = mqtt_bridge
        self.registry = registry
        self.cmd_limiter = cmd_limiter  # RateLimiter | None (per user+tag)
        self._timers: dict[UUID, asyncio.Task] = {}

    # ---------------------------------------------------------------- issue
    async def issue(self, *, tag_name: str, value, ttl_s: int,
                    idempotency_key: str | None, user_id: UUID) -> tuple[int, dict]:
        tag = self.registry.by_v1_name(tag_name)
        org = config.V1_ORG_ID
        async with tenant_tx(self.pools.app, org, user_id) as tc:
            if idempotency_key:
                row = await tc.fetchrow(
                    "SELECT id, status FROM commands WHERE actor_user_id=$1 AND idempotency_key=$2",
                    user_id, idempotency_key)
                if row is not None:
                    return 200, {"command_id": str(row["id"]),
                                 "status": V1_STATUS[row["status"]], "replayed": True}
            if tag is None or tag.edge_id is None:
                # v1 contract: unknown tag is decided by the edge (not_writable)
                # — but with no tag row there is nothing to reference. Reject.
                return 404, {"detail": "unknown_tag"}
            active = await tc.fetchval(
                "SELECT id FROM commands WHERE tag_id=$1 AND status = ANY($2::text[])",
                tag.id, list(INFLIGHT))
            if active is not None:
                return 409, {"detail": "command_in_flight", "active_command_id": str(active)}
            if self.cmd_limiter is not None:
                # Doc 16 gate 7 — deliberately run AFTER gate 8's in-flight
                # check: a 409 retry must not burn the caller's command
                # budget, or one in-flight command plus a few retries would
                # starve the tag into 429s until timeout (v4 T4). Only the
                # create path spends a token — replays and 409s are free.
                if not await self.cmd_limiter.allow(f"{user_id}:{tag.id}"):
                    retry = await self.cmd_limiter.retry_after(f"{user_id}:{tag.id}")
                    return 429, {"detail": "rate_limited",
                                 "retry_after_s": max(1, math.ceil(retry))}
            cid = uuid.uuid4()
            now = utcnow()
            try:
                async with tc.conn.transaction():  # savepoint for the race path
                    await tc.execute(
                        "INSERT INTO commands(id, org_id, site_id, edge_id, tag_id, value, status,"
                        "  ttl_s, idempotency_key, actor_user_id, issued_at, updated_at)"
                        " VALUES ($1,$2,$3,$4,$5,$6,'accepted',$7,$8,$9,$10,$10)",
                        cid, org, config.V1_SITE_ID, tag.edge_id, tag.id, value, ttl_s,
                        idempotency_key, user_id, now)
            except asyncpg.UniqueViolationError:
                active = await tc.fetchval(
                    "SELECT id FROM commands WHERE tag_id=$1 AND status = ANY($2::text[])",
                    tag.id, list(INFLIGHT))
                # lost the race — the burn above didn't create a command,
                # so hand the token back before returning 409/200-replay
                if self.cmd_limiter is not None:
                    await self.cmd_limiter.refund(f"{user_id}:{tag.id}")
                if active is None and idempotency_key:  # lost an idempotency race
                    row = await tc.fetchrow(
                        "SELECT id, status FROM commands WHERE actor_user_id=$1"
                        " AND idempotency_key=$2", user_id, idempotency_key)
                    return 200, {"command_id": str(row["id"]),
                                 "status": V1_STATUS[row["status"]], "replayed": True}
                return 409, {"detail": "command_in_flight",
                             "active_command_id": str(active) if active else None}
            await self._record(tc, cid, None, "accepted", f"user:{user_id}", None)
        await self._broadcast(cid)

        payload = {"command_id": str(cid), "tag": tag.v1_name, "value": value,
                   "issued_at": iso_z(now), "ttl_s": ttl_s,
                   "idempotency_key": idempotency_key, "user": str(user_id)}
        if self.mqtt.publish_command(str(cid), payload):
            await self.transition(cid, "dispatched", None, "relay")
        else:
            await self.transition(cid, "failed", "dispatch_error", "relay")
        self._timers[cid] = asyncio.create_task(self._watch(cid, ttl_s))
        status = await self._status(cid)
        return 201, {"command_id": str(cid), "status": V1_STATUS[status]}

    # ----------------------------------------------------- responses / ttl
    async def handle_response(self, command_id: str, status: str, detail: str | None) -> None:
        new = RESP_MAP.get(status)
        if new is None:
            return  # interim v1 "acked" or unknown — not a lifecycle transition
        try:
            cid = UUID(command_id)
        except ValueError:
            log.warning("cmd-resp with non-uuid id", extra={"command_id": command_id})
            return
        await self.transition(cid, new, detail, f"edge:{config.V1_EDGE_ID}")

    async def _watch(self, cid: UUID, ttl_s: int) -> None:
        try:
            await asyncio.sleep(ttl_s + 2)  # doc 16 §3: ttl + 2 s grace
            await self.transition(cid, "timeout", f"no response within ttl_s={ttl_s}", "sweeper")
        except asyncio.CancelledError:
            pass
        finally:
            self._timers.pop(cid, None)

    async def transition(self, cid: UUID, new: str, reason: str | None, actor: str) -> bool:
        """Guarded: only in-flight rows move; terminal states never change.
        A response after timeout/terminal is recorded as an event only."""
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            row = await tc.fetchrow(
                "UPDATE commands c SET status=$2, reason=COALESCE($3, c.reason),"
                " updated_at=now(), version=c.version+1"
                " FROM commands old WHERE c.id=$1 AND old.id=c.id"
                "  AND c.status = ANY($4::text[]) RETURNING old.status AS prev",
                cid, new, reason, list(INFLIGHT))
            if row is None:
                exists = await tc.fetchval("SELECT status FROM commands WHERE id=$1", cid)
                if exists in TERMINAL and actor.startswith("edge:"):
                    kind = "late_response" if exists == "timeout" else "duplicate_response"
                    await tc.execute(
                        "INSERT INTO command_events(org_id, command_id, from_status, to_status,"
                        " actor, reason) VALUES ($1,$2,$3,$4,$5,$6)",
                        tc.org_id, cid, exists, exists, actor, f"{kind}:{new}:{reason or ''}")
                return False
            await self._record(tc, cid, row["prev"], new, actor, reason)
        if new in TERMINAL:
            t = self._timers.pop(cid, None)
            if t and t is not asyncio.current_task():
                t.cancel()
        await self._broadcast(cid)
        return True

    async def _record(self, tc: TenantConn, cid: UUID, prev: str | None, new: str,
                      actor: str, reason: str | None) -> None:
        await tc.execute(
            "INSERT INTO command_events(org_id, command_id, from_status, to_status, actor, reason)"
            " VALUES ($1,$2,$3,$4,$5,$6)", tc.org_id, cid, prev, new, actor, reason)
        cmd = await tc.fetchrow("SELECT tag_id, value, idempotency_key FROM commands WHERE id=$1",
                                cid)
        await audit.append(tc, actor, f"command.{new}",
                           {"command_id": str(cid), "tag_id": str(cmd["tag_id"])},
                           {"value": cmd["value"], "reason": reason,
                            "idempotency_key": cmd["idempotency_key"]})

    async def _status(self, cid: UUID) -> str:
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            return await tc.fetchval("SELECT status FROM commands WHERE id=$1", cid)

    async def _broadcast(self, cid: UUID) -> None:
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            r = await tc.fetchrow(CMD_SQL + " WHERE c.id=$1", cid)
        cmd = self._v1(r)
        event = {"type": "command", "command_id": cmd["id"], "status": cmd["status"],
                 "tag": cmd["tag"]}
        if cmd["detail"]:
            event["detail"] = cmd["detail"]
        self.ws.broadcast(event)

    # -------------------------------------------------------------- queries
    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            "tag": tag.v1_name if tag else str(r["tag_id"]),
            "value": r["value"],
            "status": V1_STATUS[r["status"]],
            "detail": r["reason"],
            "idempotency_key": r["idempotency_key"],
            "user": r["actor_name"],
            "created_at": iso_z(r["issued_at"]),
            "updated_at": iso_z(r["updated_at"]),
        }

    async def get(self, tc: TenantConn, cid: UUID) -> dict | None:
        r = await tc.fetchrow(CMD_SQL + " WHERE c.id=$1", cid)
        return self._v1(r) if r else None

    async def list(self, tc: TenantConn, limit: int, tag_name: str | None,
                   user_name: str | None) -> list[dict]:
        tag = self.registry.by_v1_name(tag_name) if tag_name else None
        if tag_name and tag is None:
            return []
        rows = await tc.fetch(
            CMD_SQL + " WHERE ($1::uuid IS NULL OR c.tag_id=$1)"
            " AND ($2::text IS NULL OR u.display_name=$2) ORDER BY c.issued_at DESC LIMIT $3",
            tag.id if tag else None, user_name, limit)
        return [self._v1(r) for r in rows]

    async def shutdown(self) -> None:
        for t in list(self._timers.values()):
            t.cancel()
        self._timers.clear()

    async def sweep_interrupted(self) -> int:
        """I9: no in-flight row may survive a restart (its timer died with the
        process) — otherwise the tag is bricked with 409s."""
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            rows = await tc.fetch(
                "SELECT id, status FROM commands WHERE status = ANY($1::text[])", list(INFLIGHT))
        for r in rows:
            await self.transition(r["id"], "failed", "interrupted_by_restart", "sweeper")
            log.warning("swept interrupted command", extra={"command_id": str(r["id"])})
        return len(rows)
