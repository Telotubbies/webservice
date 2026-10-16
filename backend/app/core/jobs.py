"""Internal job queue — one row per unit of background work (roadmap §12).

Producers call `enqueue` inside tenant_tx (or as wds_system for org-less
jobs). There is no central handler registry: each feature polls the kinds
it owns with `claim_due` from a loop scheduled by main.py's `_every`, then
calls `complete` or `fail` inside the same transaction as its side effects
where that is practical.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime, timezone


async def enqueue(conn, kind: str, payload: dict, *, org_id=None,
                  run_at: datetime | None = None, max_attempts: int = 5):
    return await conn.fetchval(
        "INSERT INTO jobs (org_id, kind, payload, run_at, max_attempts)"
        " VALUES ($1, $2, $3, $4, $5) RETURNING id",
        org_id, kind, json.dumps(payload),
        run_at or datetime.now(timezone.utc), max_attempts)


_CLAIM = """
UPDATE jobs SET status='running', attempts=attempts+1, locked_at=now()
WHERE id IN (
  SELECT id FROM jobs
  WHERE status='pending' AND kind=ANY($1::text[]) AND run_at<=now()
  ORDER BY run_at LIMIT $2 FOR UPDATE SKIP LOCKED)
RETURNING *
"""


async def claim_due(conn, kinds: Sequence[str], limit: int = 10):
    """Atomically take due jobs of the given kinds. Caller holds the tx."""
    return await conn.fetch(_CLAIM, list(kinds), limit)


async def reap_stuck(conn) -> int:
    """Requeue 'running' jobs whose claim is >10min old (the worker crashed
    or lost the row). attempts is kept — the retry budget is spent by real
    failures, not by the reaper. Returns rows requeued."""
    tag = await conn.execute(
        "UPDATE jobs SET status='pending', locked_at=NULL"
        " WHERE status='running'"
        " AND locked_at < now() - interval '10 minutes'")
    return int(tag.split()[-1])


async def prune(conn, *, days: int = 30) -> int:
    """Drop terminal jobs older than `days` (retention). done_at is only set
    by complete(); dead jobs fall back to created_at. System pool only."""
    tag = await conn.execute(
        "DELETE FROM jobs WHERE status IN ('done','dead')"
        " AND COALESCE(done_at, created_at)"
        "     < now() - ($1 || ' days')::interval", str(days))
    return int(tag.split()[-1])


async def complete(conn, job_id) -> None:
    await conn.execute(
        "UPDATE jobs SET status='done', done_at=now(), locked_at=NULL"
        " WHERE id=$1", job_id)


async def fail(conn, job_id, error, *, retry_in_s: int = 60) -> None:
    """Retry with linear backoff; the job goes 'dead' after max_attempts."""
    await conn.execute("""
UPDATE jobs SET
  status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
  locked_at = NULL,
  last_error = $2,
  run_at = CASE WHEN attempts >= max_attempts THEN run_at
                ELSE now() + ($3 * attempts || ' seconds')::interval END
WHERE id = $1""", job_id, str(error)[:4000], retry_in_s)
