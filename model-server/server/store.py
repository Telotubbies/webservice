"""Model file cache: download once, verify sha256, keep the newest two (rollback)."""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

MAX_MODEL_BYTES = 600 * 1024 * 1024


def http_fetch(url: str, dest: Path) -> None:
    if urlsplit(url).scheme not in ("http", "https"):
        raise ValueError("model url must be http(s)")
    got = 0
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:   # noqa: S310
        while chunk := r.read(1 << 20):
            got += len(chunk)
            if got > MAX_MODEL_BYTES:
                raise ValueError("model larger than the allowed maximum")
            f.write(chunk)


class ModelStore:
    def __init__(self, directory, fetch=http_fetch, keep: int = 2):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._fetch, self._keep = fetch, keep
        self._lock = threading.Lock()

    def path(self, sha256: str) -> Path:
        return self.dir / f"{sha256}.onnx"

    def ensure(self, url: str, sha256: str) -> Path:
        """The verified file for `sha256`; a cached one needs no network."""
        with self._lock:
            final = self.path(sha256)
            if final.exists():
                os.utime(final)                       # most recently wanted survives pruning
                return final
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".dl-")
            os.close(fd)
            try:
                self._fetch(url, Path(tmp))
                h = hashlib.sha256()
                with open(tmp, "rb") as f:
                    while chunk := f.read(1 << 20):
                        h.update(chunk)
                if h.hexdigest() != sha256:
                    raise ValueError("sha256 mismatch: the downloaded file is not the pinned version")
                os.replace(tmp, final)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            self._prune(final)
            return final

    def _prune(self, keep_path: Path) -> None:
        files = sorted(self.dir.glob("*.onnx"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[self._keep:]:
            if p != keep_path:
                try:
                    p.unlink()
                except OSError:
                    pass
