"""Transactional outbox (F18). Rows are written in the SAME transaction as the data
that caused them, one row per subscribed webhook endpoint, with a deterministic
idempotency key so enqueueing twice cannot create two deliveries.

Demo / simulated / test sites never enqueue unless the target is explicitly
marked allow_non_production (ERP sandbox testing).
"""

from __future__ import annotations

import json
import uuid
from uuid import UUID

EVENT_TYPES = ("shift_summary.closed", "hour_summary.closed", "work_order.progress")
_NS = uuid.UUID("5b0b3d9e-6c0e-4a52-9d6e-2f0f6f7a1c11")      # fixed namespace for event keys


def idem_key(org_id: UUID, event_type: str, natural_key: str, version: int) -> str:
    """Same inputs, same key, always: the dedup contract with the receiver."""
    return str(uuid.uuid5(_NS, f"{org_id}:{event_type}:{natural_key}:v{version}"))


async def enqueue(tc, org_id: UUID, event_type: str, natural_key: str, version: int,
                  payload: dict, *, site_origin: str = "production") -> int:
    """Insert one outbox row per enabled endpoint subscribed to `event_type`.
    Returns how many NEW rows were written (0 = nothing subscribed, a duplicate, or blocked origin)."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unknown event type {event_type}")
    key = idem_key(org_id, event_type, natural_key, version)
    eps = await tc.fetch(
        "SELECT e.id, coalesce(c.allow_non_production, false) AS sandbox FROM webhook_endpoints e"
        " LEFT JOIN erp_connections c ON c.org_id = e.org_id AND c.id = e.id"
        " WHERE e.enabled AND $1 = ANY(e.events)", event_type)
    n = 0
    for ep in eps:
        if site_origin != "production" and not ep["sandbox"]:
            continue
        body = dict(payload, event=event_type, version=version, org=str(org_id))
        res = await tc.execute(
            "INSERT INTO integration_outbox(org_id, connection_id, event_type, idempotency_key, payload)"
            " VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (org_id, connection_id, idempotency_key) DO NOTHING",
            org_id, ep["id"], event_type, key, json.dumps(body, default=str))
        n += res.endswith(" 1")
    return n
