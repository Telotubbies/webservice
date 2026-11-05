"""Edge log shipper (roadmap 9.7 ops): a tiny logging.Handler that feeds a
bounded ring buffer; a daemon thread flushes it to `.../logs` roughly every
30 s, or sooner on an error burst. At most 200 records per publish, level
>= INFO. Publishing never raises into the logging pipeline (log messages
never contain secrets — enforced by convention, see logging_setup).

Wire contract (backend/app/edge/edgelogs.py parse_log_batch): each entry is
{ts, level, source, msg} — ts in epoch SECONDS (or RFC-3339), level in
debug|info|warn|error, source <= 80 chars, msg <= 2000 chars. Fields are
truncated BEFORE json.dumps — cutting the encoded bytes would corrupt the
JSON and the backend would drop the entry.
"""

from __future__ import annotations

import collections
import json
import logging
import threading

MAX_PER_SEND = 200            # backend MAX_BATCH — surplus is dropped there
FLUSH_S = 30.0
RING_SIZE = 500
MAX_SOURCE = 80
MAX_MSG = 2000
_LEVELS = {"debug", "info", "warn", "error"}
_LEVEL_MAP = {"warning": "warn", "critical": "error", "fatal": "error"}


class LogShipper(logging.Handler):
    def __init__(self, bridge, topic: str):
        super().__init__(level=logging.INFO)
        self._bridge, self._topic = bridge, topic
        self._ring: collections.deque[bytes] = collections.deque(maxlen=RING_SIZE)
        self._burst = threading.Event()
        self._stop = threading.Event()
        self._thr: threading.Thread | None = None

    def emit(self, rec: logging.LogRecord) -> None:
        try:
            level = _LEVEL_MAP.get(rec.levelname.lower(), rec.levelname.lower())
            if level not in _LEVELS:
                level = "info"
            line = {"ts": rec.created,                   # epoch seconds
                    "level": level,
                    "source": rec.name[:MAX_SOURCE],
                    "msg": self.format(rec)[:MAX_MSG]}   # truncate BEFORE dumps
            self._ring.append(json.dumps(line, default=str,
                                         separators=(",", ":")).encode())
            if rec.levelno >= logging.ERROR:
                self._burst.set()
        except Exception:                        # noqa: BLE001 — logging must never raise
            pass

    def start(self) -> None:
        if self._thr is None:
            self._thr = threading.Thread(target=self._run, name="log-ship", daemon=True)
            self._thr.start()

    def stop(self) -> None:
        self._stop.set()
        self._burst.set()
        if self._thr is not None:
            self._thr.join(timeout=3.0)
            self._thr = None

    def _run(self) -> None:
        while not self._stop.is_set():
            self._burst.wait(FLUSH_S)
            self._burst.clear()
            self._flush()

    def _flush(self) -> None:
        while self._ring:
            try:
                batch = [self._ring.popleft() for _ in range(min(MAX_PER_SEND, len(self._ring)))]
            except IndexError:
                break
            payload = b"[" + b",".join(batch) + b"]"
            try:
                ok = self._bridge.publish_raw(self._topic, payload, qos=0)
            except Exception:                    # noqa: BLE001
                ok = False
            if not ok:
                for raw in batch:                # put them back for the next flush
                    self._ring.appendleft(raw)
                break
