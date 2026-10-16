"""File storage for uploaded plant models (.glb).

Local disk by default (PLANT_DIR). When PLANT_S3_ENDPOINT is set the object
goes to an S3-compatible bucket instead — the deploy uses Garage
(deploy/garage/) — and nothing is kept on local disk. This is the only module
that knows the layout.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path
from typing import AsyncIterator, Iterator
from uuid import UUID

from ..core import config
from ..vision.storage import TooLarge, put_file
from .glb import MAX_GLB_BYTES

__all__ = ["TooLarge", "MAX_GLB_BYTES", "key", "put", "delete", "open_stream", "exists"]


def key(org_id: UUID, model_id: UUID) -> str:
    return f"plant-models/{org_id}/{model_id}.glb"


def _path(org_id: UUID, model_id: UUID) -> Path:
    return Path(config.PLANT_DIR) / str(org_id) / f"{model_id}.glb"


def _s3():
    import boto3  # imported lazily: only S3 deployments need it
    from botocore.config import Config
    return boto3.client(
        "s3", endpoint_url=config.PLANT_S3_ENDPOINT, region_name=config.PLANT_S3_REGION,
        aws_access_key_id=config.PLANT_S3_KEY_ID, aws_secret_access_key=config.PLANT_S3_SECRET,
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}))


def _use_s3() -> bool:
    return bool(config.PLANT_S3_ENDPOINT)


async def put(org_id: UUID, model_id: UUID, chunks: AsyncIterator[bytes]) -> tuple[int, str]:
    """Stream to a spool file, then (S3 mode) upload it. Returns (size, sha256)."""
    spool = _path(org_id, model_id)
    size, sha = await put_file(spool, chunks, MAX_GLB_BYTES)
    if _use_s3():
        try:
            await asyncio.to_thread(
                _s3().upload_file, str(spool), config.PLANT_S3_BUCKET, key(org_id, model_id),
                ExtraArgs={"ContentType": "model/gltf-binary"})
        finally:
            with contextlib.suppress(OSError):
                os.remove(spool)
    return size, sha


def delete(org_id: UUID, model_id: UUID) -> None:
    with contextlib.suppress(FileNotFoundError):
        os.remove(_path(org_id, model_id))
    if _use_s3():
        with contextlib.suppress(Exception):
            _s3().delete_object(Bucket=config.PLANT_S3_BUCKET, Key=key(org_id, model_id))


def exists(org_id: UUID, model_id: UUID) -> bool:
    if _use_s3():
        try:
            _s3().head_object(Bucket=config.PLANT_S3_BUCKET, Key=key(org_id, model_id))
            return True
        except Exception:
            return False
    return _path(org_id, model_id).is_file()


def open_stream(org_id: UUID, model_id: UUID, chunk: int = 1 << 20) -> Iterator[bytes]:
    """Blocking byte iterator — hand it to StreamingResponse (threadpooled)."""
    if _use_s3():
        body = _s3().get_object(Bucket=config.PLANT_S3_BUCKET, Key=key(org_id, model_id))["Body"]
        try:
            yield from body.iter_chunks(chunk)
        finally:
            body.close()
        return
    with open(_path(org_id, model_id), "rb") as f:
        while c := f.read(chunk):
            yield c
