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

from ..core import config
from ..db import audit
from ..db.context import TenantConn, active_org_ids, tenant_tx
from ..db.util import iso_z, utcnow
from ..plant.hierarchy import area_allowed
from .mqtt_client import command_topic

log = logging.getLogger("backend.commands")

INFLIGHT = ("accepted", "dispatched")
TERMINAL = ("acknowledged", "rejected", "failed", "timeout")
# doc 17 wire vocabulary is already the v2 one (edge emits these verbatim)
RESP_MAP = {"acknowledged": "acknowledged", "rejected": "rejected",
            "failed": "failed"}
# v2 -> v1 wire names (CONTRACT.md) for the v1 API / WS shim
V1_STATUS = {"accepted": "issued", "dispatched": "sent", "acknowledged": "done",
             "rejected": "denied", "failed": "failed", "timeout": "timeout"}

CMD_SQL = """
SELECT c.id, c.org_id, c.site_id, c.tag_id, c.value, c.status, c.reason,
       c.idempotency_key, c.ttl_s, c.note, c.issued_at, c.updated_at, c.version,
       c.actor_user_id, u.display_name AS actor_name
FROM commands c JOIN users u ON u.id = c.actor_user_id
"""

EVENT_SQL = """
SELECT from_status, to_status, actor, reason, at
FROM command_events WHERE command_id=$1 ORDER BY id
"""


def _uuid_str(v) -> str | None:
    return str(v) if v is not None else None


class CommandManager:
    def __init__(self, pools, ws, mqtt_bridge, registry, cmd_limiter=None):
        self.pools = pools
        self.ws = ws
        self.mqtt = mqtt_bridge
        self.registry = registry
        self.cmd_limiter = cmd_limiter  # RateLimiter | None (per user+tag)
        self._timers: dict[UUID, asyncio.Task] = {}
        # read-only edge ops (test_source / browse): in-memory only, never a
        # `commands` row. request id -> (edge_id, future)
        self._pending_ops: dict[str, tuple[UUID, asyncio.Future]] = {}

    # ---------------------------------------------------------------- issue
    async def issue(self, *, tag, org_id: UUID, site_id: UUID, value,
                    ttl_s: int, idempotency_key: str | None, user_id: UUID,
                    note: str | None = None) -> tuple[int, dict]:
        """Issue a command. `tag` is a resolved registry.Tag for the path's
        org+site (None → v1 `unknown_tag` 404). `org_id`/`site_id` come from
        the RESOLVED ROUTE (v2 path ids / v1 shim constants) — never from the
        request body (ADR-13 §1)."""
        async with tenant_tx(self.pools.app, org_id, user_id) as tc:
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
            if not await area_allowed(tc, user_id, tag.id):
                return 403, {"detail": "area_forbidden"}
            site_id = tag.site_id  # composite FK pins tag to its own site
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
                        "  ttl_s, idempotency_key, note, actor_user_id, issued_at, updated_at)"
                        " VALUES ($1,$2,$3,$4,$5,$6,'accepted',$7,$8,$9,$10,$11,$11)",
                        cid, org_id, site_id, tag.edge_id, tag.id, value, ttl_s,
                        idempotency_key, note, user_id, now)
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
        await self._broadcast(cid, org_id)

        # doc 17 §1: commands ride v2/{org}/{site}/{edge}/cmd/{command_id};
        # CONTRACT.v2 §6 payload carries tag_path (path within the site).
        edge = self.registry.edge(tag.edge_id)
        payload = {"command_id": str(cid), "tag_path": tag.path, "value": value,
                   "issued_at": iso_z(now), "ttl_s": ttl_s,
                   "idempotency_key": idempotency_key, "user": str(user_id)}
        if edge is not None and self.mqtt.publish_command(
                command_topic(edge.org_id, edge.site_id, edge.id, str(cid)),
                payload):
            await self.transition(cid, "dispatched", None, "relay", org_id)
        else:
            await self.transition(cid, "failed", "dispatch_error", "relay",
                                  org_id)
        self._timers[cid] = asyncio.create_task(self._watch(cid, ttl_s, org_id))
        status = await self._status(cid, org_id)
        return 201, {"command_id": str(cid), "status": V1_STATUS[status]}

    # ------------------------------------------------------- edge ops (RPC)
    async def request_op(self, org_id: UUID, site_id: UUID, edge_id: UUID,
                         op: str, payload: dict, timeout_s: float = 10) -> dict:
        """Ask the edge to run a read-only op and wait for its cmd-resp.
        Returns the edge's `result`; raises TimeoutError if the edge is
        unknown/offline/silent, RuntimeError(reason) if the edge reports failure."""
        rid = str(uuid.uuid4())
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending_ops[rid] = (edge_id, fut)
        try:
            body = {**payload, "command_id": rid, "op": op,
                    "issued_at": iso_z(utcnow()),
                    "ttl_s": max(1, math.ceil(timeout_s))}
            if not self.mqtt.publish_command(
                    command_topic(org_id, site_id, edge_id, rid), body):
                raise TimeoutError("publish_failed")
            resp = await asyncio.wait_for(fut, timeout_s)
        except asyncio.TimeoutError:
            raise TimeoutError("edge_timeout") from None
        finally:
            self._pending_ops.pop(rid, None)
        if resp.get("status") != "acknowledged":
            raise RuntimeError(str(resp.get("reason") or resp.get("status")))
        return resp.get("result") or {}

    def resolve_op(self, command_id: str, edge_id: UUID, payload: dict) -> bool:
        """True if `command_id` belongs to a pending op (consumed here, never
        looked up in the commands table). A response from a different edge
        than the one asked is swallowed without resolving."""
        entry = self._pending_ops.get(command_id)
        if entry is None:
            return False
        want_edge, fut = entry
        if want_edge == edge_id and not fut.done():
            fut.set_result(payload)
        return True

    # ----------------------------------------------------- responses / ttl
    async def handle_response(self, command_id: str, status: str,
                              detail: str | None, org_id: UUID,
                              edge_id: UUID) -> None:
        """doc 17 §4 rule 4: cmd-resp is honoured only when the command row
        belongs to the org AND edge parsed from the topic — a valid-shaped
        response on the wrong edge's prefix is dropped."""
        new = RESP_MAP.get(status)
        if new is None:
            return  # unknown status — not a lifecycle transition
        try:
            cid = UUID(command_id)
        except ValueError:
            log.warning("cmd-resp with non-uuid id", extra={"command_id": command_id})
            return
        async with tenant_tx(self.pools.system, org_id) as tc:
            row = await tc.fetchrow(
                "SELECT edge_id FROM commands WHERE id=$1", cid)
        if row is None or row["edge_id"] != edge_id:
            log.warning("cmd-resp edge/org mismatch — dropped",
                        extra={"command_id": command_id,
                               "topic_edge": str(edge_id)})
            return
        await self.transition(cid, new, detail, f"edge:{edge_id}", org_id)

    async def _watch(self, cid: UUID, ttl_s: int, org_id: UUID) -> None:
        try:
            await asyncio.sleep(ttl_s + 2)  # doc 16 §3: ttl + 2 s grace
            await self.transition(cid, "timeout",
                                  f"no response within ttl_s={ttl_s}",
                                  "sweeper", org_id)
        except asyncio.CancelledError:
            pass
        finally:
            self._timers.pop(cid, None)

    async def transition(self, cid: UUID, new: str, reason: str | None,
                       actor: str, org_id: UUID) -> bool:
        """Guarded: only in-flight rows move; terminal states never change.
        A response after timeout/terminal is recorded as an event only.
        `org_id` scopes the tenant_tx (v4 T9) — callers always know it (the
        route org at issue, the topic org at cmd-resp)."""
        async with tenant_tx(self.pools.system, org_id) as tc:
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
        await self._broadcast(cid, org_id)
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

    async def _status(self, cid: UUID, org_id: UUID) -> str:
        async with tenant_tx(self.pools.system, org_id) as tc:
            return await tc.fetchval("SELECT status FROM commands WHERE id=$1", cid)

    async def _broadcast(self, cid: UUID, org_id: UUID) -> None:
        async with tenant_tx(self.pools.system, org_id) as tc:
            r = await tc.fetchrow(CMD_SQL + " WHERE c.id=$1", cid)
        cmd = self._v1(r)
        event = {"type": "command", "command_id": cmd["id"], "status": cmd["status"],
                 "tag": cmd["tag"], "org_id": str(org_id)}
        if cmd["detail"]:
            event["detail"] = cmd["detail"]
        # operator-role members OF THIS ORG only (v4 T9 org scoping)
        self.ws.broadcast(event, org_id=org_id)

    # -------------------------------------------------------------- queries
    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            # real site code — the WS stream carries every org the member
            # belongs to, not just the shim site (v4 T9)
            "tag": self.registry.display_name(tag) if tag else str(r["tag_id"]),
            "value": r["value"],
            "status": V1_STATUS[r["status"]],
            "detail": r["reason"],
            "idempotency_key": r["idempotency_key"],
            "user": r["actor_name"],
            "created_at": iso_z(r["issued_at"]),
            "updated_at": iso_z(r["updated_at"]),
        }

    def _v2(self, r, events: list | None = None) -> dict:
        """CONTRACT.v2 §4 Command — ids + v2 status vocabulary + events."""
        out = {
            "id": str(r["id"]),
            "tag_id": str(r["tag_id"]),
            "value": r["value"],
            "status": r["status"],
            "reason": r["reason"],
            "ttl_s": r["ttl_s"],
            "idempotency_key": r["idempotency_key"],
            "note": r["note"],
            "issued_at": iso_z(r["issued_at"]),
            "updated_at": iso_z(r["updated_at"]),
            "actor": {"user_id": str(r["actor_user_id"]),
                      "display_name": r["actor_name"]},
            "version": r["version"],
        }
        if events is not None:
            out["events"] = [{
                "from": e["from_status"], "to": e["to_status"],
                "actor": e["actor"], "reason": e["reason"],
                "at": iso_z(e["at"]),
            } for e in events]
        return out

    async def get(self, tc: TenantConn, cid: UUID,
                  site_id: UUID | None = None) -> dict | None:
        r = await tc.fetchrow(
            CMD_SQL + " WHERE c.id=$1"
            " AND ($2::uuid IS NULL OR c.site_id=$2)", cid, site_id)
        return self._v1(r) if r else None

    async def get_v2(self, tc: TenantConn, cid: UUID, site_id: UUID) -> dict | None:
        r = await tc.fetchrow(
            CMD_SQL + " WHERE c.id=$1 AND c.site_id=$2", cid, site_id)
        if r is None:
            return None
        events = await tc.fetch(EVENT_SQL, cid)
        return self._v2(r, events)

    async def list(self, tc: TenantConn, limit: int, tag_name: str | None,
                   user_name: str | None, site_id: UUID | None = None) -> list[dict]:
        sid = site_id or config.V1_SITE_ID
        tag = self.registry.by_display_name(sid, tag_name) if tag_name else None
        if tag_name and tag is None:
            return []
        rows = await tc.fetch(
            CMD_SQL + " WHERE ($1::uuid IS NULL OR c.tag_id=$1)"
            " AND ($2::text IS NULL OR u.display_name=$2) AND c.site_id=$4"
            " ORDER BY c.issued_at DESC LIMIT $3",
            tag.id if tag else None, user_name, limit, sid)
        return [self._v1(r) for r in rows]

    async def list_v2(self, tc: TenantConn, site_id: UUID, limit: int,
                      cursor: str | None) -> tuple[list[dict], str | None]:
        """Site-scoped command list — CONTRACT.v2 §2 cursor pagination
        (keyset on (issued_at, id); next_cursor = last row's id)."""
        anchor = None
        if cursor:
            try:
                anchor = UUID(cursor)
            except ValueError:
                anchor = None
        rows = await tc.fetch(
            CMD_SQL + " WHERE c.site_id=$1"
            " AND ($2::uuid IS NULL OR (c.issued_at, c.id) <"
            "      (SELECT issued_at, id FROM commands WHERE id=$2))"
            " ORDER BY c.issued_at DESC, c.id DESC LIMIT $3",
            site_id, anchor, limit)
        items = [self._v2(r) for r in rows]
        next_cursor = items[-1]["id"] if len(items) == limit else None
        return items, next_cursor

    async def shutdown(self) -> None:
        for t in list(self._timers.values()):
            t.cancel()
        self._timers.clear()

    async def sweep_interrupted(self) -> int:
        """I9: no in-flight row may survive a restart (its timer died with the
        process) — otherwise the tag is bricked with 409s. Visits EVERY org
        (v4 T9) — commands can exist in any tenant."""
        n = 0
        for org_id in await active_org_ids(self.pools.system):
            async with tenant_tx(self.pools.system, org_id) as tc:
                rows = await tc.fetch(
                    "SELECT id, status FROM commands WHERE status = ANY($1::text[])",
                    list(INFLIGHT))
            for r in rows:
                await self.transition(r["id"], "failed",
                                      "interrupted_by_restart", "sweeper",
                                      org_id)
                log.warning("swept interrupted command",
                            extra={"command_id": str(r["id"])})
                n += 1
        return n
