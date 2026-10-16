"""Unified org event feed (roadmap Phase 4 "Events — make real").

`GET /api/v1/orgs/{org}/events` merges the four real event sources into one
timeline, filterable by type, site and tag, with keyset pagination:

  alarm    — raised / acked / cleared transitions from `alarms`
  command  — status transitions from `command_events` (joined to `commands`)
  config   — configuration + membership entries from `audit_log`
  incident — `incident_events` joined to their incident title/severity

Cursor: opaque base64 "epoch_us|id" of the last row — the sort is
(ts DESC, id DESC) and ids are unique per source row + transition.

Mounted from main.py; auth helpers resolved lazily (same pattern as
datasources/routes.py).
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .db.context import tenant_tx
from .db.util import iso_z, parse_ts

log = logging.getLogger("wds.eventsfeed")

router = APIRouter()

EVENT_TYPES = frozenset({"alarm", "command", "config", "incident"})

# Each branch emits: ts, id (unique text), type, action, severity,
# site_id, tag_id, tag_path, actor, subject.
_UNION = """
  SELECT a.raised_at AS ts, 'alarm:' || a.id::text || ':raised' AS id,
         'alarm' AS type, 'raised' AS action, a.severity,
         t.site_id, t.id AS tag_id, t.path AS tag_path,
         NULL::text AS actor, r.name AS subject
    FROM alarms a
    JOIN alarm_rules r ON r.org_id=a.org_id AND r.tag_id=a.tag_id AND r.id=a.rule_id
    JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id
  UNION ALL
  SELECT a.acked_at, 'alarm:' || a.id::text || ':acked',
         'alarm', 'acked', a.severity,
         t.site_id, t.id, t.path, a.acked_by::text, r.name
    FROM alarms a
    JOIN alarm_rules r ON r.org_id=a.org_id AND r.tag_id=a.tag_id AND r.id=a.rule_id
    JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id
   WHERE a.acked_at IS NOT NULL
  UNION ALL
  SELECT a.cleared_at, 'alarm:' || a.id::text || ':cleared',
         'alarm', 'cleared', a.severity,
         t.site_id, t.id, t.path, NULL, r.name
    FROM alarms a
    JOIN alarm_rules r ON r.org_id=a.org_id AND r.tag_id=a.tag_id AND r.id=a.rule_id
    JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id
   WHERE a.cleared_at IS NOT NULL
  UNION ALL
  SELECT ce.at, 'cmd:' || ce.id::text,
         'command', ce.to_status, NULL,
         c.site_id, c.tag_id, t.path, ce.actor, t.name
    FROM command_events ce
    JOIN commands c ON c.org_id=ce.org_id AND c.id=ce.command_id
    LEFT JOIN tags t ON t.org_id=ce.org_id AND t.id=c.tag_id
  UNION ALL
  SELECT a.at, 'audit:' || a.seq::text,
         'config', a.action, NULL,
         NULL::uuid, NULL::uuid, NULL::text, a.actor,
         COALESCE(a.target->>'name', a.action)
    FROM audit_log a
  UNION ALL
  SELECT e.at, 'inc:' || e.id::text,
         'incident', e.kind, i.severity,
         NULL::uuid, NULL::uuid, NULL::text, e.author_id::text, i.title
    FROM incident_events e
    JOIN incidents i ON i.org_id=e.org_id AND i.id=e.incident_id
"""


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def encode_cursor(ts: datetime, row_id: str) -> str:
    us = int(ts.timestamp() * 1_000_000)
    return base64.urlsafe_b64encode(f"{us}|{row_id}".encode()).decode()


def decode_cursor(raw: str) -> tuple[datetime, str]:
    try:
        us_s, row_id = base64.urlsafe_b64decode(raw.encode()).decode().split("|", 1)
        ts = datetime.fromtimestamp(int(us_s) / 1_000_000, tz=timezone.utc)
        if not row_id:
            raise ValueError
        return ts, row_id
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "bad_cursor") from None


def _row(r) -> dict:
    return {
        "id": r["id"], "ts": iso_z(r["ts"]), "type": r["type"],
        "action": r["action"], "severity": r["severity"],
        "site_id": str(r["site_id"]) if r["site_id"] else None,
        "tag_id": str(r["tag_id"]) if r["tag_id"] else None,
        "tag": r["tag_path"], "actor": r["actor"], "subject": r["subject"],
    }


@router.get("/api/v1/orgs/{org}/events")
async def events(org: str, request: Request, p=Depends(_user),
                 type: str | None = None, site: str | None = None,
                 tag: str | None = None,
                 from_: datetime | None = Query(None, alias="from"),
                 to: datetime | None = None,
                 cursor: str | None = None,
                 limit: int = Query(100, ge=1, le=500)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    if type is not None:
        types = {t.strip() for t in type.split(",") if t.strip()}
        if not types or not types <= EVENT_TYPES:
            raise HTTPException(422, "bad_type")
        types = sorted(types)
    else:
        types = sorted(EVENT_TYPES)
    site_id: UUID | None = m._uuid_or_404(site, "site") if site else None
    t_from = from_.astimezone(timezone.utc) if from_ else None
    t_to = to.astimezone(timezone.utc) if to else None
    if t_from and t_to and t_from > t_to:
        raise HTTPException(422, "bad_range")
    cur = decode_cursor(cursor) if cursor else None

    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        # `tag` accepts a tag id or a tag path within the org.
        tag_id: UUID | None = None
        tag_path: str | None = None
        if tag:
            try:
                tag_id = UUID(tag)
            except ValueError:
                tag_path = tag
                tag_id = await tc.fetchval(
                    "SELECT id FROM tags WHERE path=$1", tag_path)
                if tag_id is None:
                    return {"items": [], "next_cursor": None}
        args: list = [types, site_id, tag_id, t_from, t_to]
        cur_sql = ""
        if cur:
            cur_sql = "AND (ev.ts, ev.id) < ($6, $7)"
            args += [cur[0], cur[1]]
        args.append(limit + 1)
        rows = await tc.fetch(
            f"SELECT * FROM ({_UNION}) ev"
            " WHERE ev.type = ANY($1)"
            "   AND ($2::uuid IS NULL OR ev.site_id = $2)"
            "   AND ($3::uuid IS NULL OR ev.tag_id = $3)"
            "   AND ($4::timestamptz IS NULL OR ev.ts >= $4)"
            "   AND ($5::timestamptz IS NULL OR ev.ts <= $5)"
            f"   {cur_sql}"
            " ORDER BY ev.ts DESC, ev.id DESC"
            f" LIMIT ${len(args)}",
            *args)
    items = [_row(r) for r in rows[:limit]]
    nxt = (encode_cursor(rows[limit - 1]["ts"], rows[limit - 1]["id"])
           if len(rows) > limit else None)
    return {"items": items, "next_cursor": nxt}
