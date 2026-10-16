"""Frame relay: latest-frame buffer, slow consumers skip, ownership check, stream signatures (plan M1-03 T5)."""

from __future__ import annotations

import asyncio
import time
import uuid

import pytest

from app.vision.relay import MAX_FRAME_BYTES, FrameRelay, parse_stat, stream_sig, verify_stream_sig


def run(coro):
    return asyncio.run(coro)


def _relay(owned):
    async def lookup(edge_id):
        return owned.get(edge_id, set())
    return FrameRelay(lookup, ttl=30.0)


def test_latest_returns_newest_only():
    r = _relay({})
    cam = uuid.uuid4()
    r.push(cam, b"1")
    r.push(cam, b"2")
    seq, jpeg = r.latest(cam)
    assert jpeg == b"2" and seq == 2
    assert r.latest(uuid.uuid4()) is None


def test_slow_consumer_skips_frames_and_memory_is_flat():
    async def go():
        r = _relay({})
        cam = uuid.uuid4()
        got = []

        async def consume():
            async for seq, jpeg in r.frames(cam):
                got.append(jpeg)
                await asyncio.sleep(0.2)          # slow viewer
                if len(got) == 3:
                    return
        t = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        for i in range(100):                       # producer far faster than the viewer
            r.push(cam, str(i).encode())
            await asyncio.sleep(0.01)
        await asyncio.wait_for(t, 5)
        assert len(got) == 3 and int(got[-1]) > 20          # skipped, did not queue
        assert r.buffered_bytes() < 10                      # one latest frame, no per-viewer queue
    run(go())


def test_frame_from_wrong_edge_ignored_and_oversize_dropped():
    async def go():
        edge, other, cam = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        r = _relay({edge: {cam}})
        assert await r.on_frame(edge, cam, b"jpeg") is True
        assert await r.on_frame(other, cam, b"jpeg2") is False
        assert await r.on_frame(edge, uuid.uuid4(), b"x") is False
        assert await r.on_frame(edge, cam, b"x" * (MAX_FRAME_BYTES + 1)) is False
        assert r.latest(cam)[1] == b"jpeg"
    run(go())


def test_stream_sig_roundtrip_expiry_and_binding():
    cam, other = uuid.uuid4(), uuid.uuid4()
    exp = int(time.time()) + 60
    sig = stream_sig(cam, exp)
    assert verify_stream_sig(cam, exp, sig)
    assert not verify_stream_sig(other, exp, sig)
    assert not verify_stream_sig(cam, exp + 1, sig)
    assert not verify_stream_sig(cam, exp, "0" * 64)
    past = int(time.time()) - 1
    assert not verify_stream_sig(cam, past, stream_sig(cam, past))


def test_parse_stat_validates_and_clamps():
    cam = uuid.uuid4()
    good = parse_stat(f'{{"{cam}": {{"status": "ok", "detail": "", "fps": 4.9}}}}'.encode())
    assert good == {cam: ("ok", "", 4.9)}
    bad = parse_stat(b'{"not-a-uuid": {"status": "ok"}, "' + str(cam).encode() + b'": {"status": "weird", "detail": "' + b"x" * 900 + b'"}}')
    assert list(bad) == [cam] and bad[cam][0] == "unknown" and len(bad[cam][1]) <= 500
    assert parse_stat(b"not json") == {} and parse_stat(b"[1]") == {}
