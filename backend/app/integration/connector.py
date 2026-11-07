"""Inbound ERP sync core (F19). The connector (Odoo, CSV...) only returns raw records; this
module writes them, so RLS, audit and idempotency live in one place.

Rule (docs/data-architecture.md 4.11): the ERP owns product names/codes and work-order plan
fields, so those are overwritten from the ERP. A work center is never guessed onto a machine:
until a person maps it, the row waits in erp_staging.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol
from uuid import UUID

ENTITIES = ("product", "work_center", "work_order")


@dataclass
class ExtRecord:
    external_id: str
    version: str                       # write_date or a content hash: equal version = nothing to do
    fields: dict = field(default_factory=dict)


@dataclass
class Page:
    records: list[ExtRecord]
    next_cursor: str | None = None


@dataclass
class Health:
    ok: bool
    detail: str = ""


class Connector(Protocol):
    kind: str

    async def healthcheck(self) -> Health: ...
    async def pull(self, entity: str, cursor: str | None) -> Page: ...


@dataclass
class Counts:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    bad: int = 0
    staged: int = 0

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _num(v):
    try:
        return float(v) if v not in (None, "", False) else None
    except (TypeError, ValueError):
        raise ValueError(f"not a number: {v!r}") from None


def _ts(v):
    if v in (None, "", False):
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        raise ValueError(f"not a date: {v!r}") from None


async def _mapped(tc, cid: UUID, entity: str, ext_id: str):
    return await tc.fetchrow(
        "SELECT local_id, external_ver FROM erp_id_map WHERE connection_id=$1 AND entity=$2 AND external_id=$3",
        cid, entity, ext_id)


async def _apply(tc, cid: UUID, entity: str, r: ExtRecord, counts: Counts, dry: bool) -> None:
    f = r.fields
    m = await _mapped(tc, cid, entity, r.external_id)
    if m is not None and m["external_ver"] == r.version:
        counts.skipped += 1                     # same version as last time: second run writes nothing
        return
    if entity == "product":
        code = str(f.get("code") or "").strip()
        if not code:
            raise ValueError("product without a code")
        local = m["local_id"] if m else await tc.fetchval("SELECT id FROM erp_product WHERE code=$1", code)
        if not dry:
            local = await tc.fetchval(
                "INSERT INTO erp_product(org_id, id, code, name, active) VALUES ($1, coalesce($2, gen_random_uuid()), $3, $4, $5)"
                " ON CONFLICT (org_id, code) DO UPDATE SET name=EXCLUDED.name, active=EXCLUDED.active RETURNING id",
                tc.org_id, local, code, str(f.get("name") or ""), bool(f.get("active", True)))
    elif entity == "work_center":
        if m is None:                           # a machine must be chosen by a person
            counts.staged += 1
            if not dry:
                await tc.execute(
                    "INSERT INTO erp_staging(org_id, connection_id, entity, external_id, payload, reason)"
                    " VALUES ($1,$2,$3,$4,$5::jsonb,'unmapped work center') ON CONFLICT (org_id, connection_id, entity, external_id)"
                    " DO UPDATE SET payload=EXCLUDED.payload", tc.org_id, cid, entity, r.external_id, json.dumps(f, default=str))
            return
        local = m["local_id"]                   # mapped: only the version moves
    elif entity == "work_order":
        code = str(f.get("code") or "").strip()
        if not code or not f.get("product_code"):
            raise ValueError("work order needs code and product_code")
        if f.get("product_ext"):                # prefer the synced product's real code over Odoo's display name
            pm = await _mapped(tc, cid, "product", str(f["product_ext"]))
            real = await tc.fetchval("SELECT code FROM erp_product WHERE id=$1", pm["local_id"]) if pm else None
            f = {**f, "product_code": real or f["product_code"]}
        wc = await _mapped(tc, cid, "work_center", str(f.get("work_center") or "")) if f.get("work_center") else None
        local = m["local_id"] if m else await tc.fetchval("SELECT id FROM erp_work_order WHERE code=$1", code)
        if not dry:
            local = await tc.fetchval(
                "INSERT INTO erp_work_order(org_id, id, code, product_code, qty_planned, due_at, status, device_id)"
                " VALUES ($1, coalesce($2, gen_random_uuid()), $3,$4,$5,$6,$7,$8)"
                " ON CONFLICT (org_id, code) DO UPDATE SET product_code=EXCLUDED.product_code, qty_planned=EXCLUDED.qty_planned,"
                " due_at=EXCLUDED.due_at, status=EXCLUDED.status, device_id=EXCLUDED.device_id RETURNING id",
                tc.org_id, local, code, str(f["product_code"]), _num(f.get("qty_planned")), _ts(f.get("due_at")),
                str(f.get("status") or "unknown"), wc["local_id"] if wc else None)
    else:
        raise ValueError(f"unknown entity {entity}")
    if m is None:
        counts.added += 1
    else:
        counts.updated += 1
    if not dry and local is not None:
        await tc.execute(
            "INSERT INTO erp_id_map(org_id, connection_id, entity, external_id, local_id, external_ver)"
            " VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (org_id, connection_id, entity, external_id)"
            " DO UPDATE SET external_ver=EXCLUDED.external_ver, inactive=false, synced_at=now()",
            tc.org_id, cid, entity, r.external_id, local, r.version)


async def sync_entity(tc, cid: UUID, conn: Connector, entity: str, *, dry_run: bool = False,
                      max_pages: int = 200) -> dict:
    """Pull -> map -> upsert -> advance the cursor. A bad record is counted and skipped, never fatal."""
    if entity not in ENTITIES:
        raise ValueError(f"unknown entity {entity}")
    run = await tc.fetchval("INSERT INTO erp_sync_run(org_id, connection_id, entity, dry_run) VALUES ($1,$2,$3,$4) RETURNING id",
                            tc.org_id, cid, entity, dry_run)
    counts, error = Counts(), None
    cur = await tc.fetchval("SELECT cursor FROM erp_sync_cursor WHERE connection_id=$1 AND entity=$2", cid, entity)
    try:
        for _ in range(max_pages):
            page = await conn.pull(entity, cur)
            for r in page.records:
                try:
                    async with tc.conn.transaction():       # savepoint: one bad row must not poison the rest
                        await _apply(tc, cid, entity, r, counts, dry_run)
                except ValueError:
                    counts.bad += 1
            cur = page.next_cursor or cur
            if not page.next_cursor:
                break
        if not dry_run and cur is not None:
            await tc.execute(
                "INSERT INTO erp_sync_cursor(org_id, connection_id, entity, cursor) VALUES ($1,$2,$3,$4)"
                " ON CONFLICT (org_id, connection_id, entity) DO UPDATE SET cursor=EXCLUDED.cursor, updated_at=now()",
                tc.org_id, cid, entity, cur)
    except Exception as exc:  # noqa: BLE001 - connector/network failure: record it, keep what was written
        error = str(exc)[:500]
    await tc.execute("UPDATE erp_sync_run SET finished_at=now(), added=$2, updated=$3, skipped=$4, bad=$5, staged=$6, error=$7 WHERE id=$1",
                     run, counts.added, counts.updated, counts.skipped, counts.bad, counts.staged, error)
    if error is None and not dry_run:
        await tc.execute("UPDATE erp_connections SET status='ok', last_ok_at=now() WHERE id=$1", cid)
    return {**counts.as_dict(), "error": error, "dry_run": dry_run}
