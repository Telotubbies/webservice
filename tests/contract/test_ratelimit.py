"""Unit tests for the v4 T4 token bucket + WS origin gate — offline, no
services needed. `backend/` is added to sys.path like the tenancy suite does.
"""

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.ratelimit import RateLimiter  # noqa: E402
from app.ws import OriginGuardMiddleware, origin_allowed  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _fake_clock():
    t = [0.0]
    return t, lambda: t[0]


# ------------------------------------------------------------- token bucket

def test_bucket_allows_capacity_then_denies():
    lim = RateLimiter(capacity=3, window_s=10)
    assert [run(lim.allow("k")) for _ in range(3)] == [True, True, True]
    assert run(lim.allow("k")) is False


def test_bucket_refills_over_window():
    t, clock = _fake_clock()
    lim = RateLimiter(capacity=2, window_s=10, clock=clock)  # 0.2 tokens/s
    assert run(lim.allow("k")) and run(lim.allow("k"))
    assert run(lim.allow("k")) is False
    t[0] += 5.0   # one token back
    assert run(lim.allow("k")) is True
    assert run(lim.allow("k")) is False
    t[0] += 10.0  # two more tokens -> capped at capacity
    assert run(lim.allow("k")) and run(lim.allow("k"))


def test_retry_after_reports_time_to_next_token():
    t, clock = _fake_clock()
    lim = RateLimiter(capacity=2, window_s=10, clock=clock)
    assert run(lim.retry_after("k")) == 0.0  # full bucket: nothing to wait
    run(lim.allow("k")); run(lim.allow("k"))
    assert run(lim.retry_after("k")) == pytest.approx(5.0)  # 1 token @ 0.2/s
    t[0] += 5.0
    assert run(lim.retry_after("k")) == pytest.approx(0.0)


def test_refund_returns_tokens_capped_at_capacity():
    lim = RateLimiter(capacity=2, window_s=10)
    run(lim.allow("k")); run(lim.allow("k"))
    assert run(lim.allow("k")) is False
    run(lim.refund("k"))
    assert run(lim.allow("k")) is True       # refunded token spent
    assert run(lim.allow("k")) is False      # really empty now
    run(lim.refund("k", cost=5))             # over-refund caps at capacity
    assert run(lim.allow("k")) is True
    assert run(lim.allow("k")) is True
    assert run(lim.allow("k")) is False


def test_keys_are_independent():
    lim = RateLimiter(capacity=1, window_s=10)
    assert run(lim.allow("a")) is True
    assert run(lim.allow("a")) is False
    assert run(lim.allow("b")) is True


def test_cost_above_one():
    lim = RateLimiter(capacity=5, window_s=10)
    assert run(lim.allow("k", cost=3)) is True
    assert run(lim.allow("k", cost=3)) is False
    assert run(lim.allow("k", cost=2)) is True


def test_idle_buckets_are_pruned():
    t, clock = _fake_clock()
    lim = RateLimiter(capacity=1, window_s=10, idle_ttl_s=10, clock=clock)
    run(lim.allow("idle"))
    t[0] += 61.0               # past the 60 s prune interval + idle ttl
    run(lim.allow("fresh"))    # triggers the sweep
    assert "idle" not in lim._buckets
    assert "fresh" in lim._buckets


def test_invalid_limiter_config_rejected():
    with pytest.raises(ValueError):
        RateLimiter(capacity=0, window_s=10)
    with pytest.raises(ValueError):
        RateLimiter(capacity=5, window_s=0)


# ---------------------------------------------------------------- WS origin

def test_origin_missing_is_allowed():
    # non-browser clients (curl, python-websockets, edge tooling) send no
    # Origin — documented v4 T4 carve-out, see ws.origin_allowed
    assert origin_allowed(None, "localhost:8000", None) is True
    assert origin_allowed("", "localhost:8000", None) is True


def test_origin_same_as_host_allowed_without_allowlist():
    assert origin_allowed("http://localhost:5173", "localhost:5173", None) is True
    assert origin_allowed("https://ops.example.com", "ops.example.com", None) is True


def test_origin_cross_host_rejected_without_allowlist():
    assert origin_allowed("http://evil.example", "localhost:8000", None) is False
    assert origin_allowed("https://localhost:8000.evil.example",
                          "localhost:8000", None) is False


def test_origin_null_and_unparseable_rejected():
    assert origin_allowed("null", "localhost:8000", None) is False
    assert origin_allowed("javascript:alert(1)", "localhost:8000", None) is False


def test_origin_missing_host_rejects_explicit_origin():
    assert origin_allowed("http://a.example", None, None) is False


def test_origin_allowlist_match_and_fallback():
    allow = ["https://ops.example.com", "https://nightly.example.com"]
    assert origin_allowed("https://ops.example.com", "other.host:443", allow) is True
    # same-origin remains allowed even with an allowlist configured
    assert origin_allowed("http://other.host:443", "other.host:443", allow) is True
    assert origin_allowed("https://rogue.example.com", "other.host:443", allow) is False


def test_origin_dev_loopback_carveout():
    """APP_ENV != prod: a vite dev proxy rewrites Host but not Origin, so a
    dev-server page hits the backend with mismatched loopback authorities —
    allowed in dev, still rejected in prod and for non-loopback hosts."""
    # dev-mode: loopback origin -> loopback host, any port pair
    assert origin_allowed("http://127.0.0.1:44501", "127.0.0.1:8000", None,
                          dev=True) is True
    assert origin_allowed("http://localhost:5173", "127.0.0.1:8000", None,
                          dev=True) is True
    # prod-mode: same pair rejected
    assert origin_allowed("http://127.0.0.1:44501", "127.0.0.1:8000", None,
                          dev=False) is False
    # dev-mode is not a blanket pass: a non-loopback origin is still rejected
    assert origin_allowed("http://evil.example", "127.0.0.1:8000", None,
                          dev=True) is False
    # and a loopback origin to a non-loopback host is rejected too
    assert origin_allowed("http://localhost:5173", "ops.example.com", None,
                          dev=True) is False


# -------------------------------------------- REST mutation Origin gate
# v4 T14 (CONTRACT.v2 §2, ADR-12 §8): OriginGuardMiddleware enforces the same
# policy on mutating /api requests — offline ASGI-level tests, no services.

def _origin_guard_hit(method, path, headers):
    """Run OriginGuardMiddleware around a stub app; return what happened."""
    hit = {"app": False, "status": None}

    async def stub_app(scope, receive, send):
        hit["app"] = True
        await send({"type": "http.response.start", "status": 200,
                    "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def send(message):
        if message["type"] == "http.response.start":
            hit["status"] = message["status"]

    mw = OriginGuardMiddleware(
        stub_app,
        lambda origin, host: origin_allowed(origin, host, None, dev=False))
    scope = {"type": "http", "method": method, "path": path,
             "headers": list(headers)}
    run(mw(scope, None, send))
    return hit


def test_rest_mutation_bad_origin_403():
    hit = _origin_guard_hit("POST", "/api/commands",
                            [(b"origin", b"http://evil.example"),
                             (b"host", b"localhost:8000")])
    assert hit["status"] == 403
    assert hit["app"] is False  # refused before routing


def test_rest_mutation_missing_origin_allowed():
    # the documented carve-out: non-browser clients send no Origin
    hit = _origin_guard_hit("POST", "/api/commands",
                            [(b"host", b"localhost:8000")])
    assert hit["app"] is True


def test_rest_mutation_same_origin_passes():
    hit = _origin_guard_hit("POST", "/api/commands",
                            [(b"origin", b"http://localhost:8000"),
                             (b"host", b"localhost:8000")])
    assert hit["app"] is True


def test_rest_get_with_bad_origin_not_gated():
    # safe verbs are never origin-checked — CORS/GETs stay untouched
    for method in ("GET", "HEAD", "OPTIONS"):
        hit = _origin_guard_hit(method, "/api/me",
                                [(b"origin", b"http://evil.example"),
                                 (b"host", b"localhost:8000")])
        assert hit["app"] is True, method


def test_rest_mutation_non_api_path_not_gated():
    # the guard is scoped to /api — a POST elsewhere never reaches the check
    hit = _origin_guard_hit("POST", "/webhooks/x",
                            [(b"origin", b"http://evil.example"),
                             (b"host", b"localhost:8000")])
    assert hit["app"] is True


def test_rest_delete_and_patch_gated_too():
    for method in ("DELETE", "PATCH", "PUT"):
        hit = _origin_guard_hit(method, "/api/v1/orgs/x/members/y",
                                [(b"origin", b"http://evil.example"),
                                 (b"host", b"localhost:8000")])
        assert hit["status"] == 403 and hit["app"] is False, method
