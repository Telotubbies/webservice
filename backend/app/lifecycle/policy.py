"""Retention by data class (F20). Defaults live in retention_policy; this sweep deletes in
small batches so ingest never waits on a long lock. audit_log is deliberately NOT here:
the hash chain must stay whole until the tenant itself is purged."""

from __future__ import annotations

import logging

from ..db.context import active_org_ids, tenant_tx

log = logging.getLogger("wds.lifecycle")
BATCH = 5000

# data_class -> (table, key column, WHERE condition on the aged column; $1 = cutoff days)
SQL = {
    "alarms_cleared": "DELETE FROM alarms WHERE id IN (SELECT id FROM alarms WHERE state='cleared' AND cleared_at < now() - make_interval(days => $1) LIMIT {b})",
    "downtimes": "DELETE FROM downtimes WHERE id IN (SELECT id FROM downtimes WHERE ends_at IS NOT NULL AND ends_at < now() - make_interval(days => $1) LIMIT {b})",
    "vision_events": "DELETE FROM vision_events WHERE id IN (SELECT id FROM vision_events WHERE fired_at < now() - make_interval(days => $1) LIMIT {b})",
    "edge_logs": "DELETE FROM edge_logs WHERE id IN (SELECT id FROM edge_logs WHERE received_at < now() - make_interval(days => $1) LIMIT {b})",
    "outbox_sent": "DELETE FROM integration_outbox WHERE id IN (SELECT id FROM integration_outbox WHERE status='sent' AND sent_at < now() - make_interval(days => $1) LIMIT {b})",
    "org_exports_expired": "DELETE FROM org_exports WHERE id IN (SELECT id FROM org_exports WHERE file_path IS NULL AND expires_at < now() - make_interval(days => $1) LIMIT {b})",
}


def _rows(tag: str) -> int:
    return int(tag.split()[-1])


async def retention_sweep(pools) -> dict[str, int]:
    """One pass: every enabled class, every live org. Returns rows deleted per class."""
    async with pools.system.acquire() as conn:
        policy = {r["data_class"]: r["default_days"] for r in
                  await conn.fetch("SELECT data_class, default_days FROM retention_policy WHERE enabled")}
    out = {k: 0 for k in policy}
    for org_id in await active_org_ids(pools.system):
        for cls, days in policy.items():
            if cls not in SQL:
                continue
            try:
                while True:
                    async with tenant_tx(pools.system, org_id) as tc:
                        n = _rows(await tc.execute(SQL[cls].format(b=BATCH), days))
                    out[cls] += n
                    if n < BATCH:
                        break
            except Exception:  # noqa: BLE001 - a missing grant on one class must not stop the others
                log.exception("retention class failed", extra={"org_id": str(org_id), "class": cls})
    if any(out.values()):
        log.info("retention sweep", extra={"deleted": out})
    return out
