"""MultiAdapter — fans one bridge out over several per-source adapters."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from .base import Quality, TagAdapter, TagValue, WriteResult

log = logging.getLogger("edge_bridge.multi")


class MultiAdapter(TagAdapter):
    name = "multi"

    def __init__(self, adapters: dict[str, TagAdapter]):
        self._adapters = dict(adapters)
        self._errors: dict[str, str] = {}

    def source_errors(self) -> dict[str, str]:
        return dict(self._errors)

    def read_all(self) -> list[TagValue]:
        out: list[TagValue] = []
        for sid, ad in self._adapters.items():
            try:
                out.extend(ad.read_all())
                self._errors.pop(sid, None)
            except Exception as exc:  # one dead source must not stop the others
                self._errors[sid] = str(exc) or type(exc).__name__
                log.warning("source %s read failed: %s", sid, exc)
                ts = datetime.now(timezone.utc)
                out.extend(TagValue(name=t, v=0.0, q=Quality.BAD, ts=ts)
                           for t in ad.tag_map())
        return out

    def write(self, tag: str, value: object) -> WriteResult:
        for ad in self._adapters.values():
            if tag in ad.tag_map():
                return ad.write(tag, value)
        return WriteResult.denied("not_writable")

    def tag_map(self) -> dict[str, dict]:
        merged: dict[str, dict] = {}
        for ad in self._adapters.values():
            merged.update(ad.tag_map())
        return merged

    def close(self) -> None:
        for ad in self._adapters.values():
            try:
                ad.close()
            except Exception:
                pass
