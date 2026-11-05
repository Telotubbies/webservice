"""Plant-model storage: disk mode and the Garage/S3 mode (fake client)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.core import config
from app.plant import storage

ORG, MID = uuid4(), uuid4()
DATA = b"glTF" + b"\x00" * 5000


async def _chunks(data: bytes, n: int = 1000):
    for i in range(0, len(data), n):
        yield data[i:i + n]


def _put(data=DATA):
    return asyncio.run(storage.put(ORG, MID, _chunks(data)))


@pytest.fixture()
def disk(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PLANT_DIR", str(tmp_path))
    monkeypatch.setattr(config, "PLANT_S3_ENDPOINT", None)
    return tmp_path


def test_disk_roundtrip(disk):
    size, sha = _put()
    assert size == len(DATA) and len(sha) == 64
    assert storage.exists(ORG, MID)
    assert b"".join(storage.open_stream(ORG, MID, chunk=700)) == DATA
    storage.delete(ORG, MID)
    assert not storage.exists(ORG, MID)
    storage.delete(ORG, MID)   # idempotent


def test_too_large_leaves_no_file(disk, monkeypatch):
    monkeypatch.setattr(storage, "MAX_GLB_BYTES", 100)
    # put_file got MAX_GLB_BYTES by value at call time — patch the symbol it reads
    monkeypatch.setattr("app.plant.storage.MAX_GLB_BYTES", 100)
    with pytest.raises(storage.TooLarge):
        _put()
    assert not storage.exists(ORG, MID)


class FakeBody:
    def __init__(self, data):
        self.data, self.closed = data, False

    def iter_chunks(self, n):
        for i in range(0, len(self.data), n):
            yield self.data[i:i + n]

    def close(self):
        self.closed = True


class FakeS3:
    def __init__(self):
        self.objs: dict[tuple[str, str], bytes] = {}

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.objs[(bucket, key)] = Path(path).read_bytes()
        self.extra = ExtraArgs

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objs:
            raise KeyError(Key)

    def get_object(self, Bucket, Key):
        return {"Body": FakeBody(self.objs[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.objs.pop((Bucket, Key), None)


def test_s3_mode_uploads_then_drops_the_local_spool(tmp_path, monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(config, "PLANT_DIR", str(tmp_path))
    monkeypatch.setattr(config, "PLANT_S3_ENDPOINT", "http://garage:3900")
    monkeypatch.setattr(config, "PLANT_S3_BUCKET", "wds-plant-models")
    monkeypatch.setattr(storage, "_s3", lambda: fake)

    size, _ = _put()
    key = storage.key(ORG, MID)
    assert size == len(DATA)
    assert fake.objs[("wds-plant-models", key)] == DATA
    assert fake.extra == {"ContentType": "model/gltf-binary"}
    assert not (tmp_path / str(ORG) / f"{MID}.glb").exists()   # nothing kept on disk
    assert storage.exists(ORG, MID)
    assert b"".join(storage.open_stream(ORG, MID)) == DATA
    storage.delete(ORG, MID)
    assert not storage.exists(ORG, MID)


def test_key_is_tenant_namespaced():
    assert storage.key(ORG, MID).startswith(f"plant-models/{ORG}/")
