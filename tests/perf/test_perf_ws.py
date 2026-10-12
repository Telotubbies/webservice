"""WebSocket scale + fan-out latency (v4 T13).

- 100 concurrent authenticated /ws connections (each claiming a distinct
  client IP via X-Real-IP — trusted from loopback — so the per-IP cap
  isn't the thing under test here; test_ratelimit covers the cap).
- Telemetry fan-out: one MQTT publish (test-profile `tester` identity,
  v2 topic of the seeded edge) must reach every socket; p95
  publish->receive <= 2 s.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

from conftest import (  # noqa: E402
    MQTT_HOST, OPERATOR_TOKEN, V2_PREFIX, mqtt_connect,
)
from perf.conftest import report  # noqa: E402

N_CONNS = 100
FANOUT_BUDGET_S = 2.0
TAG_PATH = "sort/vision/cam1/gravel_ratio"  # quiet tag — no alarm rule on it
TAG_NAME = "plant1.sort.vision.cam1.gravel_ratio"
# Unique marker value: the demo edge streams this tag live, so matching on
# name alone measures someone else's publish. Only OUR sample counts.
MARKER_V = 77777.123


async def _one_conn(ws_base, i):
    websockets = pytest.importorskip("websockets")
    # distinct X-Real-IP per socket: trusted from loopback peers, so each
    # connection gets its own per-IP bucket — we're measuring fan-out,
    # not the cap (cap is proven in tests/security/test_ws_admission).
    ws = await websockets.connect(
        f"{ws_base}/ws", open_timeout=15,
        additional_headers={"X-Real-IP": f"10.99.{i // 250}.{i % 250}"})
    await ws.send(json.dumps({"type": "auth", "token": OPERATOR_TOKEN}))
    return ws


async def _wait_tag(ws, deadline):
    """Return the recv wall-clock of the first matching tag event."""
    while time.monotonic() < deadline:
        try:
            raw = await asyncio.wait_for(
                ws.recv(), timeout=max(0.05, deadline - time.monotonic()))
        except asyncio.TimeoutError:
            return None
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if e.get("type") == "tag" and e.get("name") == TAG_NAME and \
                e.get("v") == MARKER_V:
            return time.monotonic()
    return None


def _publish():
    """One telemetry sample as the provisioned test identity (doc 17
    test profile; the only MQTT identity the suite may use)."""
    from datetime import datetime, timezone
    c = mqtt_connect()
    try:
        c.publish(f"{V2_PREFIX}/tele/{TAG_PATH}",
                  json.dumps({"v": MARKER_V, "q": "good",
                              "ts": datetime.now(timezone.utc)
                              .isoformat()}), qos=1)
        time.sleep(0.3)
    finally:
        c.loop_stop()
        c.disconnect()


def test_100_concurrent_ws_fanout(ws_base):
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set — run under `make test-perf`")

    async def run():
        # connect all 100 — record handshake time per socket
        t0 = time.monotonic()
        conns = []
        try:
            results = await asyncio.gather(
                *(_one_conn(ws_base, i) for i in range(N_CONNS)),
                return_exceptions=True)
            conns = [r for r in results if not isinstance(r, Exception)]
            fails = [r for r in results if isinstance(r, Exception)]
            handshake_ms = (time.monotonic() - t0) * 1000
            assert not fails, \
                f"{len(fails)}/{N_CONNS} sockets failed: {fails[:3]}"
            # every socket should have its initial health event queued;
            # then one publish fans out to all
            deadline = time.monotonic() + 30
            recv_tasks = [asyncio.create_task(_wait_tag(ws, deadline))
                          for ws in conns]
            await asyncio.sleep(0.5)          # all recv pumps armed
            t_pub = time.monotonic()
            await asyncio.to_thread(_publish)
            lats = await asyncio.gather(*recv_tasks)
            return handshake_ms, [l - t_pub for l in lats if l], \
                sum(1 for l in lats if l is None)
        finally:
            for ws in conns:
                with contextlib.suppress(Exception):
                    await ws.close()

    handshake_ms, lats_s, missed = asyncio.run(run())
    print(f"\nPERF ws.handshake_100: {handshake_ms:.0f}ms total, "
          f"{handshake_ms / N_CONNS:.1f}ms amortized/socket")
    stats = report("ws.fanout_100", [l * 1000 for l in lats_s])
    assert missed == 0, f"{missed}/{N_CONNS} sockets missed the fan-out"
    assert stats["p95"] <= FANOUT_BUDGET_S * 1000, \
        f"fan-out p95 {stats['p95']:.0f}ms > {FANOUT_BUDGET_S * 1000:.0f}ms"
