"""The one write path for a tag sample — shared by device telemetry (MQTT) and
derived tags (production/derived.py), so a calculated tag gets alarms, history,
trends and live updates exactly like a device tag (spec 2026-10-19 §7,
ADR-0001 "to revisit": ingest core split out of main.py).
"""

from __future__ import annotations

import logging
import time
from uuid import UUID

from ..core import config, observability
from ..core.ratelimit import TieredRateLimiter
from ..db.context import tenant_tx
from ..db.util import iso_z, utcnow
from ..tenancy import plans
from .rollup import numeric_value

log = logging.getLogger("wds.ingest")


_CAP_TTL_S = 60.0
_caps: dict[UUID, tuple[float, int]] = {}


async def _admit(st, org_id: UUID) -> bool:
    """Per-org ingest budget (plans.ingest_msgs_per_min): one noisy tenant must not starve the rest."""
    now = time.monotonic()
    hit = _caps.get(org_id)
    if hit is None or now - hit[0] > _CAP_TTL_S:
        cap = config.INGEST_ORG_RATE_PER_MIN
        try:
            async with tenant_tx(st.pools.system, org_id) as tc:
                row = await plans.org_plan(tc, org_id)
            if row is not None:
                cap = plans.features(row)["ingest_msgs_per_min"]
        except Exception:  # noqa: BLE001 — a plan lookup failure must not stop ingest; keep the default cap
            log.warning("ingest cap lookup failed", extra={"org": str(org_id)})
        hit = _caps[org_id] = (now, cap)
    rl = getattr(st, "ingest_rl", None)
    if rl is None:
        rl = st.ingest_rl = TieredRateLimiter(window_s=60.0)
    return await rl.allow(str(org_id), hit[1])


async def record_sample(st, tag, org_id: UUID, site_id: UUID, v, q: str, ts,
                        ts_wire: str | None = None) -> None:
    """Store one sample: tag_latest (monotonic), alarm evaluation, history
    buffer, derived-tag fan-in, and the org-scoped WebSocket event."""
    await record_batch(st, [(tag, org_id, site_id, v, q, ts, ts_wire)])


async def record_batch(st, items: list) -> int:
    """Store many samples, one transaction per org instead of one per sample.
    items: (tag, org_id, site_id, v, q, ts, ts_wire). Returns how many were accepted
    (the rest hit the org's ingest budget and are counted as throttled)."""
    by_org: dict[UUID, list] = {}
    now = utcnow()
    for it in items:
        org_id, ts = it[1], it[5]
        if not await _admit(st, org_id):
            observability.note_ingest(org_id, 0.0, throttled=True)
            continue
        observability.note_ingest(org_id, (now - ts).total_seconds())
        by_org.setdefault(org_id, []).append(it)
    accepted = 0
    for org_id, batch in by_org.items():
        sent = []
        async with tenant_tx(st.pools.system, org_id) as tc:
            for tag, _o, site_id, v, q, ts, ts_wire in batch:
                # tag_latest is monotonic: a late/replayed sample never overwrites newer data
                res = await tc.execute(
                    "INSERT INTO tag_latest(tag_id, org_id, v, q, ts) VALUES ($1,$2,$3,$4,$5)"
                    " ON CONFLICT (tag_id) DO UPDATE SET v=excluded.v, q=excluded.q, ts=excluded.ts"
                    " WHERE tag_latest.ts < excluded.ts",
                    tag.id, tc.org_id, v, q, ts)
                await st.alarms.evaluate(tc, tag.id, v, q, ts)
                sent.append((res.endswith(" 1"), tag, site_id, v, q, ts, ts_wire))
        for fresh, tag, site_id, v, q, ts, ts_wire in sent:
            accepted += 1
            st.history_buf.append((tag.id, ts, org_id, v, q, numeric_value(v)))
            derived = getattr(st, "derived", None)
            if derived is not None:
                derived.on_sample(tag.id, v, q, ts)
            if fresh:
                # Org-scoped fan-out (v4 T9): only members of org_id see this.
                st.ws.broadcast(
                    {"type": "tag", "name": st.registry.display_name(tag),
                     "v": v, "q": q, "ts": ts_wire or iso_z(ts),
                     "org_id": str(org_id), "site_id": str(site_id),
                     "tag_id": str(tag.id), "path": tag.path},
                    org_id=org_id)
    if len(st.history_buf) >= config.HISTORY_FLUSH_ROWS:
        await flush_history(st)
    return accepted


async def flush_history(st) -> None:
    if not st.history_buf:
        return
    rows, st.history_buf = st.history_buf, []
    # rows carry their own org (routed by topic, doc 17 §4) — group so each
    # tenant_tx only ever writes its own tenant's rows
    by_org: dict[UUID, list] = {}
    for r in rows:
        by_org.setdefault(r[2], []).append(r)
    for org_id, batch in by_org.items():
        async with tenant_tx(st.pools.system, org_id) as tc:
            await tc.executemany(
                "INSERT INTO tag_history(tag_id, ts, org_id, v, q, vn) VALUES ($1,$2,$3,$4,$5,$6)"
                " ON CONFLICT (tag_id, ts) DO NOTHING", batch)  # QoS1 replay dedup (I10)
