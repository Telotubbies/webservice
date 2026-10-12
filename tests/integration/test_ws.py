"""WebSocket integration tests — CONTRACT.md "WebSocket /ws".

Requires BASE_URL. Uses `websockets` (async) wrapped in asyncio.run.

v4 T3: auth is a first-frame handshake — the client sends
{"type":"auth","token":…} within 5 s of connect. v4 T5 removed anonymous:
an empty/absent/unresolvable token, a non-auth first frame, or a timeout
all close the socket with 4401; authenticated-but-not-a-member -> 4403.
`?token=` is gone — query strings leak into access logs and proxy traces.
"""

import asyncio
import json
import re
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

from conftest import TAGS, OPERATOR_TOKEN, VIEWER_TOKEN  # noqa: E402


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
    events, _ = asyncio.run(_collect(f"{ws_base}/ws", 12, token=OPERATOR_TOKEN,
                                   predicate=lambda e: e.get("type") == "tag"))
    tag_events = [e for e in events if e.get("type") == "tag"]
    assert tag_events, f"no tag events in 12s, got: {[e.get('type') for e in events]}"
    e = tag_events[0]
    name = e.get("name") or e.get("tag")
    assert isinstance(name, str) and name.startswith("plant1.")
    assert isinstance(e["v"], (int, float, bool))
    assert e["q"] in ("good", "bad", "stale", "uncertain")
    assert e["ts"].endswith("Z")


def test_ws_anonymous_rejected(ws_base):
    # v4 T5: {"type":"auth"} with no token -> 4401 (anonymous is gone)
    code = asyncio.run(
        _close_code_after(f"{ws_base}/ws", {"type": "auth"}))
    assert code == 4401, f"anonymous WS should close 4401, got {code}"


def test_ws_anonymous_empty_token_rejected(ws_base):
    # {"type":"auth","token":""} is anonymous too — same 4401
    code = asyncio.run(
        _close_code_after(f"{ws_base}/ws", {"type": "auth", "token": ""}))
    assert code == 4401, f"empty-token WS should close 4401, got {code}"


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


def test_ws_non_string_token_closes_4401(ws_base):
    """A malformed token type (number/object/bool) is an auth failure —
    never silently coerced to anonymous."""
    async def run():
        websockets = pytest.importorskip("websockets")
        try:
            async with websockets.connect(f"{ws_base}/ws", open_timeout=10) as ws:
                await ws.send(json.dumps({"type": "auth", "token": 123}))
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=15)
        except Exception as e:
            return _close_code(e)
        return None
    assert asyncio.run(run()) == 4401


def test_ws_binary_first_frame_closes_4401(ws_base):
    """A binary first frame is not an auth frame -> clean 4401, no traceback."""
    async def run():
        websockets = pytest.importorskip("websockets")
        try:
            async with websockets.connect(f"{ws_base}/ws", open_timeout=10) as ws:
                await ws.send(b'{"type":"auth"}')  # bytes -> binary frame
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=15)
        except Exception as e:
            return _close_code(e)
        return None
    assert asyncio.run(run()) == 4401


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


async def _command_leak_probe(ws_url, auth_frame, operator_headers, api):
    """Connect, send `auth_frame`, fire one command, report leaked events."""
    websockets = pytest.importorskip("websockets")
    leaked = []
    async with websockets.connect(ws_url, open_timeout=10) as ws:
        await ws.send(json.dumps(auth_frame))
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


def test_ws_viewer_no_command_events(ws_base, operator_headers, api):
    """09 §7 security test: a read-only (viewer) connection must not leak
    command events — least privilege on the authenticated stream."""
    leaked = asyncio.run(
        _command_leak_probe(f"{ws_base}/ws",
                            {"type": "auth", "token": VIEWER_TOKEN},
                            operator_headers, api))
    assert not leaked, f"viewer WS leaked command events: {leaked}"


def test_ws_url_token_is_inert(ws_base):
    """v4 T3 regression: ?token= in the URL must NOT authenticate — the
    first-frame auth is the only credential channel. A VALID token in the
    URL + an anonymous auth frame is still anonymous -> 4401 (v4 T5)."""
    code = asyncio.run(
        _close_code_after(f"{ws_base}/ws?token={OPERATOR_TOKEN}",
                          {"type": "auth", "token": ""}))
    assert code == 4401, f"?token= must not authenticate — got {code}"


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
    # the named access_log format must resolve to a log_format whose body
    # logs $uri (path only) — `access_log ... combined;` must not pass
    m = re.search(r"access_log\s+\S+\s+(\w+)", conf)
    assert m, "expected access_log to name a format"
    fm = re.search(rf"log_format\s+{m.group(1)}\b([^;]*);", conf, re.S)
    assert fm, f"access_log references undefined log_format '{m.group(1)}'"
    assert "$uri" in fm.group(1), \
        f"log_format '{m.group(1)}' does not log $uri (path only)"
