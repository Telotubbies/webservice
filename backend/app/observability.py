"""Self-observability (v4 T8, doc 20 §3.7).

- ``/metrics`` — Prometheus exposition: HTTP request count + latency by
  ROUTE TEMPLATE (never raw paths — raw paths carry tag names, org UUIDs and
  command ids: as label values that's both a cardinality bomb and a data
  leak), live WS connection gauge, DB pool gauges, and the internal counter
  dicts (ingest/mqtt-security/dynsec/alarm/insight engines).
- ``ObservabilityMiddleware`` — X-Request-ID propagation + JSON access log.
  Logged fields: method, route template, status, latency_ms, request_id, ip,
  and the authenticated user's sub. NEVER the Authorization header, a
  ``?token=`` query value, cookies, or the WS auth frame — the field list is
  a whitelist, and every string field additionally passes through
  :func:`redact` (the belt, not the suspenders).
- ``alembic_head`` / ``migration_at_head`` — the /readyz migration probe:
  DB connect + ``alembic_version`` == the migrations tree's single head.

Scrape path: ``GET http://localhost:8000/metrics`` — the backend port is
loopback-bound (docker-compose publishes 127.0.0.1:8000) and nginx does NOT
proxy /metrics (web/nginx.conf returns 404 for it), so the endpoint is not
publicly scrapeable from the web origin. Restrict further at the
docker-network layer if a metrics service is added.
"""

from __future__ import annotations

import asyncio
import functools
import ipaddress
import logging
import re
import time
import uuid
from pathlib import Path

from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, Counter, Histogram, generate_latest
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import config

log = logging.getLogger("backend.observability")
_access_log = logging.getLogger("backend.access")

# ---------------------------------------------------------------------------
# Prometheus instruments (module-level — the default REGISTRY is process-wide)
# ---------------------------------------------------------------------------
HTTP_REQUESTS = Counter(
    "wds_http_requests_total", "HTTP requests",
    ["method", "route", "status"])
HTTP_LATENCY = Histogram(
    "wds_http_request_duration_seconds", "HTTP request latency in seconds",
    ["method", "route"])


def _label(k: str) -> str:
    """Counter-dict keys (``mqtt.orphan_client`` style) → tidy label values."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", k)


class _RuntimeCollector:
    """Reads live runtime state at scrape time.

    Prometheus calls collect() on its own thread during generate_latest();
    every read below is a plain attribute/int/dict snapshot — no awaits, so
    nothing here can deadlock the event loop.
    """

    def __init__(self) -> None:
        self._st = None

    def bind(self, st) -> None:
        self._st = st

    def collect(self):
        st = self._st
        if st is None:  # pre-lifespan scrape
            return
        yield GaugeMetricFamily(
            "wds_ws_connections", "Authenticated /ws clients",
            value=st.ws.client_count())
        yield CounterMetricFamily(
            "wds_ws_messages_dropped_total",
            "WS events dropped by bounded per-client queues",
            value=float(st.ws.total_dropped))
        yield CounterMetricFamily(
            "wds_mqtt_ingest_dropped_total",
            "MQTT messages dropped by the bounded ingest queue",
            value=float(st.mqtt.dropped_msgs))
        pool = GaugeMetricFamily(
            "wds_db_pool_connections", "asyncpg pool connections",
            labels=["pool", "state"])
        for name, p in (("app", st.pools.app), ("system", st.pools.system)):
            pool.add_metric([name, "size"], float(p.get_size()))
            pool.add_metric([name, "idle"], float(p.get_idle_size()))
            pool.add_metric([name, "max"], float(p.get_max_size()))
        yield pool
        yield GaugeMetricFamily(
            "wds_revoked_sessions_cached",
            "Sids in the in-memory revoked_sessions fast path (bounded)",
            value=float(st.auth.revoked_cache_size))
        counters = CounterMetricFamily(
            "wds_internal_counters_total",
            "Internal ingest/dynsec/engine counters",
            labels=["counter"])
        for src in (st.counters, st.reconciler.counters,
                    st.alarms.counters, st.insights.counters):
            for k, v in dict(src).items():
                counters.add_metric([_label(k)], float(v))
        yield counters


RUNTIME = _RuntimeCollector()
REGISTRY.register(RUNTIME)


def metrics_response() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---------------------------------------------------------------------------
# Route templates + client IP
# ---------------------------------------------------------------------------
def route_template(scope: Scope) -> str:
    """Matched route's path template — never the raw request path."""
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    return "unmatched"


def _trusted_peer(peer: str) -> bool:
    """May this peer set X-Real-IP? Loopback (direct hits on the published
    port, compose-internal is published to 127.0.0.1 only) or a configured
    TRUSTED_PROXIES CIDR — the compose network pins the nginx container and
    names it, so a random docker-network peer can't spoof client IPs."""
    try:
        ip = ipaddress.ip_address(peer)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return any(ip in net for net in config.TRUSTED_PROXIES)


def _client_ip(conn) -> str:
    """Client IP for per-IP buckets (WS cap, backchannel limiter).

    X-Real-IP is trusted only from _trusted_peer() — nginx OVERWRITES it
    with $remote_addr (no client-controlled append, unlike XFF which
    $proxy_add_x_forwarded_for extends after the client-supplied prefix —
    its first element is attacker-controlled and must not key the bucket).
    """
    peer = conn.client.host if conn.client else ""
    if peer and _trusted_peer(peer):
        rip = conn.headers.get("x-real-ip")
        if rip:
            return rip.strip()
    return peer or "unknown"


def _scope_client_ip(scope: Scope) -> str:
    """_client_ip for raw ASGI scopes (the access-log middleware)."""
    peer = scope.get("client")
    peer_host = peer[0] if peer else ""
    if peer_host and _trusted_peer(peer_host):
        for k, v in scope.get("headers", []):
            if k == b"x-real-ip":
                return v.decode("latin-1", "replace").strip()
    return peer_host or "unknown"


# ---------------------------------------------------------------------------
# Redaction (defense in depth — the logged field list is already a whitelist)
# ---------------------------------------------------------------------------
_SECRET_KV = re.compile(
    r"(?i)\b(authorization|proxy-authorization|token|access_token|id_token|"
    r"refresh_token|logout_token|password|passwd|secret|api[-_]?key|cookie|"
    r"set-cookie|x-api-key)([\s]*[=:][\s]*)([^\s&;,]+)")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")


def redact(text: str) -> str:
    """Scrub secret material from any string bound for the access log."""
    if not text:
        return text
    # Bearer first — otherwise the kv rule eats "Bearer" as the value and
    # leaves the credential behind.
    text = _BEARER.sub("Bearer [REDACTED]", text)
    return _SECRET_KV.sub(lambda m: m.group(1) + m.group(2) + "[REDACTED]", text)


# ---------------------------------------------------------------------------
# Middleware: request-id + JSON access log + HTTP metrics
# ---------------------------------------------------------------------------
_REQUEST_ID_SAFE = re.compile(r"[A-Za-z0-9._-]{1,64}")


def _request_id(scope: Scope) -> str:
    """Propagate a sane inbound X-Request-ID, else mint one. The charset is
    deliberately tight — an attacker-controlled id must not smuggle log
    noise/newlines into the JSON line."""
    for k, v in scope.get("headers", []):
        if k == b"x-request-id":
            rid = v.decode("latin-1", "replace").strip()
            if _REQUEST_ID_SAFE.fullmatch(rid):
                return rid
            break
    return uuid.uuid4().hex


# Metric label cardinality guard: only the real verbs get their own series —
# a sprayed method (curl -X FOO / FUZZ / ...) must not mint a new
# {method,route,status} series per garbage token (T8 review: label bombs cost
# registry memory + scrape time). The raw method still goes to the log line.
_METHOD_LABELS = frozenset(
    {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})

# Machine probes are counted in metrics (they're real traffic signal) but
# suppressed in the access log — the 15 s compose healthcheck and every
# scrape would otherwise dominate the JSON stream with zero-info lines.
_PROBE_ROUTES = frozenset({"/api/health", "/healthz", "/readyz", "/metrics"})


class ObservabilityMiddleware:
    """Pure-ASGI middleware (mounted outermost): request-id propagation,
    JSON access log, HTTP metrics. WS scopes pass through untouched — the
    WS handshake is logged by the endpoint, which never logs the auth
    frame's token (v4 T3)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        t0 = time.monotonic()
        rid = _request_id(scope)
        scope["request_id"] = rid  # handlers may read request.scope["request_id"]
        status = 500               # exception before/at response start
        started = False

        async def send_wrapped(message: Message) -> None:
            nonlocal status, started
            if message["type"] == "http.response.start":
                started = True
                status = int(message["status"])
                headers = message.setdefault("headers", [])
                headers.append((b"x-request-id", rid.encode("latin-1")))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapped)
        except Exception:
            if not started:
                # The outer ServerErrorMiddleware builds the 500 body but
                # skips it once response_started is set — emit the response
                # start ourselves so the request-id echo survives an
                # unhandled exception, then let it finish (raise -> its
                # traceback logging path).
                try:
                    await send_wrapped({
                        "type": "http.response.start", "status": 500,
                        "headers": [(b"content-type", b"text/plain; charset=utf-8")],
                    })
                    await send({"type": "http.response.body",
                                "body": b"Internal Server Error"})
                except Exception:  # noqa: BLE001 — client gone; still raise
                    pass
            raise
        finally:
            self._record(scope, t0, rid, status)

    def _record(self, scope: Scope, t0: float, rid: str, status: int) -> None:
        latency_ms = round((time.monotonic() - t0) * 1000.0, 1)
        route = route_template(scope)
        method = scope.get("method", "?")
        method_label = method if method in _METHOD_LABELS else "other"
        HTTP_REQUESTS.labels(method=method_label, route=route,
                             status=str(status)).inc()
        HTTP_LATENCY.labels(method=method_label, route=route).observe(
            latency_ms / 1000.0)
        if route in _PROBE_ROUTES:
            return  # counted in metrics; too noisy for the access log
        fields = {
            "method": method,
            "route": route,
            "status": status,
            "latency_ms": latency_ms,
            "request_id": rid,
            "ip": _scope_client_ip(scope),
        }
        # Authenticated caller, when the request got that far: the auth
        # dependency stashes the Principal on request.state (never the token).
        principal = (scope.get("state") or {}).get("principal")
        sub = getattr(principal, "sub", "") or getattr(principal, "user", "")
        if sub:
            fields["sub"] = sub
        _access_log.info("http_request", extra={
            k: redact(v) if isinstance(v, str) else v
            for k, v in fields.items()})


# ---------------------------------------------------------------------------
# /readyz migration probe
# ---------------------------------------------------------------------------
_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


@functools.lru_cache(maxsize=1)
def alembic_head() -> str | None:
    """The migrations tree's single head revision, or None if the tree is
    unreadable/multi-headed. Cached: the file set is image content and can't
    change under a running process."""
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        cfg = Config()
        cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
        heads = ScriptDirectory.from_config(cfg).get_heads()
    except Exception:  # noqa: BLE001 — probe failure => not-ready, not crash
        log.exception("alembic head probe failed")
        return None
    if len(heads) != 1:
        log.warning("alembic tree has %d heads — expected 1", len(heads))
        return None
    return heads[0]


async def migration_at_head(pool) -> tuple[bool, str]:
    """alembic_version == code head? wds_app reads alembic_version via the
    0005 grant (it owns nothing else migration-related — ADR-13 §1)."""
    head = alembic_head()
    if head is None:
        return False, "head_unreadable"
    try:
        # Bounded wait: under pool saturation /readyz must answer 503, not
        # hang the probe (T8 review).
        async with asyncio.timeout(5):
            async with pool.acquire() as conn:
                rows = await conn.fetch("SELECT version_num FROM alembic_version")
    except Exception:  # noqa: BLE001
        return False, "version_table_unreadable"
    versions = {r["version_num"] for r in rows}
    if versions == {head}:
        return True, "at_head"
    return False, "drift"
