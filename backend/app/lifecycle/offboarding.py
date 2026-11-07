"""Tenant offboarding safeguards (F20), run by the purge worker right before the data is deleted:

1. the owner must have had a completed export (unless the org had no telemetry, or platform
   staff set plan_limits.export_waived) - otherwise the purge fails loudly and is retried later;
2. a deletion certificate is written first: what the org held, the tip of its audit chain, and an
   honest note that older database backups still contain the data until they expire.
"""

from __future__ import annotations

import hashlib
import json

from ..core import config
from ..db.context import tenant_tx

BACKUP_NOTE = ("Database backups taken before the purge still hold this tenant's data until they age out "
               "(BACKUP_KEEP_DAYS = %s days). Restoring such a backup must not bring a purged tenant back.")


async def org_row_counts(tc) -> dict[str, int]:
    names = [r["table_name"] for r in await tc.fetch(
        "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id'"
        " AND table_name NOT LIKE 'tag_history_%' GROUP BY 1 ORDER BY 1")]
    out: dict[str, int] = {}
    for n in names:
        try:
            async with tc.conn.transaction():
                out[n] = int(await tc.fetchval(f'SELECT count(*) FROM "{n}"'))     # n comes from information_schema
        except Exception:  # noqa: BLE001 - no grant on this table: recorded as unknown
            out[n] = -1
    return out


def certificate_hash(org_id, name, counts: dict, tip: str | None) -> str:
    return hashlib.sha256(json.dumps([str(org_id), name, counts, tip], sort_keys=True).encode()).hexdigest()


async def require_export_and_certify(pools, org_id) -> None:
    async with tenant_tx(pools.system, org_id) as tc:
        org = await tc.fetchrow("SELECT name, deleted_at, plan_limits FROM organizations WHERE id=$1", org_id)
        if org is None:
            return                                   # already gone
        waived = bool((org["plan_limits"] or {}).get("export_waived"))
        has_export = await tc.fetchval("SELECT EXISTS(SELECT 1 FROM org_exports WHERE status='done')")
        has_data = await tc.fetchval("SELECT EXISTS(SELECT 1 FROM tag_history LIMIT 1)")
        if has_data and not has_export and not waived:
            raise RuntimeError("export_required: the owner has not exported this org's data (or staff must set export_waived)")
        counts = await org_row_counts(tc)
        tip = await tc.fetchval("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
        await tc.execute(
            "INSERT INTO org_deletion_certificate(org_id, org_name, deleted_at, row_counts, audit_tip, backup_note, sha256)"
            " VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)",
            org_id, org["name"], org["deleted_at"], json.dumps(counts), tip, BACKUP_NOTE % config.__dict__.get("BACKUP_KEEP_DAYS", 30),
            certificate_hash(org_id, org["name"], counts, tip))
