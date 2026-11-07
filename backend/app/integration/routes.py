"""Integration API (F18): outbox view + replay, closed summaries (JSON/CSV), ERP id map,
connections, and the per-site data_origin switch.

API keys reach the summary endpoints only with the `read:production` scope; a key with no
scopes (every older key) is refused here. No scope can control a PLC.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..core import egress
from ..datasources import secretbox
from . import connector as core
from .connectors import csv_connector
from .connectors.odoo import OdooConnector
from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()
_O = "/api/v1/orgs/{org}/integration"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


async def need_scope(tc, p, scope: str) -> None:
    if getattr(p, "kind", None) != "apikey":
        return
    scopes = await tc.fetchval("SELECT scopes FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL", p.user_id)
    if not scopes or scope not in scopes:
        raise HTTPException(403, f"missing_scope: {scope}")


def csv_cell(v):
    """Neutralise spreadsheet formulas (CSV injection): a leading = + - @ becomes text."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


# ── outbox ──
@router.get(_O + "/outbox")
async def list_outbox(org: str, request: Request, status: Literal["pending", "sent", "dead"] | None = None,
                      limit: int = Query(100, ge=1, le=500), p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, connection_id, event_type, idempotency_key, status, attempts, next_try_at, last_code,"
            " last_error, created_at, sent_at FROM integration_outbox"
            " WHERE ($1::text IS NULL OR status=$1) ORDER BY id DESC LIMIT $2", status, limit)
        counts = await tc.fetch("SELECT status, count(*)::int AS n FROM integration_outbox GROUP BY 1")
    return {"counts": {r["status"]: r["n"] for r in counts},
            "items": [{**{k: (str(v) if k in ("connection_id",) else v) for k, v in dict(r).items()
                          if k not in ("next_try_at", "created_at", "sent_at")},
                       "next_try_at": iso_z(r["next_try_at"]), "created_at": iso_z(r["created_at"]),
                       "sent_at": iso_z(r["sent_at"]) if r["sent_at"] else None} for r in rows]}


@router.post(_O + "/outbox/{oid}/replay")
async def replay(org: str, oid: int, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("UPDATE integration_outbox SET status='pending', attempts=0, next_try_at=now(),"
                             " last_error=NULL WHERE id=$1 AND status='dead' RETURNING 1", oid) is None:
            raise HTTPException(404, "no dead row with that id")
        await audit.append(tc, f"user:{p.user_id}", "integration.outbox.replayed", {"outbox_id": oid}, {})
    return {"ok": True}


@router.delete(_O + "/outbox/{oid}", status_code=204)
async def discard(org: str, oid: int, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("DELETE FROM integration_outbox WHERE id=$1 AND status='dead' RETURNING 1", oid) is None:
            raise HTTPException(404, "no dead row with that id")
        await audit.append(tc, f"user:{p.user_id}", "integration.outbox.discarded", {"outbox_id": oid}, {})


# ── closed summaries ──
@router.get("/api/v1/orgs/{org}/sites/{site}/summaries")
async def summaries(org: str, site: str, request: Request, kind: Literal["shift", "hour"] = "shift",
                    from_: datetime | None = Query(None, alias="from"), to: datetime | None = None,
                    format: Literal["json", "csv"] = "json", include_non_production: bool = False,
                    limit: int = Query(500, ge=1, le=5000), p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    tbl, tcol = ("shift_summary", "from_ts") if kind == "shift" else ("hour_summary", "hour_start")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await need_scope(tc, p, "read:production")
        rows = await tc.fetch(
            f"SELECT s.*, d.name AS machine FROM {tbl} s JOIN devices d ON d.org_id=s.org_id AND d.id=s.device_id"
            f" WHERE s.site_id=$1 AND ($2::timestamptz IS NULL OR s.{tcol} >= $2) AND ($3::timestamptz IS NULL OR s.{tcol} < $3)"
            " AND ($4 OR s.data_origin='production') ORDER BY " + tcol + " DESC, s.version DESC LIMIT $5",
            site_id, from_, to, include_non_production, limit)
        await audit.append(tc, f"user:{p.user_id}", "integration.summaries.read", {"site_id": str(site_id)},
                           {"kind": kind, "rows": len(rows), "format": format})
    cols = ["machine", "shift_name", "shift_date", "from_ts", "to_ts"] if kind == "shift" else ["machine", "hour_start"]
    cols += ["version", "qty_total", "qty_good", "qty_scrap", "run_s", "stop_s", "coverage_pct", "data_origin"]
    data = [{c: (iso_z(r[c]) if isinstance(r[c], datetime) else (str(r[c]) if c == "shift_date" else
             (float(r[c]) if c.startswith("qty") and r[c] is not None else r[c]))) for c in cols} for r in rows]
    if format == "json":
        return {"kind": kind, "items": data}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in data:
        w.writerow([csv_cell(r[c]) for c in cols])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{kind}-summaries.csv"'})


# ── connections + id map ──
class ConnIn(BaseModel):
    kind: Literal["odoo", "csv", "webhook"]
    name: str = Field(min_length=1, max_length=120)
    config: dict = Field(default_factory=dict)
    secret: str | None = Field(default=None, max_length=500)
    allow_non_production: bool = False


@router.get(_O + "/connections")
async def list_connections(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT id, kind, name, config, secret_enc IS NOT NULL AS has_secret, enabled,"
                              " allow_non_production, status, last_ok_at FROM erp_connections ORDER BY created_at")
    return {"items": [{**dict(r), "id": str(r["id"]), "last_ok_at": iso_z(r["last_ok_at"]) if r["last_ok_at"] else None}
                      for r in rows]}


@router.post(_O + "/connections", status_code=201)
async def create_connection(org: str, body: ConnIn, request: Request, p=Depends(_user)):
    import json
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    sealed = secretbox.seal({"secret": body.secret}) if body.secret else None
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        r = await tc.fetchrow(
            "INSERT INTO erp_connections(org_id, kind, name, config, secret_enc, allow_non_production)"
            " VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id", org_id, body.kind, body.name,
            json.dumps(body.config), sealed, body.allow_non_production)
        await audit.append(tc, f"user:{p.user_id}", "integration.connection.created", {"connection_id": str(r["id"])},
                           {"kind": body.kind, "name": body.name})
    return {"id": str(r["id"])}


class MapIn(BaseModel):
    connection_id: str
    entity: Literal["product", "work_order", "work_center", "reason"]
    external_id: str = Field(min_length=1, max_length=200)
    local_id: str
    external_ver: str | None = Field(default=None, max_length=200)


@router.get(_O + "/id-map")
async def list_id_map(org: str, request: Request, entity: str | None = None, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT * FROM erp_id_map WHERE ($1::text IS NULL OR entity=$1) ORDER BY synced_at DESC LIMIT 500", entity)
    return {"items": [{**dict(r), "org_id": None, "connection_id": str(r["connection_id"]), "local_id": str(r["local_id"]),
                       "synced_at": iso_z(r["synced_at"])} for r in rows]}


@router.put(_O + "/id-map")
async def put_id_map(org: str, body: MapIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cid, lid = m._uuid_or_404(body.connection_id, "connection"), m._uuid_or_404(body.local_id, "local id")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await tc.execute(
            "INSERT INTO erp_id_map(org_id, connection_id, entity, external_id, local_id, external_ver)"
            " VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (org_id, connection_id, entity, external_id)"
            " DO UPDATE SET local_id=EXCLUDED.local_id, external_ver=EXCLUDED.external_ver, inactive=false, synced_at=now()",
            org_id, cid, body.entity, body.external_id, lid, body.external_ver)
        await audit.append(tc, f"user:{p.user_id}", "integration.idmap.put", {"entity": body.entity}, {"external_id": body.external_id})
    return {"ok": True}


# ── data origin ──
class OriginIn(BaseModel):
    data_origin: Literal["production", "demo", "simulated", "test"]


@router.put("/api/v1/orgs/{org}/sites/{site}/data-origin")
async def set_origin(org: str, site: str, body: OriginIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("UPDATE sites SET data_origin=$2 WHERE id=$1 RETURNING 1", site_id, body.data_origin) is None:
            raise HTTPException(404, "site not found")
        await audit.append(tc, f"user:{p.user_id}", "site.data_origin", {"site_id": str(site_id)}, {"data_origin": body.data_origin})
    return {"ok": True}


# ── inbound sync (F19) ──
async def odoo_for(row) -> OdooConnector:
    cfg = row["config"] if isinstance(row["config"], dict) else {}
    if not (cfg.get("url") and cfg.get("db") and cfg.get("login") and row["secret_enc"]):
        raise HTTPException(422, "connection needs url, db, login and a secret")
    key = secretbox.open_(bytes(row["secret_enc"]))["secret"]
    try:
        return OdooConnector(cfg["url"], cfg["db"], cfg["login"], key)
    except egress.EgressError as exc:
        raise HTTPException(422, f"url refused: {exc}") from None


@router.post(_O + "/connections/{cid}/sync")
async def sync_connection(org: str, cid: str, request: Request, entity: Literal["product", "work_center", "work_order"],
                          dry_run: bool = False, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    conn_id = m._uuid_or_404(cid, "connection")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow("SELECT * FROM erp_connections WHERE id=$1 AND enabled", conn_id)
        if row is None or row["kind"] != "odoo":
            raise HTTPException(404, "no enabled odoo connection with that id")
        res = await core.sync_entity(tc, conn_id, await odoo_for(row), entity, dry_run=dry_run)
        await audit.append(tc, f"user:{p.user_id}", "integration.sync", {"connection_id": cid},
                           {"entity": entity, "dry_run": dry_run, **{k: v for k, v in res.items() if k != "error"}})
    return res


@router.post(_O + "/csv-import")
async def csv_import(org: str, request: Request, entity: Literal["product", "work_center", "work_order"],
                     dry_run: bool = True, p=Depends(_user)):
    """Raw CSV body (UTF-8). Dry-run by default: shows what would be added / changed / skipped / rejected."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    raw = await request.body()
    if len(raw) > csv_connector.MAX_BYTES:
        raise HTTPException(413, "file too large")
    try:
        recs = csv_connector.parse(entity, raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(422, str(exc)) from None
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cid = await tc.fetchval("SELECT id FROM erp_connections WHERE kind='csv' ORDER BY created_at LIMIT 1")
        if cid is None:
            cid = await tc.fetchval("INSERT INTO erp_connections(org_id, kind, name) VALUES ($1,'csv','CSV import') RETURNING id", org_id)
        res = await core.sync_entity(tc, cid, csv_connector.CsvConnector(recs), entity, dry_run=dry_run)
        await audit.append(tc, f"user:{p.user_id}", "integration.csv_import", {"connection_id": str(cid)},
                           {"entity": entity, "dry_run": dry_run, "rows": len(recs)})
    return res


@router.get(_O + "/staging")
async def list_staging(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT id, connection_id, entity, external_id, payload, reason, created_at FROM erp_staging ORDER BY id DESC LIMIT 500")
    return {"items": [{**dict(r), "connection_id": str(r["connection_id"]), "created_at": iso_z(r["created_at"])} for r in rows]}


class StageMap(BaseModel):
    device_id: str


@router.put(_O + "/staging/{sid}/map")
async def map_staging(org: str, sid: int, body: StageMap, request: Request, p=Depends(_user)):
    """Pick the machine for a staged work center; the next sync then carries its work orders."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    dev = m._uuid_or_404(body.device_id, "device")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM devices WHERE id=$1", dev) is None:
            raise HTTPException(404, "device not found")
        row = await tc.fetchrow("DELETE FROM erp_staging WHERE id=$1 AND entity='work_center' RETURNING connection_id, external_id", sid)
        if row is None:
            raise HTTPException(404, "staged work center not found")
        await tc.execute(
            "INSERT INTO erp_id_map(org_id, connection_id, entity, external_id, local_id) VALUES ($1,$2,'work_center',$3,$4)"
            " ON CONFLICT (org_id, connection_id, entity, external_id) DO UPDATE SET local_id=EXCLUDED.local_id, inactive=false",
            org_id, row["connection_id"], row["external_id"], dev)
        await audit.append(tc, f"user:{p.user_id}", "integration.workcenter.mapped", {"external_id": row["external_id"]}, {"device_id": body.device_id})
    return {"ok": True}


@router.get(_O + "/sync-runs")
async def sync_runs(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT * FROM erp_sync_run ORDER BY id DESC LIMIT 50")
    return {"items": [{**dict(r), "org_id": None, "connection_id": str(r["connection_id"]),
                       "started_at": iso_z(r["started_at"]), "finished_at": iso_z(r["finished_at"]) if r["finished_at"] else None} for r in rows]}


async def sync_odoo_all(pools) -> int:
    """Scheduled pull (read-only) for every enabled Odoo connection, org by org."""
    import logging
    from ..db.context import active_org_ids
    n = 0
    for org_id in await active_org_ids(pools.system):
        try:
            async with tenant_tx(pools.system, org_id) as tc:
                for row in await tc.fetch("SELECT * FROM erp_connections WHERE kind='odoo' AND enabled"):
                    try:
                        conn = await odoo_for(row)
                    except HTTPException:
                        continue
                    for ent in ("product", "work_center", "work_order"):
                        await core.sync_entity(tc, row["id"], conn, ent)
                        n += 1
        except Exception:  # noqa: BLE001 - one org must not stop the sweep
            logging.getLogger("wds.integration").exception("odoo sync failed", extra={"org_id": str(org_id)})
    return n
