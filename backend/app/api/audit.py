"""v2 admin API: audit routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..iam.auth import Principal
from ..db.util import iso_z
from ..db.util import parse_ts
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from fastapi.responses import Response
import csv
import io
import json
from ..deps import _CONFIG, _v2_org, org_tx, require_user
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------------------
# Audit export — audit:read (admin|owner), bounded
# ---------------------------------------------------------------------------
AUDIT_EXPORT_MAX = 5000


@router.get("/api/v1/orgs/{org}/audit")
async def v2_audit_export(org: str, request: Request,
                          from_: str | None = Query(None, alias="from"),
                          to: str | None = Query(None),
                          action: str | None = Query(None),
                          actor: str | None = Query(None),
                          format: str = Query("json"),
                          limit: int = Query(500, ge=1, le=AUDIT_EXPORT_MAX),
                          p: Principal = Depends(require_user)):
    """Tenant-scoped audit export (CONTRACT.v2 §3): the hash-chained log for
    THIS org only — RLS makes cross-tenant reads structurally impossible."""
    org_id = _v2_org(org, p, need=_CONFIG)
    if format not in ("json", "csv"):
        raise HTTPException(400, "invalid_request: format")
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT seq, at, actor, action, target, detail, hash FROM audit_log"
            " WHERE ($1::timestamptz IS NULL OR at >= $1)"
            " AND ($2::timestamptz IS NULL OR at <= $2)"
            " AND ($3::text IS NULL OR action = $3)"
            " AND ($4::text IS NULL OR actor = $4)"
            " ORDER BY seq ASC LIMIT $5",
            t_from, t_to, action, actor, limit)
    items = [{"seq": r["seq"], "at": iso_z(r["at"]), "actor": r["actor"],
              "action": r["action"], "target": r["target"],
              "detail": r["detail"], "hash": r["hash"]} for r in rows]
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["seq", "at", "actor", "action", "target", "detail", "hash"])
        for it in items:
            w.writerow([it["seq"], it["at"], it["actor"], it["action"],
                        json.dumps(it["target"], separators=(",", ":"))
                        if it["target"] is not None else "",
                        json.dumps(it["detail"], separators=(",", ":"))
                        if it["detail"] is not None else "",
                        it["hash"]])
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition":
                     f'attachment; filename="audit-{org_id}.csv"'})
    return {"items": items, "next_cursor": None}
