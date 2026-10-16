"""cameras / videos (migration 0017): tenant isolation, kind CHECKs, RESTRICT on
videos in use, unique camera name per edge."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.db

from tenancy.conftest import make_pools, run


async def _video(tc, o) -> uuid.UUID:
    vid = uuid.uuid4()
    await tc.execute(
        "INSERT INTO videos(id, org_id, site_id, filename, content_type, size_bytes, sha256, storage_key)"
        " VALUES ($1,$2,$3,'a.mp4','video/mp4',10,$4,$5)",
        vid, o["org"], o["site"], "0" * 64, f"videos/{o['org']}/{vid}")
    return vid


async def _upload_cam(tc, o, video, name="cam1") -> uuid.UUID:
    return await tc.fetchval(
        "INSERT INTO cameras(org_id, site_id, edge_id, name, kind, video_id)"
        " VALUES ($1,$2,$3,$4,'upload',$5) RETURNING id", o["org"], o["site"], o["edge"], name, video)


def test_cameras_isolated_between_orgs(two_orgs):
    a, b = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, b["org"]) as tc:
                cam_b = await _upload_cam(tc, b, await _video(tc, b))
            async with tenant_tx(pools.app, a["org"]) as tc:
                for t in ("cameras", "videos"):
                    assert await tc.fetchval(f"SELECT count(*) FROM {t}") == 0, t
                with pytest.raises(asyncpg.ForeignKeyViolationError):    # b's edge under a's org
                    async with tc.conn.transaction():
                        await _upload_cam(tc, {**a, "edge": b["edge"]}, await _video(tc, a))
            async with tenant_tx(pools.system, a["org"]) as tc:          # cfg publisher sees all
                assert await tc.fetchval("SELECT count(*) FROM cameras WHERE id=$1", cam_b) == 1
        finally:
            await pools.close()
    run(go())


def test_camera_kind_check(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                for kind, video in (("rtsp", None), ("upload", None)):
                    with pytest.raises(asyncpg.CheckViolationError):
                        async with tc.conn.transaction():
                            await tc.execute(
                                "INSERT INTO cameras(org_id, site_id, edge_id, name, kind, video_id)"
                                " VALUES ($1,$2,$3,'bad',$4,$5)",
                                a["org"], a["site"], a["edge"], kind, video)
                with pytest.raises(asyncpg.CheckViolationError):        # fps out of range
                    async with tc.conn.transaction():
                        await tc.execute(
                            "INSERT INTO cameras(org_id, site_id, edge_id, name, kind, rtsp_url_enc, fps_sample)"
                            " VALUES ($1,$2,$3,'fast','rtsp',$4,30)",
                            a["org"], a["site"], a["edge"], b"x")
        finally:
            await pools.close()
    run(go())


def test_video_delete_restricted_while_camera_uses_it(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                vid = await _video(tc, a)
                cam = await _upload_cam(tc, a, vid)
                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    async with tc.conn.transaction():
                        await tc.execute("DELETE FROM videos WHERE id=$1", vid)
                await tc.execute("DELETE FROM cameras WHERE id=$1", cam)
                await tc.execute("DELETE FROM videos WHERE id=$1", vid)
        finally:
            await pools.close()
    run(go())


def test_camera_name_unique_per_edge(two_orgs):
    a, _ = two_orgs
    from app.db.context import tenant_tx

    async def go():
        pools = await make_pools()
        try:
            async with tenant_tx(pools.app, a["org"]) as tc:
                vid = await _video(tc, a)
                await _upload_cam(tc, a, vid, "dup")
                with pytest.raises(asyncpg.UniqueViolationError):
                    async with tc.conn.transaction():
                        await _upload_cam(tc, a, vid, "dup")
        finally:
            await pools.close()
    run(go())
