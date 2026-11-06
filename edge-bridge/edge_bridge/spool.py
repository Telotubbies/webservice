"""Durable, bounded FIFO for telemetry while the broker is unreachable (F03).

One sqlite file in WAL mode under STATE_DIR (the persistent edge-state
volume), so the backlog survives a gateway restart. Rows are deleted only
when their PUBACK arrives (`ack`); when the spool is full the OLDEST rows go
and `dropped` counts them — the newest data is the most useful on recovery.

Env:
  TELEMETRY_SPOOL_PATH      default $STATE_DIR/telemetry-spool.sqlite
  TELEMETRY_SPOOL_MAX_ROWS  default 200000 (~1 h of 50 tags @ 1 Hz, tens of MB)
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

DEFAULT_MAX_ROWS = 200_000
log = logging.getLogger("edge_bridge.spool")


class TelemetrySpool:
    def __init__(self, path: str, max_rows: int = DEFAULT_MAX_ROWS):
        self.path = path
        self.max_rows = max(1, max_rows)
        self.dropped = 0          # oldest rows evicted because the spool was full
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        try:
            self._db = self._open(path)
        except sqlite3.DatabaseError:
            # unreadable file (disk fault): keep it for forensics, start empty
            self.corrupt_path = f"{path}.corrupt-{int(time.time())}"
            os.replace(path, self.corrupt_path)
            for ext in ("-wal", "-shm"):
                if os.path.exists(path + ext):
                    os.remove(path + ext)
            self._db = self._open(path)
        self._depth = self._db.execute("SELECT COUNT(*) FROM spool").fetchone()[0]

    @staticmethod
    def _open(path: str) -> sqlite3.Connection:
        db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            # NORMAL survives a process crash/restart; only an OS crash can lose the last commits
            db.execute("PRAGMA synchronous=NORMAL")
            # AUTOINCREMENT: ids never reused, so id order == append order forever
            db.execute("CREATE TABLE IF NOT EXISTS spool ("
                             "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                             " topic TEXT NOT NULL, payload TEXT NOT NULL)")
        except sqlite3.DatabaseError:
            db.close()  # Windows cannot rename an open file
            raise
        return db

    @classmethod
    def from_env(cls) -> "TelemetrySpool":
        state_dir = os.getenv("STATE_DIR", "/var/lib/wds-edge")
        path = os.getenv("TELEMETRY_SPOOL_PATH") or str(Path(state_dir) / "telemetry-spool.sqlite")
        return cls(path, int(os.getenv("TELEMETRY_SPOOL_MAX_ROWS", DEFAULT_MAX_ROWS)))

    def append(self, topic: str, payload: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO spool(topic, payload) VALUES (?, ?)", (topic, payload))
            self._depth += 1
            over = self._depth - self.max_rows
            if over > 0:
                n = self._db.execute(
                    "DELETE FROM spool WHERE id IN (SELECT id FROM spool ORDER BY id LIMIT ?)",
                    (over,)).rowcount
                self._depth -= n
                before = self.dropped
                self.dropped += n
                if before // 100 != self.dropped // 100 or before == 0:  # rate-limited: ~1 line / 100 drops
                    log.warning("telemetry spool full (%d rows), dropping oldest (dropped=%d)",
                                self.max_rows, self.dropped)

    def peek(self, after_id: int, limit: int) -> list[tuple[int, str, str]]:
        """Oldest `limit` rows with id > after_id, in append order."""
        with self._lock:
            return self._db.execute(
                "SELECT id, topic, payload FROM spool WHERE id > ? ORDER BY id LIMIT ?",
                (after_id, limit)).fetchall()

    def ack(self, row_id: int) -> None:
        with self._lock:
            # rowcount 0 = already evicted while in flight; nothing to do
            self._depth -= self._db.execute("DELETE FROM spool WHERE id = ?", (row_id,)).rowcount

    def depth(self) -> int:
        return self._depth

    def close(self) -> None:
        with self._lock:
            self._db.close()
