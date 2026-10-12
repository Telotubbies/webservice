"""Rate limiting + WS admission integration tests (v4 T4; doc 16 row 7).

Requires BASE_URL. Tests read the same RATE_* envs as the stack under test
(defaults match docker-compose.yml: 5/10s commands, 60/60s mutations, 20 ws
per IP) — set them when the stack is configured differently. Probes are
bounded so a smaller configured limit still works, just faster.

The command bucket is keyed user+tag, so the burn tests use the read-only
`level_pct` tag: commands there still pass every gate and burn tokens (the
edge denies them later), while `running`/`speed_sp`/`temp_c` budgets stay
free for the rest of the suite.
"""

import asyncio
import contextlib
import json
import os
import threading
import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import TAGS, OPERATOR_TOKEN, wait_until  # noqa: E402

CMD_LIMIT = int(os.environ.get("RATE_COMMANDS_PER_TAG", "5"))
CMD_WINDOW = float(os.environ.get("RATE_COMMANDS_WINDOW_S", "10"))
MUT_LIMIT = int(os.environ.get("RATE_MUTATIONS_PER_USER", "60"))
WS_CAP = int(os.environ.get("RATE_WS_PER_IP", "20"))


def _full_command_bucket():
    """Sleep one window so the per-user+tag bucket refills to capacity from
    any prior state — makes the burn tests order- and rerun-independent."""
    time.sleep(CMD_WINDOW + 2)

BURN_TAG = TAGS["level_pct"]  # read-only: burns an isolated user+tag bucket
TERMINAL = ("done", "denied", "failed", "timeout")


def _post_command(api, headers, tag, value):
    return api.post(
        "/api/commands", headers=headers,
        json={"tag": tag, "value": value,
              "idempotency_key": f"rl-{uuid.uuid4()}", "ttl_s": 15})


def _wait_terminal(api, cid, headers, timeout_s=20):
    def poll():
        r = api.get(f"/api/commands/{cid}", headers=headers)
        if r.status_code != 200:
            return None
        body = r.json()
        return body if body.get("status") in TERMINAL else None
    return wait_until(poll, timeout_s, desc=f"command {cid} terminal")


def _wait_no_inflight(api, headers, tag, timeout_s=20):
    """Wait until the tag's latest command is terminal — settles r1 AND any
    burst post that slipped in behind it."""
    def poll():
        r = api.get("/api/commands", headers=headers,
                    params={"tag": tag, "limit": 1})
        rows = r.json() if r.status_code == 200 else []
        return (rows[0]["status"] in TERMINAL) if rows else True
    wait_until(poll, timeout_s, desc=f"no in-flight command on {tag}")


# --------------------------------------------------------------- commands

def test_command_rate_limit_429_with_retry_after(api, operator_headers):
    """Exceeding RATE_COMMANDS_PER_TAG in the window -> 429 + Retry-After
    (doc 16 gate 7)."""
    _full_command_bucket()
    got_429 = None
    accepted = 0
    deadline = time.monotonic() + 120
    for _ in range(max(CMD_LIMIT * 4, 12)):
        if time.monotonic() > deadline:
            break
        r = _post_command(api, operator_headers, BURN_TAG, 20.0)
        if r.status_code == 429:
            got_429 = r
            break
        assert r.status_code == 201, (r.status_code, r.text)
        accepted += 1
        _wait_terminal(api, r.json()["command_id"], operator_headers)
    assert got_429 is not None, "no 429 observed — is the bucket wired in?"
    # the bucket really limited: at least CMD_LIMIT accepted commands burned
    # through before the denial (a pre-drained bucket can't fake this)
    assert accepted >= CMD_LIMIT, (accepted, CMD_LIMIT)
    ra = got_429.headers.get("retry-after")
    assert ra is not None and int(ra) >= 1, f"missing Retry-After: {dict(got_429.headers)}"
    assert got_429.json().get("detail") == "rate_limited"

    # after the advertised wait a legitimate command is accepted again —
    # the limiter must not permanently starve the tag
    time.sleep(min(int(ra) + 1, 15))
    r = _post_command(api, operator_headers, BURN_TAG, 21.0)
    assert r.status_code == 201, (r.status_code, r.text)
    _wait_terminal(api, r.json()["command_id"], operator_headers)


def test_in_flight_409s_do_not_burn_command_budget(api, operator_headers):
    """Precise budget check (doc 16 gates 7/8, task-ordered): with ~2 tokens
    left, race two posts on one tag — exactly one is accepted; the loser's
    409 (in-flight pre-check, or the unique-index race refunded via
    RateLimiter.refund) must not spend, so >=1 token remains for a fresh
    command. A full-bucket version can't see a burn-on-409 bug — spare
    tokens mask the spend — so the bucket is re-normalized to ~2 tokens
    before each attempt. The edge answers fast: a race can miss the
    in-flight window entirely (201+201 — both posts legitimate, no
    invariant violated), so attempts retry until a 409 is caught."""

    def drain_to_two():
        """Empty the user+tag bucket (bounded), then refill to ~2 tokens —
        under 3 so a burn-on-409 bug stays observable post-race."""
        _wait_no_inflight(api, operator_headers, BURN_TAG)
        drained = False
        for _ in range(CMD_LIMIT * 3 + 2):
            r = _post_command(api, operator_headers, BURN_TAG, 30.0)
            if r.status_code == 429:
                # Retry-After marks the next token; one more token-interval
                # later the balance is ~2 — enough for both racers, under 3
                # so a burn-on-409 bug stays observable post-race
                ra = float(r.headers.get("retry-after", "1"))
                time.sleep(ra + CMD_WINDOW / CMD_LIMIT)
                drained = True
                break
            assert r.status_code == 201, (r.status_code, r.text)
            _wait_terminal(api, r.json()["command_id"], operator_headers)
        assert drained, "bucket never filled — limiter broken?"

    _full_command_bucket()
    caught = None
    for _ in range(4):
        drain_to_two()
        barrier = threading.Barrier(2)
        results = []

        def post(v):
            barrier.wait(timeout=10)
            results.append(_post_command(api, operator_headers, BURN_TAG, v))

        t1 = threading.Thread(target=post, args=(22.0,))
        t2 = threading.Thread(target=post, args=(23.0,))
        t1.start(); t2.start(); t1.join(timeout=15); t2.join(timeout=15)
        codes = sorted(r.status_code for r in results)
        _wait_no_inflight(api, operator_headers, BURN_TAG)
        if codes == [201, 409]:
            caught = results
            break
        # [201,201]: winner finished before the loser arrived — legitimate
        # miss, re-normalize and retry; a stray 429 likewise
        assert all(c in (201, 409, 429) for c in codes), codes
    assert caught is not None, "never observed a same-tag in-flight 409"

    win = next(r for r in caught if r.status_code == 201).json()["command_id"]
    conflict = next(r for r in caught if r.status_code == 409).json()
    assert conflict["active_command_id"] == win
    # post-race balance must be >=1: burn-on-409 or a missing refund leaves
    # <1 token and this post 429s instead of being accepted
    r = _post_command(api, operator_headers, BURN_TAG, 24.0)
    assert r.status_code == 201, (r.status_code, r.text)
    _wait_terminal(api, r.json()["command_id"], operator_headers)


# --------------------------------------------------------------- mutations

def test_mutation_rate_limit_429_with_retry_after(api, operator_headers):
    """Non-command mutations count against the per-user bucket — even when
    the resource is a 404 (the gate runs before the lookup)."""
    fake = uuid.uuid4()
    codes, hit = [], None
    for _ in range(MUT_LIMIT + 6):
        r = api.post(f"/api/alarms/{fake}/ack", headers=operator_headers)
        if r.status_code == 429:
            hit = r
            break
        codes.append(r.status_code)
    assert hit is not None, f"no 429 in {MUT_LIMIT + 6} ack attempts: {codes}"
    assert set(codes) <= {404}, codes  # pre-limit attempts were clean 404s
    ra = hit.headers.get("retry-after")
    assert ra is not None and int(ra) >= 1
    assert hit.json().get("detail") == "rate_limited"
    # cleanup: the bucket is shared per-user — don't leave it drained for
    # the next suite/rerun. Wait out Retry-After + a margin, then confirm
    # a token is back (a clean 404, not another 429).
    time.sleep(min(int(ra) + 3, 30))
    r = api.post(f"/api/alarms/{fake}/ack", headers=operator_headers)
    assert r.status_code == 404, (r.status_code, r.text)


# -------------------------------------------------------------------- WS

def _close_code(e):
    """Close code off a websockets ConnectionClosed (version-tolerant)."""
    return getattr(getattr(e, "rcvd", None), "code", None) or getattr(
        e, "code", None)


async def _connect(url, origin=None, token=None):
    websockets = pytest.importorskip("websockets")
    ws = await websockets.connect(url, origin=origin, open_timeout=10)
    auth = {"type": "auth"}
    if token is not None:
        auth["token"] = token
    await ws.send(json.dumps(auth))
    return ws


async def _close_code_after(url, origin=None, first_frame=None, wait_s=10):
    websockets = pytest.importorskip("websockets")
    try:
        async with websockets.connect(url, origin=origin, open_timeout=10) as ws:
            if first_frame is not None:
                await ws.send(json.dumps(first_frame))
            while True:
                await asyncio.wait_for(ws.recv(), timeout=wait_s)
    except Exception as e:
        return _close_code(e)
    return None


def test_ws_bad_origin_closes_4403(ws_base):
    """Cross-origin upgrade -> close 4403 (ALLOWED_ORIGINS unset on the test
    stack -> same-origin only)."""
    code = asyncio.run(_close_code_after(
        f"{ws_base}/ws", origin="http://evil.example",
        first_frame={"type": "auth"}))
    assert code == 4403, f"cross-origin WS should close 4403, got {code}"


def test_ws_same_origin_and_missing_origin_allowed(ws_base):
    """Origin matching the Host header connects; no Origin header at all
    (non-browser client) also connects — documented v4 T4 carve-out."""
    host = ws_base.split("://", 1)[1]  # "localhost:8000" etc.

    async def run():
        results = {}
        for label, origin in (("same-origin", f"http://{host}"), ("none", None)):
            try:
                ws = await _connect(f"{ws_base}/ws", origin=origin,
                                    token=OPERATOR_TOKEN)
            except Exception as e:
                results[label] = _close_code(e)
                continue
            async with ws:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                results[label] = json.loads(raw).get("type")
        return results

    out = asyncio.run(run())
    assert out["same-origin"] == "health", out
    assert out["none"] == "health", out


def test_ws_spoofed_xff_does_not_bypass_ip_cap(ws_base):
    """Client-supplied X-Forwarded-For is attacker-controlled (nginx appends
    after it — first element can be arbitrary). The per-IP bucket must key
    on the proxy-overwritten X-Real-IP / socket peer, so spoofed XFF on
    every socket must NOT mint fresh buckets — the cap still bites."""

    async def run():
        websockets = pytest.importorskip("websockets")
        held, code = [], None
        try:
            for i in range(max(WS_CAP + 3, 10)):
                try:
                    ws = await websockets.connect(
                        f"{ws_base}/ws",
                        additional_headers={
                            "X-Forwarded-For": f"203.0.113.{i + 1}"},
                        open_timeout=10)
                    # v4 T5: a valid token is required to HOLD the socket —
                    # anonymous auth frames now close 4401 within the window
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
        f"spoofed XFF minted {held} distinct buckets — cap bypassed"


def test_ws_per_ip_cap_closes_4403(ws_base):
    """More than RATE_WS_PER_IP sockets from one client IP -> the extra is
    closed 4403 at accept time. Probes until the cap hits so any configured
    limit works."""

    async def run():
        held = []
        code = None
        try:
            for _ in range(max(WS_CAP + 3, 10)):
                try:
                    # valid token: only then does the socket stay held under
                    # the cap (anonymous closes 4401 — v4 T5)
                    ws = await _connect(f"{ws_base}/ws", token=OPERATOR_TOKEN)
                except Exception as e:
                    code = _close_code(e)
                    break
                try:
                    # accepted sockets get an immediate health event; a
                    # rejected socket's recv raises ConnectionClosed(4403)
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
    assert code == 4403, f"cap never hit after {held} held sockets, code={code}"
