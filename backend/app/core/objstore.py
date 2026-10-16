"""Durable, per-organization copies of uploaded artifacts in Garage (S3).

Disk stays the serving copy; every upload is also written through to the
object store under `{kind}/{org_id}/{id}.{ext}` and removed again on delete.

Isolation rules (see docs/security/storage-threat-model.md):
  * keys are built ONLY from server-generated UUIDs and a fixed kind, so no
    user text can reach a key (no traversal, no cross-org prefix);
  * reads of an object always go through a database row under RLS first;
  * listing is only ever done for one org's prefix;
  * the credential is bucket-scoped (Garage `bucket allow`), never an admin key.
A mirror failure is logged and counted, never fatal to the upload: the disk
copy is intact and the inventory page shows the object as "not in Garage".
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from uuid import UUID

from . import config

log = logging.getLogger("wds.objstore")

KINDS = ("videos", "models", "models-src", "plant-models")
LISTED = ("videos", "models", "models-src")      # kinds that live in the artifact bucket
_CTYPE = {"mp4": "video/mp4", "webm": "video/webm", "onnx": "application/octet-stream",
          "pt": "application/octet-stream", "glb": "model/gltf-binary"}
failures = 0


def enabled() -> bool:
    return bool(config.ARTIFACT_S3_ENDPOINT)


def key(kind: str, org_id: UUID, item_id: UUID, ext: str = "") -> str:
    if kind not in KINDS or not isinstance(org_id, UUID) or not isinstance(item_id, UUID):
        raise ValueError("object keys are built from a known kind and UUIDs only")
    return f"{kind}/{org_id}/{item_id}" + (f".{ext}" if ext else "")


def prefix(org_id: UUID, kind: str | None = None) -> str:
    if not isinstance(org_id, UUID):
        raise ValueError("org_id must be a UUID")
    return f"{kind}/{org_id}/" if kind else ""


def _s3():
    import boto3  # lazy: only S3 deployments need it
    from botocore.config import Config
    return boto3.client(
        "s3", endpoint_url=config.ARTIFACT_S3_ENDPOINT, region_name=config.PLANT_S3_REGION,
        aws_access_key_id=config.ARTIFACT_S3_KEY_ID, aws_secret_access_key=config.ARTIFACT_S3_SECRET,
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}, connect_timeout=5, read_timeout=60))


async def mirror(path: str | Path, k: str) -> bool:
    """Upload a local file to `k`. Never raises."""
    global failures
    if not enabled():
        return False
    ext = k.rsplit(".", 1)[-1] if "." in k.rsplit("/", 1)[-1] else ""
    try:
        await asyncio.to_thread(_s3().upload_file, str(path), config.ARTIFACT_S3_BUCKET, k,
                                ExtraArgs={"ContentType": _CTYPE.get(ext, "application/octet-stream")})
        return True
    except Exception:  # noqa: BLE001
        failures += 1
        log.exception("object store mirror failed key=%s", k)
        return False


async def remove(k: str) -> None:
    global failures
    if not enabled():
        return
    try:
        await asyncio.to_thread(_s3().delete_object, Bucket=config.ARTIFACT_S3_BUCKET, Key=k)
    except Exception:  # noqa: BLE001
        failures += 1
        log.exception("object store delete failed key=%s", k)


def _list(p: str) -> dict[str, int]:
    out: dict[str, int] = {}
    pager = _s3().get_paginator("list_objects_v2")
    for page in pager.paginate(Bucket=config.ARTIFACT_S3_BUCKET, Prefix=p):
        for o in page.get("Contents", []):
            out[o["Key"]] = o["Size"]
    return out


async def list_org(org_id: UUID) -> dict[str, int] | None:
    """{key: size} of everything stored for this org, or None when the store is off/unreachable."""
    if not enabled():
        return None
    try:
        out: dict[str, int] = {}
        for kind in LISTED:
            out.update(await asyncio.to_thread(_list, prefix(org_id, kind)))
        return out
    except Exception:  # noqa: BLE001
        log.exception("object store list failed")
        return None
