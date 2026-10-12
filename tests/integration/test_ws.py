"""WebSocket integration tests — CONTRACT.md "WebSocket /ws".

Requires BASE_URL. Uses `websockets` (async) wrapped in asyncio.run.

v4 T3: auth is a first-frame handshake — the client sends
{"type":"auth","token":…} (empty/absent token = anonymous until T5) within
5 s of connect. Anything else first, an unresolvable token, or timeout
closes the socket with 4401. `?token=` is gone — query strings leak into
access logs and proxy traces.
"""

import asyncio
import json
import re
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

from conftest import TAGS, OPERATOR_TOKEN  # noqa: E402


def _close_code(e):
    """Close code off a websockets ConnectionClosed (version-tolerant)."""
    return getattr(getattr(e, "rcvd", None), "code", None) or getattr(
        e, "code", None
    )


async def _collect(ws_url, duration_s, predicate=None, token=None):
    """Auth then collect WS events for `duration_s` → (events, close_code)."""
    websockets = pytest.importorskip("websockets")
    events = []
    close_code = None
    try:
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            auth = {"type": "auth"}
            if token is not None:
                auth["token"] = token
            await ws.send(json.dumps(auth))
            end = asyncio.get_event_loop().time() + duration_s
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(
                        ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())
                    )
                except asyncio.TimeoutError:
                    break
                events.append(json.loads(raw))
                if predicate and predicate(events[-1]):
                    break
    except Exception as e:  # connection closed early
        close_code = _close_code(e)
    return events, close_code


async def _close_code_after(ws_url, first_frame=None, wait_s=15):
    """Connect, optionally send `first_frame`, then read until close → code."""
    websockets = pytest.importorskip("websockets")
    try:
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            if first_frame is not None:
                await ws.send(json.dumps(first_frame))
            while True:
                await asyncio.wait_for(ws.recv(), timeout=wait_s)
    except Exception as e:
        return _close_code(e)
    return None


def test_ws_receives_tag_events(ws_base):
    events, _ = asyncio.run(_collect(f"{ws_base}/ws", 12,
                                   predicate=lambda e: e.get("type") == "tag"))
    tag_events = [e for e in events if e.get("type") == "tag"]
    assert tag_events, f"no tag events in 12s, got: {[e.get('type') for e in events]}"
    e = tag_events[0]
    name = e.get("name") or e.get("tag")
    assert isinstance(name, str) and name.startswith("plant1.")
    assert isinstance(e["v"], (int, float, bool))
    assert e["q"] in ("good", "bad", "stale", "uncertain")
    assert e["ts"].endswith("Z")


def test_ws_anonymous_connects(ws_base):
    # anonymous = {type:'auth'} with no token; read-only until T5 flips it
    events, code = asyncio.run(_collect(f"{ws_base}/ws", 5))
    assert code in (None, 1000, 1001)


def test_ws_anonymous_empty_token_connects(ws_base):
    # {"type":"auth","token":""} is the anonymous path too — a *non-empty*
    # token that doesn't resolve is the failure case, not an empty one
    events, code = asyncio.run(_collect(f"{ws_base}/ws", 5, token=""))
    assert code in (None, 1000, 1001)


def test_ws_first_frame_auth_operator(ws_base):
    # a resolvable token in the auth frame upgrades the connection — the
    # operator stream carries the health event immediately after connect
    events, code = asyncio.run(
        _collect(f"{ws_base}/ws", 5, token=OPERATOR_TOKEN,
                 predicate=lambda e: e.get("type") == "health"))
    assert any(e.get("type") == "health" for e in events), events
    assert code in (None, 1000, 1001)


def test_ws_pre_auth_frame_rejected(ws_base):
    """A data frame before {"type":"auth"} is rejected — close 4401."""
    code = asyncio.run(_close_code_after(f"{ws_base}/ws", {"type": "ping"}))
    assert code == 4401, f"pre-auth frame should close 4401, got {code}"


def test_ws_bad_token_closes_4401(ws_base):
    """A non-empty token that doesn't resolve -> close 4401."""
    code = asyncio.run(
        _close_code_after(f"{ws_base}/ws",
                          {"type": "auth", "token": "bogus-token"}))
    assert code == 4401, f"bad token should close 4401, got {code}"


def test_ws_auth_timeout_closes(ws_base):
    """No auth frame inside the 5 s window -> server closes 4401."""
    code = asyncio.run(_close_code_after(f"{ws_base}/ws", first_frame=None))
    assert code == 4401, f"auth timeout should close 4401, got {code}"


def test_ws_operator_receives_command_events(ws_base, operator_headers, api):
    async def run():
        websockets = pytest.importorskip("websockets")
        events = []
        async with websockets.connect(
            f"{ws_base}/ws", open_timeout=10
        ) as ws:
            await ws.send(json.dumps({"type": "auth", "token": OPERATOR_TOKEN}))
            r = api.post(
                "/api/commands",
                headers=operator_headers,
                json={"tag": TAGS["running"], "value": True,
                      "idempotency_key": f"ws-{uuid.uuid4()}", "ttl_s": 20},
            )
            assert r.status_code == 201, r.text
            command_id = r.json()["command_id"]
            end = asyncio.get_event_loop().time() + 20
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(
                        ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())
                    )
                except asyncio.TimeoutError:
                    break
                e = json.loads(raw)
                events.append(e)
                if (e.get("type") == "command"
                        and e.get("command_id") == command_id
                        and e.get("status") in ("done", "denied", "failed")):
                    return events, command_id, True
        return events, command_id, False

    events, command_id, seen = asyncio.run(run())
    cmd_events = [e for e in events
                  if e.get("type") == "command" and e.get("command_id") == command_id]
    assert cmd_events, f"no command events for {command_id}; got types " \
                       f"{[e.get('type') for e in events]}"
    statuses = [e["status"] for e in cmd_events]
    assert statuses[-1] in ("done", "denied", "failed"), statuses


def test_ws_anonymous_no_command_events(ws_base, operator_headers, api):
    """09 §7 security test: WS '*' must not leak command events to anonymous.

    NOTE: 06 §2 restricts public streams to tag/tags/alarm/health. CONTRACT.md
    does not state this explicitly — flagged DIVERGENCE; failure here is a
    red-team finding, not necessarily a contract violation."""
    async def run():
        websockets = pytest.importorskip("websockets")
        leaked = []
        async with websockets.connect(f"{ws_base}/ws", open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth"}))
            api.post("/api/commands", headers=operator_headers,
                     json={"tag": TAGS["speed_sp"], "value": 22.0,
                           "idempotency_key": f"wsanon-{uuid.uuid4()}", "ttl_s": 20})
            end = asyncio.get_event_loop().time() + 8
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(
                        ws.recv(), timeout=max(0.05, end - asyncio.get_event_loop().time())
                    )
                except asyncio.TimeoutError:
                    break
                e = json.loads(raw)
                if e.get("type") == "command":
                    leaked.append(e)
        return leaked

    leaked = asyncio.run(run())
    assert not leaked, f"anonymous WS leaked command events: {leaked}"


def test_ws_auth_expired_shape_documented(ws_base):
    """CONTRACT.md: server sends {'type':'auth_expired'} then close 4401.
    Demo tokens never expire — shape is covered by contract unit tests;
    this asserts only that a token-bearing WS connects cleanly."""
    events, code = asyncio.run(
        _collect(f"{ws_base}/ws", 5, token=OPERATOR_TOKEN)
    )
    assert code in (None, 1000, 1001)


def test_nginx_access_log_drops_query_string():
    """ADR-12: access logs must not record the URI query — that's where
    credentials used to ride (?token=). The default 'combined' format logs
    $request (path + query); the custom format must log $uri only."""
    raw = (Path(__file__).resolve().parents[2] / "web" / "nginx.conf").read_text()
    # directives only — comments may name the variables being excluded
    conf = "\n".join(l for l in raw.splitlines() if not l.lstrip().startswith("#"))
    # bare $request carries the query string; $request_* vars (e.g.
    # $request_method) do not — \b keeps them distinct
    assert not re.search(r"\$request\b", conf), \
        "nginx.conf logs $request — query string would hit access logs"
    assert "$request_uri" not in conf
    assert re.search(r"log_format\s+\w+", conf), \
        "expected a custom log_format; default 'combined' logs $request"
    assert re.search(r"access_log\s+\S+\s+\w+", conf), \
        "expected access_log to name a format"
