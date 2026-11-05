"""vision models / versions / camera pins / presets (migration 0018)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _model(tc, o, name=None) -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO vision_models(org_id, name, task) VALUES ($1,$2,'detect') RETURNING id",
        o["org"], name or f"m-{uuid.uuid4().hex[:8]}")


async def _version(tc, o, model, version=1, status="draft", attested=False) -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO vision_model_versions(org_id, model_id, version, status, artifact_key, sha256, size_bytes,"
        " imgsz, classes, source_format, license_attested_at)"
        " VALUES ($1,$2,$3,$4,'k',$5,10,640,'[\"a\",\"b\"]','onnx',$6) RETURNING id",
        o["org"], model, version, status, "0" * 64, __import__("datetime").datetime.now(__import__("datetime").timezone.utc) if attested else None)


async def _camera(tc, o) -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO cameras(org_id, site_id, edge_id, name, kind, rtsp_url_enc)"
        " VALUES ($1,$2,$3,$4,'rtsp',$5) RETURNING id", o["org"], o["site"], o["edge"], f"c-{uuid.uuid4().hex[:6]}", b"x")


def test_models_isolated_between_orgs(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                m = await _model(tc, b)
                v = await _version(tc, b, m)
            async with tenant_tx(pools.app, a["org"]) as tc:
                for t in ("vision_models", "vision_model_versions", "camera_models", "class_presets"):
                    assert await tc.fetchval(f"SELECT count(*) FROM {t}") == 0, t
                with pytest.raises(asyncpg.ForeignKeyViolationError):      # b's model under a's org
                    async with tc.conn.transaction():
                        await _version(tc, a, m, 2)
            async with tenant_tx(pools.system, a["org"]) as tc:            # cfg publisher sees versions
                assert await tc.fetchval("SELECT count(*) FROM vision_model_versions WHERE id=$1", v) == 1
        finally:
            await pools.close()
    run(go())


def test_version_unique_per_model(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                m = await _model(tc, a)
                await _version(tc, a, m, 1)
                with pytest.raises(asyncpg.UniqueViolationError):
                    async with tc.conn.transaction():
                        await _version(tc, a, m, 1)
        finally:
            await pools.close()
    run(go())


def test_active_requires_attestation_check(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                m = await _model(tc, a)
                with pytest.raises(asyncpg.CheckViolationError):
                    async with tc.conn.transaction():
                        await _version(tc, a, m, 1, status="active", attested=False)
                await _version(tc, a, m, 2, status="active", attested=True)
        finally:
            await pools.close()
    run(go())


def test_pinned_version_delete_restricted(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                m = await _model(tc, a)
                v = await _version(tc, a, m, 1, status="active", attested=True)
                cam = await _camera(tc, a)
                await tc.execute("INSERT INTO camera_models(org_id, camera_id, model_version_id) VALUES ($1,$2,$3)",
                                 a["org"], cam, v)
                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    async with tc.conn.transaction():
                        await tc.execute("DELETE FROM vision_model_versions WHERE id=$1", v)
                await tc.execute("DELETE FROM camera_models WHERE camera_id=$1", cam)
                await tc.execute("DELETE FROM vision_model_versions WHERE id=$1", v)
        finally:
            await pools.close()
    run(go())


def test_preset_name_unique_per_model(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                m = await _model(tc, a)
                sql = "INSERT INTO class_presets(org_id, model_id, name, class_config) VALUES ($1,$2,'QC','{}')"
                await tc.execute(sql, a["org"], m)
                with pytest.raises(asyncpg.UniqueViolationError):
                    async with tc.conn.transaction():
                        await tc.execute(sql, a["org"], m)
        finally:
            await pools.close()
    run(go())
