"""Adapter contract for all protocol bridges.

An adapter polls one OT data source and normalizes every point into a
`TagValue`. The bridge core (publisher + command handler) only ever sees
this interface, so swapping `sim` for `modbus`/`s7` is a config change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class Quality(str, Enum):
    GOOD = "good"
    BAD = "bad"          # connection/device failure — never show as a real value
    STALE = "stale"      # unchanged beyond deadband timeout
    UNCERTAIN = "uncertain"


@dataclass
class TagValue:
    """One normalized process value, ready to publish.

    `name` is the full dotted UNS name (site.area.line.device.signal),
    which maps 1:1 onto the MQTT topic tail via dots -> slashes.
    """

    name: str
    v: bool | int | float
    q: Quality
    ts: datetime  # UTC, source timestamp

    @property
    def topic(self) -> str:
        return self.name.replace(".", "/")

    def payload(self) -> dict:
        # Contract: ISO8601 UTC with Z suffix.
        ts = self.ts
        if ts.tzinfo is None:
            iso = ts.isoformat() + "Z"  # assumed UTC already
        else:
            iso = ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return {"v": self.v, "q": self.q.value, "ts": iso}


@dataclass
class WriteResult:
    """Outcome of a command write.

    ok=True  -> cmd-resp status "done"
    ok=False -> cmd-resp status "denied" with `detail` (e.g. "not_writable",
                "out_of_range"). Unexpected exceptions inside write() are
                mapped to status "error" by the command handler.
    """

    ok: bool
    detail: str = "ok"

    @classmethod
    def done(cls) -> "WriteResult":
        return cls(ok=True, detail="done")

    @classmethod
    def denied(cls, detail: str) -> "WriteResult":
        return cls(ok=False, detail=detail)


class TagAdapter(ABC):
    """One OT connection. `name` is used in logs and the heartbeat."""

    name: str = "abstract"

    @abstractmethod
    def read_all(self) -> list[TagValue]:
        """Return every registered tag; q=BAD for unreadable points."""

    @abstractmethod
    def write(self, tag: str, value: object) -> WriteResult:
        """Apply a command write. Must enforce `writable` and range rules."""

    def tag_map(self) -> dict[str, dict]:
        """normalized tag -> protocol-specific address/meta spec."""
        return {}

    def close(self) -> None:
        """Release the OT connection on shutdown (best effort)."""
