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
MAX_MODEL_BYTES = 500 * 1024 * 1024


class TooLarge(Exception):
    pass


def path(org_id: UUID, video_id: UUID) -> Path:
    return Path(config.VIDEO_DIR) / str(org_id) / str(video_id)


def key(org_id: UUID, video_id: UUID) -> str:
    return f"videos/{org_id}/{video_id}"


def model_path(org_id: UUID, version_id: UUID) -> Path:
    return Path(config.MODEL_DIR) / str(org_id) / f"{version_id}.onnx"


def model_key(org_id: UUID, version_id: UUID) -> str:
    return f"models/{org_id}/{version_id}.onnx"


async def put(org_id: UUID, video_id: UUID, chunks: AsyncIterator[bytes]) -> tuple[int, str]:
    return await put_file(path(org_id, video_id), chunks, MAX_VIDEO_BYTES)


async def put_file(p: Path, chunks: AsyncIterator[bytes], max_bytes: int) -> tuple[int, str]:
    """Stream `chunks` to `p`; return (size, sha256). Past `max_bytes` the
    partial file is removed and TooLarge is raised."""
    p.parent.mkdir(parents=True, exist_ok=True)
    h, size = hashlib.sha256(), 0
    try:
        with open(p, "wb") as f:
            async for c in chunks:
                size += len(c)
                if size > max_bytes:
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
