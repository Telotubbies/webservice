"""File storage for uploaded videos. The only module that touches the disk
layout, so an object store can replace it later (spec 6.2)."""

from __future__ import annotations

import contextlib
import hashlib
import os
from pathlib import Path
from typing import AsyncIterator
from uuid import UUID

from .. import config

MAX_VIDEO_BYTES = 200 * 1024 * 1024


class TooLarge(Exception):
    pass


def path(org_id: UUID, video_id: UUID) -> Path:
    return Path(config.VIDEO_DIR) / str(org_id) / str(video_id)


def key(org_id: UUID, video_id: UUID) -> str:
    return f"videos/{org_id}/{video_id}"


async def put(org_id: UUID, video_id: UUID, chunks: AsyncIterator[bytes]) -> tuple[int, str]:
    """Stream `chunks` to disk; return (size, sha256). Past MAX_VIDEO_BYTES the
    partial file is removed and TooLarge is raised."""
    p = path(org_id, video_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    h, size = hashlib.sha256(), 0
    try:
        with open(p, "wb") as f:
            async for c in chunks:
                size += len(c)
                if size > MAX_VIDEO_BYTES:
                    raise TooLarge
                h.update(c)
                f.write(c)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(p)
        raise
    return size, h.hexdigest()


def delete(org_id: UUID, video_id: UUID) -> None:
    with contextlib.suppress(FileNotFoundError):
        os.remove(path(org_id, video_id))
