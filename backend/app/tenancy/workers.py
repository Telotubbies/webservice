"""Background workers (roadmap §9 5.5, §12 8.2/8.3, §10 6.2).

Loops registered from main.py's lifespan alongside the existing `_every`
entries (see WIRING in the final report — main.py is read-only for this
change so these are plain `async def`s):

    asyncio.create_task(_every(config.WEBHOOK_SWEEP_S,
        lambda: workers.webhook_sweep(st), "webhook_sweep")),
    asyncio.create_task(_every(config.JOBS_WORKER_S,
        lambda: workers.job_runner(st), "job_runner")),
    asyncio.create_task(_every(config.EXPORT_SWEEP_S,
        lambda: workers.expired_exports_sweep(st), "expired_exports_sweep")),

and the per-org retention prune replaces the global `_prune_history`
registration:

    asyncio.create_task(_every(config.HISTORY_PRUNE_S,
        lambda: plans.retention_prune(st.pools), "retention_prune")),

`job_runner` claims due rows off the jobs table as wds_system (system_all
policy — org-scoped rows visible), first requeuing claims orphaned >10min
(jobs.reap_stuck), and dispatches each claimed job on its own task:

- webhook_deliver — one job per (endpoint, event); POSTs the signed JSON
  body (X-WDS-Signature = HMAC-SHA256 over the raw body, plus a
  X-WDS-Delivery-Id dedup header) through the egress guard (no redirect
  following, public IPs only) and records the outcome on
  webhook_deliveries. Failures go through jobs.fail's linear backoff;
  egress refusals and disabled endpoints are terminal 'failed'.
- export_zip    — builds the owner-requested archive under EXPORT_DIR.
- org_purge     — calls wds_purge_organization(), the 30-day hard delete,
  then removes the org's on-disk trees (exports/videos/models).

`webhook_sweep` tails the four event sources with per-org (ts, id) cursors
in webhook_cursor — alarms.py stays untouched, per spec.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from ..core import config, egress, jobs
from ..datasources import secretbox
from ..db import audit
from ..db.context import global_tx, tenant_tx
from ..db.util import utcnow

log = logging.getLogger("wds.workers")

JOB_KINDS = ("webhook_deliver", "export_zip", "org_purge")


# ---------------------------------------------------------------------------
# job runner — reap stuck claims, claim_due, dispatch, complete-or-fail
# (jobs.py backoff). Claimed jobs are dispatched concurrently so one slow
# job (a big export) can't head-of-line block the rest of the batch.
# ---------------------------------------------------------------------------
async def job_runner(st, batch: int = 10) -> int:
    """One sweep of due jobs. Returns jobs handled (for tests)."""
    async with global_tx(st.pools.system) as conn:
        await jobs.reap_stuck(conn)
        due = await jobs.claim_due(conn, JOB_KINDS, limit=batch)
    await asyncio.gather(*(_run_job(st, job) for job in due))
    return len(due)


async def _run_job(st, job) -> None:
    payload = job["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    try:
        if job["kind"] == "webhook_deliver":
            await _deliver_webhook(st, payload, job_id=job["id"])
        elif job["kind"] == "export_zip":
            await _run_export(st, payload)
        elif job["kind"] == "org_purge":
            await _run_purge(st, payload)
        else:                                       # pragma: no cover
            raise ValueError(f"unknown job kind {job['kind']}")
    except Exception as exc:  # noqa: BLE001 — retry via the job table
        log.warning("job %s %s failed: %s", job["id"], job["kind"], exc)
        async with global_tx(st.pools.system) as conn:
            await jobs.fail(conn, job["id"], exc, retry_in_s=30)
        # attempts was bumped by claim_due — >= max means fail() went 'dead':
        # give the webhook delivery a terminal status instead of 'queued'.
        if (job["kind"] == "webhook_deliver"
                and job["attempts"] >= job["max_attempts"]):
            await _fail_delivery(st, payload, str(exc)[:2000], job["id"])
    else:
        async with global_tx(st.pools.system) as conn:
            await jobs.complete(conn, job["id"])


# ---------------------------------------------------------------------------
# outbound webhooks (§9 5.5)
# ---------------------------------------------------------------------------
# Each source: (cursor row, SQL returning (id, ts, payload-dict row)). The
# (ts, id) tuple cursor survives same-millisecond bursts; WEBHOOK_BATCH caps
# a sweep so a backlog drains over several ticks.
_SOURCES = {
    "alarm_raised":
        "SELECT id, tag_id, rule_id, severity, raised_at AS ts"
        " FROM alarms"
        " WHERE (raised_at, id) > ($1, $2)"
        " ORDER BY raised_at, id LIMIT $3",
    "alarm_cleared":
        "SELECT id, tag_id, rule_id, severity, cleared_at AS ts"
        " FROM alarms"
        " WHERE cleared_at IS NOT NULL AND (cleared_at, id) > ($1, $2)"
        " ORDER BY cleared_at, id LIMIT $3",
    "incident_opened":
        "SELECT id, title, severity, status, created_at AS ts"
        " FROM incidents"
        " WHERE (created_at, id) > ($1, $2)"
        " ORDER BY created_at, id LIMIT $3",
    # 0042 adds downtimes.classified_at — the source is skipped entirely
    # when the column isn't there (migration order independent).
    "downtime_classified":
        "SELECT id, reason_id, device_id, classified_at AS ts"
        " FROM downtimes"
        " WHERE classified_at IS NOT NULL AND (classified_at, id) > ($1, $2)"
        " ORDER BY classified_at, id LIMIT $3",
}

_have_classified: bool | None = None


async def _sweepable(st) -> dict[str, str]:
    """Sources minus ones whose columns don't exist in this schema."""
    global _have_classified
    if _have_classified is None:
        async with global_tx(st.pools.system) as conn:
            _have_classified = bool(await conn.fetchval(
                "SELECT 1 FROM information_schema.columns"
                " WHERE table_name='downtimes' AND column_name='classified_at'"))
    src = dict(_SOURCES)
    if not _have_classified:
        src.pop("downtime_classified", None)
    return src


async def webhook_sweep(st) -> int:
    """Tail event sources; enqueue one webhook_deliver job per new row that
    at least one enabled endpoint subscribes to. Returns jobs enqueued."""
    sources = await _sweepable(st)
    enqueued = 0
    async with global_tx(st.pools.system) as conn:
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM webhook_endpoints WHERE enabled")]
    for org_id in orgs:
        enqueued += await _sweep_org(st, org_id, sources)
    return enqueued


async def _sweep_org(st, org_id: UUID, sources: dict[str, str]) -> int:
    n = 0
    async with tenant_tx(st.pools.system, org_id) as tc:
        # webhook_endpoints carries a permissive system_all RLS policy — the
        # org filter below is the ONLY thing keeping org A's sweep off org
        # B's URLs/secrets. Do not drop it.
        endpoints = [r for r in await tc.fetch(
            "SELECT id, events FROM webhook_endpoints"
            " WHERE enabled AND org_id=$1", org_id)]
        if not endpoints:
            return 0
        for event, sql in sources.items():
            subs = [e["id"] for e in endpoints if event in (e["events"] or [])]
            if not subs:
                continue
            cur = await tc.fetchrow(
                "SELECT last_ts, last_id FROM webhook_cursor"
                " WHERE org_id=$1 AND source=$2 FOR UPDATE", org_id, event)
            ts = cur["last_ts"] if cur else datetime.min.replace(
                tzinfo=timezone.utc)
            last_id = cur["last_id"] if cur else UUID(int=0)
            rows = await tc.fetch(sql, ts, last_id, config.WEBHOOK_BATCH)
            for r in rows:
                payload = {k: (v.isoformat() if isinstance(v, datetime)
                               else str(v) if isinstance(v, UUID) else v)
                           for k, v in dict(r).items() if k != "ts"}
                for endpoint_id in subs:
                    did = await tc.fetchval(
                        "INSERT INTO webhook_deliveries(org_id, endpoint_id,"
                        " event) VALUES ($1,$2,$3) RETURNING id",
                        org_id, endpoint_id, event)
                    await jobs.enqueue(tc, "webhook_deliver", {
                        "delivery_id": did, "org_id": str(org_id),
                        "event": event, "data": payload},
                        org_id=org_id, max_attempts=8)
                    n += 1
                ts, last_id = r["ts"], r["id"]
            if rows:
                await tc.execute(
                    "INSERT INTO webhook_cursor(org_id, source,"
                    " last_ts, last_id) VALUES ($1,$2,$3,$4)"
                    " ON CONFLICT (org_id, source) DO UPDATE"
                    " SET last_ts=EXCLUDED.last_ts, last_id=EXCLUDED.last_id",
                    org_id, event, ts, last_id)
    return n


def _post(url: str, body: bytes, headers: dict) -> int:
    """Egress-guarded POST: SSRF policy check (scheme/host/resolved IPs), then
    send without following redirects. Raises egress.EgressError — the caller
    marks the delivery failed instead of retrying."""
    egress.check_url(url)                           # defense in depth; raises
    return egress.post_no_redirect(
        url, body, headers, timeout=config.WEBHOOK_TIMEOUT_S)


async def _fail_delivery(st, payload: dict, error: str, job_id=None) -> None:
    """Terminal status on webhook_deliveries (egress refusal, disabled
    endpoint, attempts exhausted). Never raises — the org may be purged."""
    try:
        async with tenant_tx(st.pools.system, UUID(payload["org_id"])) as tc:
            await tc.execute(
                "UPDATE webhook_deliveries SET status='failed', last_error=$2,"
                " job_id=COALESCE($3, job_id), updated_at=now() WHERE id=$1",
                payload["delivery_id"], error[:2000], job_id)
    except Exception as exc:                        # noqa: BLE001
        log.warning("webhook delivery %s: mark failed: %s",
                    payload.get("delivery_id"), exc)


async def _deliver_webhook(st, payload: dict, job_id=None) -> None:
    did = payload["delivery_id"]
    org_id = UUID(payload["org_id"])
    async with tenant_tx(st.pools.system, org_id) as tc:
        d = await tc.fetchrow(
            "SELECT d.id, d.attempts, e.url, e.secret_enc, e.enabled"
            " FROM webhook_deliveries d"
            " JOIN webhook_endpoints e ON e.id = d.endpoint_id"
            " WHERE d.id=$1", did)
    if d is None:
        return                                      # purged mid-flight
    if not d["enabled"]:
        await _fail_delivery(st, payload, "endpoint disabled", job_id)
        return                                      # terminal — no retry
    body = json.dumps({
        "event": payload["event"], "org_id": payload["org_id"],
        "at": payload.get("at") or utcnow().isoformat(),
        "data": payload["data"],
    }, separators=(",", ":")).encode()
    secret = secretbox.open_(bytes(d["secret_enc"]))["secret"]
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    try:
        code = await asyncio.get_running_loop().run_in_executor(
            None, _post, d["url"], body,
            {"Content-Type": "application/json",
             "X-WDS-Event": payload["event"],
             "X-WDS-Signature": f"sha256={sig}",
             "X-WDS-Delivery-Id": str(did),
             "User-Agent": "wds-webhook/1.0"})
    except egress.EgressError as exc:
        await _fail_delivery(st, payload, f"egress refused: {exc}", job_id)
        return                                      # SSRF block — no retry
    ok = 200 <= code < 300
    async with tenant_tx(st.pools.system, org_id) as tc:
        await tc.execute(
            "UPDATE webhook_deliveries SET status=$2, attempts=attempts+1,"
            " last_code=$3, last_error=$4, job_id=COALESCE($5, job_id),"
            " updated_at=now(), at=now() WHERE id=$1",
            did, "delivered" if ok else "queued", code,
            None if ok else f"http {code}", job_id)
    if not ok:
        raise RuntimeError(f"webhook delivery {did} -> HTTP {code}")


# ---------------------------------------------------------------------------
# owner data export (§12 8.2) — bounded zip under EXPORT_DIR/<org>/
# ---------------------------------------------------------------------------
# table -> query (run inside tenant_tx; RLS scopes rows to the org).
_EXPORT_QUERIES = {
    "organization":
        f"SELECT id, name, slug, plan, plan_limits, timezone, language,"
        f"       created_at, trial_ends_at FROM organizations WHERE id=$1",
    "sites": "SELECT * FROM sites",
    "edges":
        # only columns wds_system is granted (0001's narrow column list)
        "SELECT id, site_id, status, mqtt_username, last_hb_at, clock_ok,"
        " adapter, buffer_depth, buffer_dropped FROM edges",
    "tags": "SELECT * FROM tags",
    "alarm_rules": "SELECT * FROM alarm_rules",
    "alarms": "SELECT * FROM alarms",
    "audit_log": "SELECT * FROM audit_log",
    "members":
        "SELECT m.role, m.created_at, u.sub, u.display_name"
        " FROM memberships m JOIN users u ON u.id = m.user_id",
    "invites":
        "SELECT email, role, expires_at, accepted_at, created_at"
        " FROM invites",
    "incidents": "SELECT * FROM incidents",
    "tag_history":
        "SELECT tag_id, ts, org_id, v, q FROM tag_history"
        " WHERE ts > now() - ($1 || ' days')::interval"
        " ORDER BY ts DESC LIMIT " + str(config.EXPORT_HISTORY_MAX_ROWS),
}


def _write_zip(path, data: dict[str, list[dict]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, rows in data.items():
            z.writestr(f"{name}.json",
                       json.dumps(rows, default=str, ensure_ascii=False))
    return path.stat().st_size


async def _run_export(st, payload: dict) -> None:
    export_id = UUID(payload["export_id"])
    org_id = UUID(payload["org_id"])
    async with tenant_tx(st.pools.system, org_id) as tc:
        await tc.execute(
            "UPDATE org_exports SET status='running' WHERE id=$1", export_id)
        data: dict[str, list[dict]] = {}
        for name, q in _EXPORT_QUERIES.items():
            if name == "organization":
                data[name] = [dict(r) for r in await tc.fetch(q, org_id)]
            elif name == "tag_history":
                data[name] = [dict(r) for r in await tc.fetch(
                    q, str(config.EXPORT_HISTORY_DAYS))]
            else:
                data[name] = [dict(r) for r in await tc.fetch(q)]
    path = Path(config.EXPORT_DIR) / str(org_id) / f"{export_id}.zip"
    try:
        size = await asyncio.to_thread(_write_zip, path, data)
        if size > config.EXPORT_MAX_BYTES:
            path.unlink(missing_ok=True)
            raise RuntimeError(f"export too large ({size} bytes)")
    except Exception as exc:
        async with tenant_tx(st.pools.system, org_id) as tc:
            await tc.execute(
                "UPDATE org_exports SET status='failed', error=$2"
                " WHERE id=$1", export_id, str(exc)[:2000])
        raise
    expires = utcnow() + timedelta(days=config.EXPORT_TTL_DAYS)
    async with tenant_tx(st.pools.system, org_id) as tc:
        await tc.execute(
            "UPDATE org_exports SET status='done', file_path=$2,"
            " size_bytes=$3, ready_at=now(), expires_at=$4 WHERE id=$1",
            export_id, str(path), size, expires)
        await audit.append(tc, "wds:export_worker", "org.export_ready",
                           {"export_id": str(export_id)}, {"bytes": size})


def _contained(base: str, path: str) -> Path | None:
    """Resolve `path` and return it only if it lives under `base` — a tampered
    file_path must never unlink/remove outside the storage root."""
    root = Path(base).resolve()
    try:
        p = Path(path).resolve()
    except OSError:
        return None
    return p if root != p and root in p.parents else None


async def expired_exports_sweep(st) -> int:
    """Delete zip files past expires_at (the row stays — the download route
    answers 410), fail exports orphaned 'running' by a crashed worker, and
    prune terminal jobs rows. Returns files removed."""
    n = 0
    async with global_tx(st.pools.system) as conn:
        rows = await conn.fetch(
            "SELECT id, org_id, file_path FROM org_exports"
            " WHERE status='done' AND file_path IS NOT NULL"
            " AND expires_at < now() LIMIT 100")
        stuck = await conn.fetch(
            "SELECT id, org_id FROM org_exports WHERE status='running'"
            " AND created_at < now() - interval '1 hour' LIMIT 100")
        pruned = await jobs.prune(conn)
    for r in rows:
        p = _contained(config.EXPORT_DIR, r["file_path"])
        if p is None:
            log.warning("export path outside EXPORT_DIR refused: %s",
                        r["file_path"])
        else:
            try:
                p.unlink(missing_ok=True)
                n += 1
            except OSError as exc:
                log.warning("export file remove failed %s: %s",
                            r["file_path"], exc)
        async with tenant_tx(st.pools.system, r["org_id"]) as tc:
            await tc.execute(
                "UPDATE org_exports SET file_path=NULL WHERE id=$1", r["id"])
    for r in stuck:
        async with tenant_tx(st.pools.system, r["org_id"]) as tc:
            await tc.execute(
                "UPDATE org_exports SET status='failed',"
                " error='worker lost — export abandoned' WHERE id=$1", r["id"])
    if pruned:
        log.info("jobs retention: pruned %s terminal rows", pruned)
    return n


# ---------------------------------------------------------------------------
# 30-day purge (§12 8.3)
# ---------------------------------------------------------------------------
# Org-scoped disk roots — mirrors <base>/<org_id>/ layouts written by
# _run_export and vision/storage.py. Removal is resolve+containment checked.
_ORG_DIRS = ("EXPORT_DIR", "VIDEO_DIR", "MODEL_DIR")


def _purge_org_dirs(org_id: UUID) -> None:
    for name in _ORG_DIRS:
        root = Path(getattr(config, name)).resolve()
        d = (root / str(org_id)).resolve()
        if root == d or root not in d.parents:
            continue                                # never touch the root
        try:
            shutil.rmtree(d)
        except FileNotFoundError:
            pass
        except OSError as exc:
            log.warning("purge: cannot remove %s: %s", d, exc)


async def _run_purge(st, payload: dict) -> None:
    org_id = UUID(payload["org_id"])
    async with global_tx(st.pools.system) as conn:
        await conn.execute("SELECT wds_purge_organization($1)", org_id)
    await asyncio.to_thread(_purge_org_dirs, org_id)
    log.warning("org %s purged", org_id)
