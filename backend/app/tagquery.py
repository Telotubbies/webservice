"""Read-only tag-history query + per-tag stats (roadmap Phase 4 "Query" and
"Metrics summary — make real").

  GET /api/v1/orgs/{org}/sites/{site}/tag-history
      ?tag=<tag uuid|path>&from=&to=&agg=raw|min|max|avg&bucket_s=
      &limit=&format=json|csv

      Read-only — tenants never send SQL; `agg` picks a whitelisted
      aggregation over `tag_history`. `format=csv` streams the same rows as
      RFC-4180 CSV for the Query page's export.

  GET /api/v1/orgs/{org}/sites/{site}/tag-stats?from=&to=

      One row per site tag: min / max / avg / count / last value / data-gap
      metrics (a gap = consecutive samples more than 60 s apart), for the
      Metrics summary page.

Mounted from main.py; auth helpers resolved lazily (datasources pattern).
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .db.context import tenant_tx
from .db.util import finite_or_none, iso_z

log = logging.getLogger("wds.tagquery")

router = APIRouter()

AGGS = frozenset({"raw", "min", "max", "avg"})
GAP_S = 60.0                     # consecutive samples further apart = a gap
MAX_RAW = 5000
MAX_BUCKETS = 2000


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def _window(from_: datetime | None, to: datetime | None) -> tuple[datetime, datetime]:
    t_to = (to or datetime.now(timezone.utc)).astimezone(timezone.utc)
    t_from = (from_ or t_to).astimezone(timezone.utc)
    if t_from >= t_to:
        raise HTTPException(422, "bad_range")
    return t_from, t_to


async def _site_or_404(tc, site_id: UUID) -> None:
    if not await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id):
        raise HTTPException(404, "site not found")


async def _tag_or_404(tc, site_id: UUID, tag: str):
    """`tag` accepts the tag uuid or its path inside the site."""
    try:
        row = await tc.fetchrow(
            "SELECT id, path, name, type, unit FROM tags"
            " WHERE id=$1 AND site_id=$2", UUID(tag), site_id)
    except ValueError:
        row = await tc.fetchrow(
            "SELECT id, path, name, type, unit FROM tags"
            " WHERE path=$1 AND site_id=$2", tag, site_id)
    if row is None:
        raise HTTPException(404, "tag not found")
    return row


def _num(v):
    """jsonb value -> float for numeric tags, else None."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        return finite_or_none(float(v))
    except (TypeError, ValueError):
        return None


@router.get("/api/v1/orgs/{org}/sites/{site}/tag-history")
async def tag_history(org: str, site: str, request: Request, p=Depends(_user),
                      tag: str = "", from_: datetime | None = Query(None, alias="from"),
                      to: datetime | None = None,
                      agg: str = "raw", bucket_s: int | None = Query(None, ge=1, le=86400),
                      limit: int = Query(MAX_RAW, ge=1, le=MAX_RAW),
                      format: str = "json"):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    site_id = m._uuid_or_404(site, "site")
    if not tag:
        raise HTTPException(422, "tag_required")
    if agg not in AGGS:
        raise HTTPException(422, "bad_agg")
    if format not in ("json", "csv"):
        raise HTTPException(422, "bad_format")
    t_from, t_to = _window(from_, to)

    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_or_404(tc, site_id)
        t = await _tag_or_404(tc, site_id, tag)
        if agg == "raw":
            rows = await tc.fetch(
                "SELECT ts, v, q FROM tag_history"
                " WHERE tag_id=$1 AND ts >= $2 AND ts <= $3"
                " ORDER BY ts DESC LIMIT $4",
                t["id"], t_from, t_to, limit)
            rows = list(reversed(rows))
            data = [{"ts": iso_z(r["ts"]), "v": r["v"], "q": r["q"]}
                    for r in rows]
            if format == "csv":
                return _csv(t["path"], ("ts", "v", "q"), data)
            return {"tag": {"id": str(t["id"]), "path": t["path"],
                            "name": t["name"], "unit": t["unit"]},
                    "from": iso_z(t_from), "to": iso_z(t_to),
                    "agg": "raw", "truncated": len(rows) == limit,
                    "rows": data}
        # bucketed aggregation — numeric samples only; a bucket with no
        # numeric sample reports nulls rather than a misleading 0.
        b = bucket_s or max(1, int((t_to - t_from).total_seconds()) // 200 or 1)
        if (t_to - t_from).total_seconds() / b > MAX_BUCKETS:
            raise HTTPException(422, "too_many_buckets")
        rows = await tc.fetch(
            "SELECT to_timestamp(floor(extract(epoch from ts)/$4)*$4) AS bucket,"
            " min((v::text)::float8) FILTER (WHERE jsonb_typeof(v)='number') AS mn,"
            " max((v::text)::float8) FILTER (WHERE jsonb_typeof(v)='number') AS mx,"
            " avg((v::text)::float8) FILTER (WHERE jsonb_typeof(v)='number') AS av,"
            " count(*)::int AS n"
            " FROM tag_history WHERE tag_id=$1 AND ts >= $2 AND ts <= $3"
            " GROUP BY 1 ORDER BY 1",
            t["id"], t_from, t_to, b)
        data = [{"ts": iso_z(r["bucket"]), "min": finite_or_none(r["mn"]),
                 "max": finite_or_none(r["mx"]), "avg": finite_or_none(r["av"]),
                 "n": r["n"]} for r in rows]
        if format == "csv":
            return _csv(t["path"], ("ts", "min", "max", "avg", "n"), data)
        return {"tag": {"id": str(t["id"]), "path": t["path"],
                        "name": t["name"], "unit": t["unit"]},
                "from": iso_z(t_from), "to": iso_z(t_to),
                "agg": agg, "bucket_s": b, "rows": data}


def _csv(name: str, cols: tuple[str, ...], rows: list[dict]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([r.get(c) for c in cols])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition":
                             f'attachment; filename="{name.replace("/", "_")}.csv"'})


@router.get("/api/v1/orgs/{org}/sites/{site}/tag-stats")
async def tag_stats(org: str, site: str, request: Request, p=Depends(_user),
                    from_: datetime | None = Query(None, alias="from"),
                    to: datetime | None = None):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    site_id = m._uuid_or_404(site, "site")
    t_to = (to or datetime.now(timezone.utc)).astimezone(timezone.utc)
    t_from = (from_.astimezone(timezone.utc)
              if from_ else datetime.fromtimestamp(0, timezone.utc))
    if t_from >= t_to:
        raise HTTPException(422, "bad_range")

    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_or_404(tc, site_id)
        rows = await tc.fetch(
            "WITH h AS ("
            "  SELECT tag_id, ts, v,"
            "    extract(epoch from ts - lag(ts) OVER (PARTITION BY tag_id"
            "                                        ORDER BY ts)) AS gap_s"
            "   FROM tag_history WHERE ts >= $2 AND ts <= $3)"
            "SELECT t.id, t.path, t.name, t.unit, t.type,"
            " min((h.v::text)::float8) FILTER (WHERE jsonb_typeof(h.v)='number') AS mn,"
            " max((h.v::text)::float8) FILTER (WHERE jsonb_typeof(h.v)='number') AS mx,"
            " avg((h.v::text)::float8) FILTER (WHERE jsonb_typeof(h.v)='number') AS av,"
            " count(*)::int AS n,"
            " (array_agg(h.v ORDER BY h.ts DESC))[1] AS last_v,"
            " max(h.ts) AS last_ts,"
            " count(*) FILTER (WHERE h.gap_s > $4)::int AS gaps,"
            " max(h.gap_s) AS max_gap_s"
            " FROM h JOIN tags t ON t.org_id=$1 AND t.id=h.tag_id"
            " WHERE t.site_id=$5"
            " GROUP BY t.id, t.path, t.name, t.unit, t.type"
            " ORDER BY t.path",
            org_id, t_from, t_to, GAP_S, site_id)
    return {"from": iso_z(t_from), "to": iso_z(t_to), "gap_s": GAP_S,
            "items": [{
                "tag_id": str(r["id"]), "path": r["path"], "name": r["name"],
                "unit": r["unit"], "type": r["type"],
                "min": finite_or_none(r["mn"]), "max": finite_or_none(r["mx"]),
                "avg": finite_or_none(r["av"]), "count": r["n"],
                "last": r["last_v"], "last_ts": iso_z(r["last_ts"]),
                "gaps": r["gaps"],
                "max_gap_s": round(r["max_gap_s"], 1) if r["max_gap_s"] else 0.0,
            } for r in rows]}
