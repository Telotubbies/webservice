"""WebSocket admission surface (v4 T13).

The WS gate is the app's real-time perimeter: first-frame auth, Origin
allowlist, per-IP connection cap, and no credential in the URL. Every
rejection must close with the CONTRACT code (4401 auth, 4403 policy) —
never hang open, never downgrade to anonymous.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import OPERATOR_TOKEN  # noqa: E402

WS_CAP = int(os.environ.get("RATE_WS_PER_IP", "20"))


def _close_code(e):
    return getattr(getattr(e, "rcvd", None), "code", None) or \
        getattr(e, "code", None)


async def _close_after(url, first_frame=None, wait_s=10, **kw):
    websockets = pytest.importorskip("websockets")
    try:
        async with websockets.connect(url, open_timeout=10, **kw) as ws:
            if first_frame is not None:
                await ws.send(json.dumps(first_frame))
            while True:
                await asyncio.wait_for(ws.recv(), timeout=wait_s)
    except Exception as e:
        return _close_code(e)
    return None


def test_pre_auth_data_frame_4401(ws_base):
    code = asyncio.run(_close_after(f"{ws_base}/ws", {"type": "ping"}))
    assert code == 4401


def test_auth_timeout_4401(ws_base):
    code = asyncio.run(_close_after(f"{ws_base}/ws", first_frame=None))
    assert code == 4401


def test_url_token_param_inert(ws_base):
    """A VALID token in ?token= plus an empty auth frame is still
    unauthenticated — the query string is not a credential channel."""
    code = asyncio.run(_close_after(
        f"{ws_base}/ws?token={OPERATOR_TOKEN}",
        {"type": "auth", "token": ""}))
    assert code == 4401


def test_bad_origin_4403(ws_base):
    code = asyncio.run(_close_after(
        f"{ws_base}/ws", {"type": "auth", "token": OPERATOR_TOKEN},
        origin="http://evil.example"))
    assert code == 4403


def test_bad_origin_via_web_proxy_4403(ws_base):
    """Same rejection through nginx (the real ingress): Origin that
    doesn't match Host -> 4403."""
    web_url = os.environ.get("WEB_URL", "http://localhost:5173")
    web_ws = web_url.replace("http", "ws", 1)
    code = asyncio.run(_close_after(
        f"{web_ws}/ws", {"type": "auth", "token": OPERATOR_TOKEN},
        origin="http://evil.example"))
    assert code == 4403


def test_per_ip_cap_4403(ws_base):
    """More than RATE_WS_PER_IP held sockets from one client IP -> the
    extra is closed 4403 at admission."""
    websockets = pytest.importorskip("websockets")

    async def run():
        held, code = [], None
        try:
            for _ in range(max(WS_CAP + 4, 12)):
                try:
                    ws = await websockets.connect(
                        f"{ws_base}/ws", open_timeout=10)
                    await ws.send(json.dumps(
                        {"type": "auth", "token": OPERATOR_TOKEN}))
                except Exception as e:
                    code = _close_code(e)
                    break
                try:
                    await asyncio.wait_for(ws.recv(), timeout=8)
                    held.append(ws)
                except Exception as e:
                    code = _close_code(e)
                    await ws.close()
                    break
            return code, len(held)
        finally:
            for s in held:
                with contextlib.suppress(Exception):
                    await s.close()

    code, held = asyncio.run(run())
    assert code == 4403, \
        f"cap never hit after {held} held sockets (cap={WS_CAP})"


def test_authenticated_socket_survives(ws_base):
    """Control: a properly-authenticated socket stays open and streams —
    the admission gates reject, they don't break legitimate clients."""
    websockets = pytest.importorskip("websockets")

    async def run():
        async with websockets.connect(f"{ws_base}/ws",
                                      open_timeout=10) as ws:
            await ws.send(json.dumps(
                {"type": "auth", "token": OPERATOR_TOKEN}))
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            return json.loads(raw).get("type")

    assert asyncio.run(run()) == "health"
