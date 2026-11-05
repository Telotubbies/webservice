"""The one write path for a tag sample — shared by device telemetry (MQTT) and
derived tags (production/derived.py), so a calculated tag gets alarms, history,
trends and live updates exactly like a device tag (spec 2026-10-19 §7,
ADR-0001 "to revisit": ingest core split out of main.py).
"""

from __future__ import annotations

import logging
from uuid import UUID

from ..core import config
from ..db.context import tenant_tx
from ..db.util import iso_z
from .rollup import numeric_value

log = logging.getLogger("wds.ingest")


async def record_sample(st, tag, org_id: UUID, site_id: UUID, v, q: str, ts,
                        ts_wire: str | None = None) -> None:
    """Store one sample: tag_latest (monotonic), alarm evaluation, history
    buffer, derived-tag fan-in, and the org-scoped WebSocket event."""
    async with tenant_tx(st.pools.system, org_id) as tc:
        # tag_latest is monotonic: a late/replayed sample never overwrites newer data
        res = await tc.execute(
            "INSERT INTO tag_latest(tag_id, org_id, v, q, ts) VALUES ($1,$2,$3,$4,$5)"
            " ON CONFLICT (tag_id) DO UPDATE SET v=excluded.v, q=excluded.q, ts=excluded.ts"
            " WHERE tag_latest.ts < excluded.ts",
            tag.id, tc.org_id, v, q, ts)
        await st.alarms.evaluate(tc, tag.id, v, q, ts)
    st.history_buf.append((tag.id, ts, org_id, v, q, numeric_value(v)))
    if len(st.history_buf) >= config.HISTORY_FLUSH_ROWS:
        await flush_history(st)
    derived = getattr(st, "derived", None)
    if derived is not None:
        derived.on_sample(tag.id, v, q, ts)
    if res.endswith(" 1"):
        # Org-scoped fan-out (v4 T9): only members of org_id see this.
        # `name` is the real site code + path (== v1_name for the shim site);
        # org/site/tag ids ride along for the CONTRACT.v2 §5 wire.
        st.ws.broadcast(
            {"type": "tag", "name": st.registry.display_name(tag),
             "v": v, "q": q, "ts": ts_wire or iso_z(ts),
             "org_id": str(org_id), "site_id": str(site_id),
             "tag_id": str(tag.id), "path": tag.path},
            org_id=org_id)


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
