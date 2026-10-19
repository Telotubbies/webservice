"""Plans + limit enforcement (roadmap §10 6.1/6.2).

One module owns the catalog math so handlers stay thin:

- :func:`effective` — the org's resolved plan row: catalog values with the
  per-org ``organizations.plan_limits`` jsonb override on top (that is how
  enterprise "custom" terms and the back-office PATCH land). ``None`` cap =
  unlimited.
- :func:`check_limit` — raise ``HTTPException(402, {error: 'plan_limit',
  limit, usage, cap})`` when creating ``extra`` more of a resource would
  pass its cap. Called INSIDE an open tenant_tx so usage counts are the
  org's own rows and the check races nothing (same tx as the INSERT).
- :func:`usage_summary` — counts vs caps for the settings -> plan page.
- :func:`retention_prune` — per-org history retention worker, replaces the
  single global-window prune (wired in main.py's ``_every`` table).

API-key request budgets per plan live in :data:`API_RATE_FALLBACK` and are
read by ``Security._api_key_principal`` (the plan row is fetched on the same
key_tx transaction — no extra round trip).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException

from ..core import config
from ..production import rollup
from ..db.context import tenant_tx

log = logging.getLogger("wds.plans")

#: plan_limits jsonb keys / plans columns — the resource vocabulary.
CAP_KEYS = (
    "max_sites", "max_edges", "max_tags", "max_users",
    "max_cameras", "max_vision_models",
)

# Usage counters per cap. Every query runs inside a tenant_tx, so rows are
# already the org's own (RLS) — no org predicate needed or wanted.
_USAGE_SQL = {
    "max_sites": "SELECT count(*) FROM sites",
    "max_edges": "SELECT count(*) FROM edges WHERE status <> 'disabled'",
    "max_tags": "SELECT count(*) FROM tags",
    # seats = human members + unexpired pending invites (same rule the
    # memberships/invites DB triggers enforce on the paths this module
    # cannot hook, e.g. invite accept and api-key mint)
    "max_users": "SELECT (SELECT count(*) FROM memberships m JOIN users u"
                 "  ON u.id = m.user_id WHERE u.sub NOT LIKE 'svc:%')"
                 " + (SELECT count(*) FROM invites WHERE accepted_at IS NULL"
                 "    AND expires_at > now())",
    "max_cameras": "SELECT count(*) FROM cameras",
    "max_vision_models": "SELECT count(*) FROM vision_models",
}

_PLAN_ROW = """
SELECT o.plan, o.trial_ends_at, o.suspended_at, o.suspended_reason,
       o.plan_limits, p.trial_days, p.max_sites, p.max_edges, p.max_tags,
       p.max_users, p.max_cameras, p.max_vision_models, p.retention_days,
       p.gpu_hours_monthly, p.sso, p.audit_export, p.sms, p.assistant,
       p.api_rate_per_min
  FROM organizations o LEFT JOIN plans p ON p.code = o.plan
 WHERE o.id = $1
"""


async def org_plan(tc, org_id: UUID):
    """The org row joined to its plan; None when the org doesn't exist."""
    return await tc.fetchrow(_PLAN_ROW, org_id)


def caps(plan_row) -> dict[str, int | None]:
    """Resolved caps: plan_limits override > plan column. None = unlimited."""
    out: dict[str, int | None] = {}
    overrides = plan_row["plan_limits"] or {}
    for k in CAP_KEYS:
        v = overrides.get(k)
        out[k] = _to_int(v) if v is not None else plan_row[k]
    return out


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def features(plan_row) -> dict:
    """Non-quota plan flags + metering for the plan/usage page."""
    overrides = plan_row["plan_limits"] or {}
    return {
        "sso": bool(plan_row["sso"]),
        "audit_export": bool(plan_row["audit_export"]),
        "sms": bool(plan_row["sms"]),
        "assistant": bool(plan_row["assistant"]),
        "gpu_hours_monthly": overrides.get("gpu_hours_monthly",
                                           plan_row["gpu_hours_monthly"]),
        "retention_days": _to_int(overrides.get("retention_days"))
                          or plan_row["retention_days"] or 365,
        "api_rate_per_min": _to_int(overrides.get("api_rate_per_min"))
                            or plan_row["api_rate_per_min"] or 120,
    }


async def check_limit(tc, org_id: UUID, cap_key: str, extra: int = 1) -> None:
    """Refuse a create that would cross the org's plan cap -> HTTP 402.

    Usage is counted inside the CALLER's tenant_tx — the check and the
    INSERT it guards live in one transaction, so two racing creates can't
    both pass (the row-lock on the serializing INSERT plus this count is
    the same bound the DB triggers use for seats).
    """
    if cap_key not in _USAGE_SQL:
        raise KeyError(f"unknown plan cap {cap_key}")
    row = await org_plan(tc, org_id)
    if row is None:
        raise HTTPException(404, "not found")
    cap = caps(row)[cap_key]
    if cap is None:
        return                                   # unlimited
    usage = int(await tc.fetchval(_USAGE_SQL[cap_key]))
    if usage + extra > cap:
        raise HTTPException(status_code=402, detail={
            "error": "plan_limit", "limit": cap_key,
            "usage": usage, "cap": cap, "requested": extra,
        })


async def usage_summary(tc, org_id: UUID) -> dict:
    """GET /usage payload: plan identity + usage vs cap per resource."""
    row = await org_plan(tc, org_id)
    if row is None:
        raise HTTPException(404, "not found")
    lim = caps(row)
    usage: dict[str, dict] = {}
    for k, sql in _USAGE_SQL.items():
        usage[k] = {"usage": int(await tc.fetchval(sql)), "cap": lim[k]}
    gpu = await tc.fetchval(
        "SELECT coalesce(sum(gpu_seconds) / 3600.0, 0) FROM inference_usage"
        " WHERE placement='cloud'"
        " AND day >= date_trunc('month', now())::date")
    usage["gpu_hours_monthly"] = {
        "usage": round(float(gpu or 0), 2),
        "cap": _to_int(features(row)["gpu_hours_monthly"])}
    return {
        "plan": row["plan"],
        "trial_ends_at": row["trial_ends_at"],
        "suspended": row["suspended_at"] is not None,
        "features": features(row),
        "usage": usage,
    }


def retention_days(plan_row) -> int:
    """Effective history retention in days for one org."""
    return features(plan_row)["retention_days"]


async def delete_history_batch(tc, cutoff: datetime, batch: int) -> int:
    """Delete up to `batch` samples older than `cutoff` for the tenant in
    `tc`. Keyed on the primary key: ctid is only unique within one partition."""
    return int((await tc.execute(
        "DELETE FROM tag_history h USING ("
        "SELECT tag_id, ts FROM tag_history WHERE ts < $1 LIMIT $2) d"
        " WHERE h.tag_id = d.tag_id AND h.ts = d.ts",
        cutoff, batch)).split()[-1])


async def retention_prune(pools, batch: int | None = None) -> int:
    """Per-org tag_history prune (roadmap §10 6.2): each org keeps its plan's
    retention_days instead of one global window. wds_system, one tx per org
    per batch, small deletes so ingest never waits on a long lock."""
    batch = batch or config.HISTORY_PRUNE_BATCH
    async with pools.system.acquire() as conn:
        orgs = [r["id"] for r in await conn.fetch(
            "SELECT id FROM organizations WHERE deleted_at IS NULL")]
    total = 0
    longest = 0
    for org_id in orgs:
        async with tenant_tx(pools.system, org_id) as tc:
            row = await org_plan(tc, org_id)
        if row is None:
            continue
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=retention_days(row))
        while True:
            async with tenant_tx(pools.system, org_id) as tc:
                n = await delete_history_batch(tc, cutoff, batch)
            total += n
            if n < batch:
                break
        async with tenant_tx(pools.system, org_id) as tc:
            await rollup.prune_rollups(tc, retention_days(row), datetime.now(timezone.utc))
        longest = max(longest, retention_days(row))
    if total:
        log.info("tag_history pruned by plan retention", extra={"rows": total})
    if longest:  # whole months past every plan's window are dropped outright
        await rollup.drop_expired_partitions(pools, longest)
    return total
