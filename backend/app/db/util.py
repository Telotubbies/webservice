from __future__ import annotations

import math
from datetime import datetime, timezone
from uuid import UUID


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(dt: datetime | None = None) -> str:
    """RFC 3339 UTC with trailing Z, millisecond precision (wire format)."""
    dt = (dt or utcnow()).astimezone(timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_ts(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp must carry a timezone")
    return dt.astimezone(timezone.utc)


def finite_or_none(v):
    """JSON can't carry NaN/Inf — never let them reach REST/WS payloads."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def as_uuid(v: str | UUID) -> UUID:
    return v if isinstance(v, UUID) else UUID(str(v))
