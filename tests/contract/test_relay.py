"""Frame relay: latest-frame buffer, slow consumers skip, ownership check, stream signatures (plan M1-03 T5)."""

from __future__ import annotations

import asyncio
import json
import time
import uuid

import pytest

from app.vision import relay as relay_mod
from app.vision.relay import (MAX_FRAME_BYTES, STAT_MAX_BYTES, CameraStat, FrameRelay,
                              parse_stat, stream_sig, verify_stream_sig)


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
    # CameraStat's first three indices keep the legacy (status, detail, fps) order
    assert good == {cam: CameraStat("ok", "", 4.9)}
    assert good[cam][:3] == ("ok", "", 4.9)
    bad = parse_stat(b'{"not-a-uuid": {"status": "ok"}, "' + str(cam).encode() + b'": {"status": "weird", "detail": "' + b"x" * 900 + b'"}}')
    assert list(bad) == [cam] and bad[cam][0] == "unknown" and len(bad[cam][1]) <= 500
    assert parse_stat(b"not json") == {} and parse_stat(b"[1]") == {}


def test_parse_stat_metadata_bounds_and_types():
    cam = uuid.uuid4()
    doc = json.dumps({str(cam): {"status": "ok", "detail": "", "fps": 5.0,
                                 "engine": "e" * 100, "latency_ms": 12.5, "bench_fps": 9.9,
                                 "model_state": "ready", "model_detail": "d" * 300,
                                 "model_version": "11111111-1111-1111-1111-111111111111"}}).encode()
    s = parse_stat(doc)[cam]
    assert s.engine == "e" * 80 and s.latency_ms == 12.5 and s.bench_fps == 9.9
    assert s.model_state == "ready" and len(s.model_detail) == 200


def test_parse_stat_rejects_non_finite_bool_and_unhashable():
    cam = uuid.uuid4()
    for fps in ('"nan"', 'NaN', 'Infinity', 'true'):
        s = parse_stat(f'{{"{cam}": {{"status": "ok", "fps": {fps}}}}}'.encode())[cam]
        assert s.fps == 0.0, fps
    s = parse_stat(f'{{"{cam}": {{"status": {{"x": 1}}, "fps": 1e400,'
                   f' "model_state": ["ready"], "latency_ms": -5, "bench_fps": 1e400}}}}'.encode())[cam]
    assert s.status == "unknown" and s.model_state == "none"     # unhashable shapes safe
    assert s.fps == 0.0 and s.bench_fps is None and s.latency_ms == 0.0
    # an int beyond float range raises OverflowError in float() — must not crash
    huge = json.dumps({str(cam): {"status": "ok", "fps": 10 ** 400}}).encode()
    assert parse_stat(huge)[cam].fps == 0.0
    assert parse_stat(b"x" * (STAT_MAX_BYTES + 1)) == {}         # raw cap


def test_latest_stat_freshness_and_forget(monkeypatch):
    cam = uuid.uuid4()
    r = _relay({})
    stat = CameraStat("ok", "", 4.0, engine="cpu", latency_ms=9.5, bench_fps=12.0,
                      model_state="ready", model_version="v1")
    now = [1000.0]
    real_time = time.time
    monkeypatch.setattr(relay_mod, "time",
                        type("T", (), {"monotonic": staticmethod(lambda: now[0]),
                                       "time": staticmethod(real_time)}))
    r.note_stat(cam, stat)
    got = r.latest_stat(cam)
    assert got["engine"] == "cpu" and got["latency_ms"] == 9.5 and got["bench_fps"] == 12.0
    assert got["model_state"] == "ready" and got["model_version"] == "v1"
    now[0] += 31.0                                       # past STAT_MAX_AGE_S
    assert r.latest_stat(cam) == {}
    now[0] -= 31.0
    r.note_stat(cam, stat)
    r.forget(cam)
    assert r.latest_stat(cam) == {}
