"""Edge logs (roadmap Phase 4 "Logs — make real").

Ingest contract (implemented by the edge bridge / publisher work stream):

  topic   v2/{org}/{site}/{edge}/logs
  payload one entry or a batch — either a JSON array of entries or
          {"logs": [...]} — each entry {ts, level, source, msg}:
            ts     RFC-3339 or epoch seconds (edge clock)
            level  debug | info | warn | error  ("warning" normalizes to warn)
            source free-form component name, <= 80 chars ("adapter:modbus")
            msg    log line, <= 2000 chars (truncated, never rejected)

  org/site/edge identity comes FROM THE TOPIC only (doc 17 §4) — the
  payload's fields are never trusted for tenancy. Rows are written inside
  tenant_tx on the system pool (same trust shape as tag_history ingest).

Read contract:

  GET /api/v1/orgs/{org}/edge-logs?edge=&level=&q=&from=&to=&cursor=&limit=
      member-readable, keyset-paginated (ts,id) DESC, substring search on
      msg+source via `q`.

WIRING (main.py, controller): import + `app.include_router(router)` and
inside `_handle_message`, before the fallthrough:
    if kind == "logs" and len(parts) == 5:
        return await edgelogs.ingest_edge_log(st, org_id, site_id, edge_id,
                                              msg.payload)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .db.context import tenant_tx
from .db.util import iso_z, parse_ts

log = logging.getLogger("wds.edgelogs")

router = APIRouter()

LEVELS = frozenset({"debug", "info", "warn", "error"})
MAX_BATCH = 200          # entries per MQTT message; surplus is dropped
MAX_SOURCE = 80
MAX_MSG = 2000
MAX_AGE_S = 30 * 86400   # refuse absurd edge timestamps (>30d old / >1h future)
MAX_FUTURE_S = 3600


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


# ---------------------------------------------------------------- ingest
def _entry_ts(v) -> datetime | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            return datetime.fromtimestamp(v, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(v, str):
        try:
            return parse_ts(v)
        except ValueError:
            return None
    return None


def _entry(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    ts = _entry_ts(raw.get("ts"))
    if ts is None:
        return None
    level = str(raw.get("level", "info")).lower()
    if level == "warning":
        level = "warn"
    if level not in LEVELS:
        level = "info"
    source = str(raw.get("source", "edge"))[:MAX_SOURCE].strip() or "edge"
    msg = str(raw.get("msg", ""))[:MAX_MSG]
    if not msg:
        return None
    return {"ts": ts, "level": level, "source": source, "msg": msg}


def parse_log_batch(payload: bytes | str | dict | list) -> list[dict]:
    """Validate a `…/logs` payload into at most MAX_BATCH entries.
    Malformed entries are skipped individually; a wholly unusable payload
    returns []."""
    if isinstance(payload, (bytes, str)):
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return []
    if isinstance(payload, dict) and "logs" in payload:
        payload = payload["logs"]
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []
    out = []
    for raw in payload[:MAX_BATCH]:
        e = _entry(raw)
        if e is not None:
            out.append(e)
    return out


async def ingest_edge_log(st, org_id: UUID, site_id: UUID, edge_id: UUID,
                          payload: bytes) -> None:
    """Write one validated batch to edge_logs inside tenant context.
    Called from main._handle_message — identity is already verified."""
    entries = parse_log_batch(payload)
    if not entries:
        return
    now = datetime.now(timezone.utc)
    entries = [e for e in entries
               if -(MAX_FUTURE_S) < (e["ts"] - now).total_seconds() < MAX_AGE_S]
    if not entries:
        return
    async with tenant_tx(st.pools.system, org_id) as tc:
        await tc.executemany(
            "INSERT INTO edge_logs(org_id, site_id, edge_id, ts, level, source, msg)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [(org_id, site_id, edge_id, e["ts"], e["level"], e["source"], e["msg"])
             for e in entries])


# ---------------------------------------------------------------- read
def _row(r) -> dict:
    return {"id": r["id"], "ts": iso_z(r["ts"]), "level": r["level"],
            "source": r["source"], "msg": r["msg"],
            "edge_id": str(r["edge_id"]), "site_id": str(r["site_id"])}


@router.get("/api/v1/orgs/{org}/edge-logs")
async def list_edge_logs(org: str, request: Request, p=Depends(_user),
                         edge: str | None = None, level: str | None = None,
                         q: str | None = None,
                         from_: datetime | None = Query(None, alias="from"),
                         to: datetime | None = None,
                         cursor: str | None = None,
                         limit: int = Query(200, ge=1, le=500)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    edge_id = m._uuid_or_404(edge, "edge") if edge else None
    if level is not None:
        levels = {l.strip() for l in level.split(",") if l.strip()}
        if not levels or not levels <= LEVELS:
            raise HTTPException(422, "bad_level")
        levels = sorted(levels)
    else:
        levels = None
    cur = None
    if cursor:
        try:
            ts_s, id_s = cursor.split("|", 1)
            cur = (parse_ts(ts_s), int(id_s))
        except (ValueError, AttributeError):
            raise HTTPException(400, "bad_cursor") from None
    needle = f"%{q}%" if q else None
    t_from = from_.astimezone(timezone.utc) if from_ else None
    t_to = to.astimezone(timezone.utc) if to else None

    args: list = [edge_id, levels, needle, t_from, t_to]
    cur_sql = ""
    if cur:
        cur_sql = "AND (ts, id) < ($6, $7)"
        args += list(cur)
    args.append(limit + 1)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, ts, level, source, msg, edge_id, site_id FROM edge_logs"
            " WHERE ($1::uuid IS NULL OR edge_id = $1)"
            "   AND ($2::text[] IS NULL OR level = ANY($2))"
            "   AND ($3::text IS NULL OR msg ILIKE $3 OR source ILIKE $3)"
            "   AND ($4::timestamptz IS NULL OR ts >= $4)"
            "   AND ($5::timestamptz IS NULL OR ts <= $5)"
            f"   {cur_sql}"
            " ORDER BY ts DESC, id DESC"
            f" LIMIT ${len(args)}",
            *args)
    items = [_row(r) for r in rows[:limit]]
    nxt = (f"{iso_z(rows[limit - 1]['ts'])}|{rows[limit - 1]['id']}"
           if len(rows) > limit else None)
    return {"items": items, "next_cursor": nxt}
