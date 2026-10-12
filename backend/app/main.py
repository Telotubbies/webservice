"""FastAPI backend — industrial dashboard.

Phase 2: Postgres (ADR-13) under the v1 API/WS/MQTT contract (CONTRACT.md),
pinned to the single dev org via the v1 shim in config.py. The v2 multi-tenant
surface (CONTRACT.v2.md) replaces the shim in phases 3–4.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import math
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

from . import config
from .alarms import AlarmEngine
from .auth import Principal
from .commands import CommandManager
from .insights import INSIGHT_KINDS, InsightEngine
from .db.context import tenant_tx
from .db.pool import Pools, create_pools
from .db.util import finite_or_none, iso_z, parse_ts, utcnow
from .mqtt_client import MQTTBridge
from .ratelimit import RateLimiter
from .registry import Registry
from .security import AuthError, ForbiddenError, Security, authz_listener
from .seed import seed
from .ws import WSManager, WSAuthError, origin_allowed, read_auth_token

START_TIME = time.monotonic()

# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------
_LOG_STD = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        obj = {
            "ts": iso_z(datetime.fromtimestamp(record.created, timezone.utc)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k not in _LOG_STD and not k.startswith("_"):
                try:
                    json.dumps(v)
                    obj[k] = v
                except (TypeError, ValueError):
                    obj[k] = str(v)
        if record.exc_info:
            obj["exc"] = self.formatException(record.exc_info)
        return json.dumps(obj, separators=(",", ":"))


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


log = logging.getLogger("backend.main")


# ---------------------------------------------------------------------------
# Request / payload models
# ---------------------------------------------------------------------------
def _finite(v):
    if isinstance(v, float) and not math.isfinite(v):
        raise ValueError("non-finite value")
    return v


class CommandIn(BaseModel):
    tag: str = Field(min_length=1, max_length=200)
    value: float | bool
    ttl_s: int = Field(default=10, ge=1, le=60)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("tag")
    @classmethod
    def tag_charset(cls, v: str) -> str:
        if any(c in v for c in "/ \\?#"):
            raise ValueError("invalid tag name")
        return v

    _v_finite = field_validator("value")(_finite)


class TelemetryMsg(BaseModel):
    v: float | bool
    q: str = "good"
    ts: str

    _v_finite = field_validator("v")(_finite)

    @field_validator("q")
    @classmethod
    def q_enum(cls, v: str) -> str:
        if v not in ("good", "bad", "stale", "uncertain"):
            raise ValueError("bad quality")
        return v

    @field_validator("ts")
    @classmethod
    def ts_iso(cls, v: str) -> str:
        parse_ts(v)
        return v


# ---------------------------------------------------------------------------
# Auth dependencies (v4 T5 — anonymous reads removed; ADR-12)
# ---------------------------------------------------------------------------
async def _authenticate(request: Request) -> Principal:
    """Authorization header -> verified Principal. AuthError -> 401."""
    header = request.headers.get("authorization", "")
    token = None
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    return await st(request).auth.authenticate(token)


async def require_user(request: Request) -> Principal:
    """Any verified caller — even without org membership (for /api/me)."""
    return await _authenticate(request)


async def require_principal(request: Request) -> Principal:
    """Verified caller WITH membership in the shim org — every /api/* read."""
    p = await _authenticate(request)
    if not p.member:
        raise ForbiddenError("not a member of this organization")
    return p


async def require_operator(request: Request) -> Principal:
    """Mutating endpoints: operator/admin/owner in the shim org."""
    p = await require_principal(request)
    if not p.can_operate:
        raise ForbiddenError("operator role required")
    return p


require_authenticated = require_operator  # ack is an operator-level mutation


# ---------------------------------------------------------------------------
# Runtime state
# ---------------------------------------------------------------------------
class State:
    def __init__(self, pools: Pools):
        self.pools = pools
        self.ws = WSManager()
        self.mqtt = MQTTBridge(
            config.MQTT_HOST, config.MQTT_PORT, config.V1_SITE_CODE, config.V1_EDGE_NAME,
            username=config.MQTT_USER, password=config.MQTT_PASSWORD,
        )
        self.registry = Registry(pools.system)
        # v4 T4 rate budgets — in-process buckets (single replica; see
        # ratelimit.py for the horizontal-scale note)
        self.cmd_limiter = RateLimiter(config.RATE_COMMANDS_PER_TAG,
                                       config.RATE_COMMANDS_WINDOW_S)
        self.mutation_limiter = RateLimiter(config.RATE_MUTATIONS_PER_USER,
                                            config.RATE_MUTATIONS_WINDOW_S)
        # backchannel logout is an unauthenticated JWKS-verified endpoint —
        # each forged attempt burns a JWKS verify; keep a tight per-IP bucket
        self.logout_limiter = RateLimiter(config.RATE_LOGOUT_PER_IP,
                                          config.RATE_LOGOUT_WINDOW_S)
        self.commands = CommandManager(pools, self.ws, self.mqtt, self.registry,
                                       cmd_limiter=self.cmd_limiter)
        self.alarms = AlarmEngine(pools, self.ws, self.registry)
        self.insights = InsightEngine(pools, self.ws, self.registry)
        self.auth = Security(pools, self.ws)  # v4 T5 — OIDC verify + authz
        self.history_buf: list[tuple] = []
        self.edge = {"last_rx": None, "last_heartbeat_ts": None, "clock_ok": None,
                     "adapter": None}
        self.counters = {"telemetry_unknown_tag": 0, "telemetry_bad_payload": 0,
                         "telemetry_future_ts": 0, "telemetry_too_old": 0}
        self.db_ok = True

    def edge_status(self) -> str:
        last = self.edge["last_rx"]
        if last is None or (time.monotonic() - last) > config.EDGE_STALE_AFTER_S:
            return "stale"
        return "up"

    def health_event(self) -> dict:
        return {"type": "health", "mqtt": "up" if self.mqtt.connected else "down",
                "edge": self.edge_status()}


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------
def _count(st: State, key: str, msg: str, **extra) -> None:
    st.counters[key] += 1
    if st.counters[key] % 100 == 1:
        log.warning(msg, extra={"count": st.counters[key], **extra})


async def ingest_worker(st: State) -> None:
    while True:
        msg = await st.mqtt.queue.get()
        try:
            await _handle_message(st, msg)
        except Exception:  # noqa: BLE001 — one bad message must not kill ingest
            log.exception("ingest error", extra={"topic": getattr(msg, "topic", "?")})


async def _handle_message(st: State, msg) -> None:
    parts = msg.topic.split("/")
    if len(parts) >= 2 and parts[1] == "edge" and parts[-1] == "heartbeat":
        return await _handle_heartbeat(st, msg)
    if len(parts) >= 2 and parts[1] == "cmd-resp":
        return _handle_cmd_resp(st, msg)
    if len(parts) >= 2 and parts[1] in ("cmd", "sys", "edge"):
        return
    await st.registry.maybe_refresh()
    path = "/".join(parts[1:])
    tag = st.registry.by_path(path)
    if tag is None:
        return _count(st, "telemetry_unknown_tag", "telemetry_unknown_tag — dropping",
                      topic=msg.topic)
    try:
        payload = TelemetryMsg.model_validate_json(msg.payload)
    except Exception:
        return _count(st, "telemetry_bad_payload", "bad telemetry payload", topic=msg.topic)
    ts = parse_ts(payload.ts)
    age = (utcnow() - ts).total_seconds()
    if age < -config.FUTURE_SKEW_S:
        return _count(st, "telemetry_future_ts", "telemetry ts in the future — dropped",
                      topic=msg.topic)
    if age > config.HISTORY_MAX_AGE_S:
        return _count(st, "telemetry_too_old", "telemetry older than 8h — dropped",
                      topic=msg.topic)

    v, q = payload.v, payload.q
    async with tenant_tx(st.pools.system, config.V1_ORG_ID) as tc:
        # tag_latest is monotonic: a late/replayed sample never overwrites newer data
        res = await tc.execute(
            "INSERT INTO tag_latest(tag_id, org_id, v, q, ts) VALUES ($1,$2,$3,$4,$5)"
            " ON CONFLICT (tag_id) DO UPDATE SET v=excluded.v, q=excluded.q, ts=excluded.ts"
            " WHERE tag_latest.ts < excluded.ts",
            tag.id, tc.org_id, v, q, ts)
        await st.alarms.evaluate(tc, tag.id, v, q, ts)
    st.history_buf.append((tag.id, ts, config.V1_ORG_ID, v, q))
    if len(st.history_buf) >= config.HISTORY_FLUSH_ROWS:
        await _flush_history(st)
    if res.endswith(" 1"):
        st.ws.broadcast({"type": "tag", "name": tag.v1_name, "v": v, "q": q, "ts": payload.ts})


async def _handle_heartbeat(st: State, msg) -> None:
    if msg.topic.split("/")[2] != config.V1_EDGE_NAME:
        log.warning("heartbeat from unexpected edge_id — dropped", extra={"topic": msg.topic})
        return
    was = st.edge_status()
    try:
        payload = json.loads(msg.payload)
        if not isinstance(payload, dict):
            payload = {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}
    st.edge.update(last_rx=time.monotonic(), last_heartbeat_ts=payload.get("ts"),
                   clock_ok=payload.get("clock_ok"), adapter=payload.get("adapter"))
    clock_ok = payload.get("clock_ok") if isinstance(payload.get("clock_ok"), bool) else None
    adapter = payload.get("adapter") if isinstance(payload.get("adapter"), str) else None
    async with tenant_tx(st.pools.system, config.V1_ORG_ID) as tc:
        await tc.execute("UPDATE edges SET last_hb_at=now(), clock_ok=$2, adapter=$3 WHERE id=$1",
                         config.V1_EDGE_ID, clock_ok, adapter)
    if st.edge_status() != was:
        st.ws.broadcast(st.health_event())


def _handle_cmd_resp(st: State, msg) -> None:
    try:
        payload = json.loads(msg.payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        log.warning("bad cmd-resp payload", extra={"topic": msg.topic})
        return
    if not isinstance(payload, dict):
        return
    cid, status = payload.get("command_id"), payload.get("status")
    if not cid or not status:
        log.warning("cmd-resp missing fields", extra={"topic": msg.topic})
        return
    if cid != msg.topic.rsplit("/", 1)[-1]:
        log.warning("cmd-resp id mismatch — dropped", extra={"topic": msg.topic})
        return
    asyncio.ensure_future(st.commands.handle_response(cid, status, payload.get("detail")))


async def _flush_history(st: State) -> None:
    if not st.history_buf:
        return
    rows, st.history_buf = st.history_buf, []
    async with tenant_tx(st.pools.system, config.V1_ORG_ID) as tc:
        await tc.executemany(
            "INSERT INTO tag_history(tag_id, ts, org_id, v, q) VALUES ($1,$2,$3,$4,$5)"
            " ON CONFLICT (tag_id, ts) DO NOTHING", rows)  # QoS1 replay dedup (I10)


async def _every(seconds: float, fn, name: str) -> None:
    while True:
        await asyncio.sleep(seconds)
        try:
            await fn()
        except Exception:  # noqa: BLE001
            log.exception(f"{name} failed")


async def health_watchdog(st: State) -> None:
    last = None
    while True:
        await asyncio.sleep(config.HEALTH_WATCHDOG_S)
        ev = st.health_event()
        cur = (ev["mqtt"], ev["edge"])
        if cur != last:
            last = cur
            st.ws.broadcast(ev)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    if config.APP_ENV not in ("dev", "test"):
        # Production fail-fast (ADR-12): the OIDC endpoints must be explicit —
        # never boot on localhost/dev defaults, and dev tokens don't exist.
        missing = [k for k in ("OIDC_ISSUER", "OIDC_JWKS_URI")
                   if not os.environ.get(k)]
        if missing:
            raise RuntimeError(
                f"APP_ENV={config.APP_ENV} requires explicit {missing} "
                "— refusing to start on dev defaults")
    pools = await create_pools()
    if config.APP_ENV == "dev":
        await seed(pools)
    st = State(pools)
    app.state.st = st
    await st.registry.refresh()
    await st.alarms.load_rules()
    st.mqtt.on_state_change = lambda connected: st.ws.broadcast(st.health_event())
    st.mqtt.start(asyncio.get_running_loop())
    await st.commands.sweep_interrupted()  # I9 before accepting traffic
    tasks = [
        asyncio.create_task(ingest_worker(st)),
        asyncio.create_task(_every(config.HISTORY_FLUSH_S, lambda: _flush_history(st),
                                   "history flush")),
        asyncio.create_task(_every(config.STALE_RULE_CHECK_S, st.alarms.sweep_stale,
                                   "stale-rule sweep")),
        asyncio.create_task(st.insights.run_forever()),
        asyncio.create_task(health_watchdog(st)),
        # wds_authz NOTIFY -> ≤5s revocation (backchannel logout, disabled
        # users, membership changes) — v4 T5, ADR-12 §7
        asyncio.create_task(authz_listener(st.auth)),
    ]
    log.info("backend started", extra={"org_id": str(config.V1_ORG_ID),
                                       "site": config.V1_SITE_CODE})
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        await st.commands.shutdown()
        with contextlib.suppress(Exception):
            await _flush_history(st)
        st.mqtt.stop()
        await pools.close()


app = FastAPI(title="industrial-dashboard backend", lifespan=lifespan)


@app.exception_handler(AuthError)
async def auth_error_handler(request: Request, exc: AuthError):
    return JSONResponse(status_code=401, content={"detail": exc.detail})


@app.exception_handler(ForbiddenError)
async def forbidden_handler(request: Request, exc: ForbiddenError):
    return JSONResponse(status_code=403, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        err = dict(err)
        err.pop("ctx", None)
        if isinstance(err.get("input"), bytes):
            err["input"] = err["input"].decode("utf-8", "replace")
        errors.append(err)
    return JSONResponse(status_code=400,
                        content={"detail": "invalid_request", "errors": jsonable_encoder(errors)})


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in config.CORS_ORIGIN.split(",")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def st(request: Request) -> State:
    return request.app.state.st


def v1_tx(request: Request, user_id: UUID | None = None):
    return tenant_tx(st(request).pools.app, config.V1_ORG_ID, user_id)


def _uuid_or_404(s: str, what: str) -> UUID:
    try:
        return UUID(s)
    except ValueError:
        raise HTTPException(404, f"{what} not found") from None


# ---------------------------------------------------------------------------
# Machine endpoints
# ---------------------------------------------------------------------------
@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


async def _db_up(s: State) -> bool:
    try:
        async with s.pools.app.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:  # noqa: BLE001
        return False


@app.get("/api/health")
async def health(request: Request):
    s = st(request)
    db = "up" if await _db_up(s) else "down"
    mqtt = "up" if s.mqtt.connected else "down"
    edge = s.edge_status()
    if db == "down" or mqtt == "down":
        status, code = "down", 503
    elif edge == "stale":
        status, code = "degraded", 200
    else:
        status, code = "ok", 200
    return JSONResponse(status_code=code,
                        content={"status": status, "db": db, "mqtt": mqtt, "edge": edge})


# ---------------------------------------------------------------------------
# Auth surface (v4 T5, ADR-12)
# ---------------------------------------------------------------------------
@app.get("/api/auth/config")
async def auth_config():
    """Unauthenticated bootstrap: which sign-in paths the shell may offer.
    The frontend builds the OIDC authority as <origin>/realms/<realm> —
    nginx proxies the IdP same-origin so iss==authority and no CSP change
    is needed."""
    return {
        "env": config.APP_ENV,
        "dev_tokens": config.APP_ENV == "dev",
        "oidc": {"realm": config.OIDC_REALM, "client_id": config.OIDC_CLIENT_ID},
    }


@app.get("/api/me")
async def me(request: Request, p: Principal = Depends(require_user)):
    """Who the bearer token resolves to (CONTRACT.v2 `/api/v1/me`, v1 alias).
    `role`/`orgs` reflect the memberships table — orgs is the full list so a
    no-membership user gets role 'none' rather than a 403 on this endpoint."""
    return {
        "user": {"sub": p.sub, "display_name": p.user},
        "role": p.role,                       # role in the v1 shim org
        "kind": p.kind,
        "orgs": [{"org_id": str(o), "role": r} for o, r in p.org_roles],
    }


@app.post("/api/auth/backchannel-logout")
@app.post("/api/v1/auth/backchannel-logout")
async def backchannel_logout(request: Request):
    """Keycloak back-channel logout (ADR-12 §7). KC POSTs
    `logout_token` (form-encoded); we verify it as an RS256 JWT with
    aud=wds-web, the backchannel event claim and NO nonce, then revoke the
    session — revoked_sessions + wds_authz NOTIFY -> ≤5s effect."""
    # unauthenticated + JWKS-verified → each forged attempt burns a verify;
    # tight per-IP bucket before any work
    ip = _client_ip(request)
    if not await st(request).logout_limiter.allow(ip):
        retry = await st(request).logout_limiter.retry_after(ip)
        return Response(status_code=429,
                        headers={"Retry-After": str(max(1, int(retry + 0.999)))})
    content_type = request.headers.get("content-type", "")
    token = None
    if "application/x-www-form-urlencoded" in content_type:
        # parse urlencoded by hand — python-multipart is a heavy dep for one
        # IdP-facing field
        import urllib.parse
        fields = urllib.parse.parse_qs((await request.body()).decode("utf-8"))
        vals = fields.get("logout_token") or []
        token = vals[0] if vals and isinstance(vals[0], str) else None
    else:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = None
        if isinstance(body, dict) and isinstance(body.get("logout_token"), str):
            token = body["logout_token"]
    if not token:
        raise AuthError("logout_token required")
    claims = await st(request).auth.verify_logout_token(token)
    await st(request).auth.record_logout(claims)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# v1 REST — every read requires an authenticated member (anonymous removed)
# ---------------------------------------------------------------------------
@app.get("/api/tags")
async def list_tags(request: Request, p: Principal = Depends(require_principal)):
    s = st(request)
    await s.registry.maybe_refresh()
    return [{"name": t.v1_name, "writable": t.writable, **({"unit": t.unit} if t.unit else {})}
            for t in sorted(s.registry.all(), key=lambda t: t.v1_name)]


@app.get("/api/tags/latest")
async def tags_latest_bulk(request: Request,
                           p: Principal = Depends(require_principal)):
    """All latest values for the site in one call (CONTRACT.v2 `/tags/latest`)."""
    s = st(request)
    await s.registry.maybe_refresh()
    async with v1_tx(request) as tc:
        rows = await tc.fetch("SELECT tag_id, v, q, ts FROM tag_latest")
    out = []
    for r in rows:
        tag = s.registry.by_id(r["tag_id"])
        if tag:
            out.append({"name": tag.v1_name, "v": finite_or_none(r["v"]), "q": r["q"],
                        "ts": iso_z(r["ts"])})
    return out


@app.get("/api/alarm-rules")
async def list_alarm_rules(request: Request,
                           p: Principal = Depends(require_principal)):
    s = st(request)
    async with v1_tx(request) as tc:
        rows = await tc.fetch("SELECT tag_id, name, kind, threshold, stale_s, deadband, severity,"
                              " enabled FROM alarm_rules ORDER BY name")
    out = []
    for r in rows:
        tag = s.registry.by_id(r["tag_id"])
        out.append({"tag": tag.v1_name if tag else None, "name": r["name"], "kind": r["kind"],
                    "threshold": r["threshold"], "stale_s": r["stale_s"],
                    "deadband": r["deadband"], "severity": r["severity"],
                    "enabled": r["enabled"]})
    return out


@app.get("/api/tags/{name:path}/latest")
async def tag_latest(name: str, request: Request,
                     p: Principal = Depends(require_principal)):
    tag = st(request).registry.by_v1_name(name)
    if tag is None:
        raise HTTPException(404, "tag not found or no data yet")
    async with v1_tx(request) as tc:
        row = await tc.fetchrow("SELECT v, q, ts FROM tag_latest WHERE tag_id=$1", tag.id)
    if row is None:
        raise HTTPException(404, "tag not found or no data yet")
    return {"name": tag.v1_name, "v": finite_or_none(row["v"]), "q": row["q"],
            "ts": iso_z(row["ts"])}


@app.get("/api/tags/{name:path}/history")
async def tag_history(
    name: str,
    request: Request,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    p: Principal = Depends(require_principal),
):
    tag = st(request).registry.by_v1_name(name)
    if tag is None:
        return []
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with v1_tx(request) as tc:
        # newest `limit` rows in range, returned oldest→newest (trend seeding)
        rows = await tc.fetch(
            "SELECT v, q, ts FROM (SELECT v, q, ts FROM tag_history WHERE tag_id=$1"
            " AND ($2::timestamptz IS NULL OR ts >= $2) AND ($3::timestamptz IS NULL OR ts <= $3)"
            " ORDER BY ts DESC LIMIT $4) x ORDER BY ts ASC", tag.id, t_from, t_to, limit)
    return [{"v": finite_or_none(r["v"]), "q": r["q"], "ts": iso_z(r["ts"])} for r in rows]


async def _mutation_gate(request: Request, uid: UUID) -> None:
    """Per-user write budget (v4 T4): mutations other than POST /api/commands,
    which carries its own stricter per-tag bucket in CommandManager.issue."""
    s = st(request)
    if not await s.mutation_limiter.allow(str(uid)):
        retry = await s.mutation_limiter.retry_after(str(uid))
        raise HTTPException(status_code=429, detail="rate_limited",
                            headers={"Retry-After": str(max(1, math.ceil(retry)))})


@app.post("/api/commands", status_code=201)
async def post_command(body: CommandIn, request: Request,
                       p: Principal = Depends(require_operator)):
    code, resp = await st(request).commands.issue(
        tag_name=body.tag, value=body.value, ttl_s=body.ttl_s,
        idempotency_key=body.idempotency_key, user_id=p.user_id)
    out = JSONResponse(status_code=code, content=resp)
    if code == 429:
        # RFC 6585 — clients back off on the header, not the body
        out.headers["Retry-After"] = str(resp.get("retry_after_s", 1))
    return out


@app.get("/api/commands")
async def list_commands(request: Request, limit: int = Query(50, ge=1, le=500),
                        tag: str | None = None, user: str | None = None,
                        p: Principal = Depends(require_operator)):
    async with v1_tx(request) as tc:
        return await st(request).commands.list(tc, limit, tag, user)


@app.get("/api/commands/{cid}")
async def get_command(cid: str, request: Request, p: Principal = Depends(require_operator)):
    async with v1_tx(request) as tc:
        cmd = await st(request).commands.get(tc, _uuid_or_404(cid, "command"))
    if cmd is None:
        raise HTTPException(404, "command not found")
    return cmd


@app.get("/api/alarms")
async def list_alarms(request: Request, status: str | None = Query(None),
                      severity: str | None = Query(None),
                      limit: int = Query(100, ge=1, le=500),
                      p: Principal = Depends(require_principal)):
    async with v1_tx(request) as tc:
        return await st(request).alarms.list_alarms(tc, status, severity, limit)


@app.get("/api/insights")
async def list_insights(request: Request,
                        state: str | None = Query(None),
                        kind: str | None = Query(None),
                        tag: str | None = Query(None),
                        from_: str | None = Query(None, alias="from"),
                        to: str | None = Query(None),
                        p: Principal = Depends(require_principal)):
    """Engine-generated insights (doc 19 §4.3) — additive v1 endpoint.
    Member read, same policy as /api/alarms (anonymous removed, v4 T5)."""
    s = st(request)
    if state is not None and state not in ("open", "closed"):
        raise HTTPException(400, "invalid_request")
    if kind is not None and kind not in INSIGHT_KINDS:
        raise HTTPException(400, "invalid_request")
    tag_id = None
    if tag is not None:
        t = s.registry.by_v1_name(tag)
        if t is None:
            return []
        tag_id = t.id
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with v1_tx(request) as tc:
        return await s.insights.list_insights(tc, state, kind, tag_id, t_from, t_to)


@app.post("/api/alarms/{alarm_id}/ack")
async def ack_alarm(alarm_id: str, request: Request,
                    p: Principal = Depends(require_authenticated)):
    uid = p.user_id
    await _mutation_gate(request, uid)
    async with v1_tx(request, uid) as tc:
        alarm = await st(request).alarms.ack(tc, _uuid_or_404(alarm_id, "alarm"), uid,
                                             f"user:{uid}")
    if alarm is None:
        raise HTTPException(404, "alarm not found")
    return alarm


@app.get("/api/system/health")
async def system_health(request: Request,
                        p: Principal = Depends(require_principal)):
    s = st(request)
    return {
        "mqtt": {"connected": s.mqtt.connected},
        "edge": {"last_heartbeat_ts": s.edge["last_heartbeat_ts"],
                 "clock_ok": s.edge["clock_ok"]},
        "backend": {
            "uptime_s": round(time.monotonic() - START_TIME, 1),
            "ws_clients": s.ws.client_count(),
            "ws_msgs_dropped": s.ws.total_dropped,
            "mqtt_ingest_dropped": s.mqtt.dropped_msgs,
            **s.counters,
        },
    }


# ---------------------------------------------------------------------------
# WebSocket (v1)
# ---------------------------------------------------------------------------
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


async def _close_at_exp(client, exp: float) -> None:
    """Close the socket at token exp + 30 s (ADR-12 WS section: the server
    ends a connection at exp + 30s unless the client re-auths; v1 has no
    reauth frame — the SPA reconnects with a silently-renewed token)."""
    delay = exp + 30 - time.time()
    if delay <= 0:
        delay = 0.01
    try:
        await asyncio.sleep(delay)
        with contextlib.suppress(Exception):
            await client.ws.close(code=4401)
    except asyncio.CancelledError:
        raise


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    # First-frame auth (v4 T3): the token rides in the first client frame —
    # {"type":"auth","token":"…"} — never ?token= in the URL, which leaked
    # into access logs and proxy traces.
    #
    # v4 T5: anonymous connections are gone. The auth frame must carry a
    # valid OIDC JWT (or an APP_ENV=dev dev token) — absent/unresolvable ->
    # 4401; authenticated but not a member of the shim org -> 4403
    # (CONTRACT.v2 §5 step 2).
    #
    # v4 T4 gates run before the auth handshake: Origin allowlist/same-origin
    # and a per-IP connection cap both close 4403. accept() happens first
    # because a WS close code is only deliverable on an accepted socket.
    await ws.accept()
    manager: WSManager = ws.app.state.st.ws
    ip = _client_ip(ws)
    if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host"),
                          config.ALLOWED_ORIGINS,
                          # fail closed: only the named dev envs get the
                          # loopback carve-out — a typo'd APP_ENV is strict
                          dev=config.APP_ENV in ("dev", "test")):
        log.info("ws origin rejected — closing 4403",
                 extra={"origin": ws.headers.get("origin"), "ip": ip})
        with contextlib.suppress(Exception):
            await ws.close(code=4403)
        return
    if not await manager.acquire_ip(ip, config.RATE_WS_PER_IP):
        log.info("ws per-ip connection cap — closing 4403", extra={"ip": ip})
        with contextlib.suppress(Exception):
            await ws.close(code=4403)
        return
    try:
        try:
            token = await read_auth_token(ws)
            p = await ws.app.state.st.auth.authenticate(token or None)
        except WSAuthError as e:
            log.info("ws auth failed — closing 4401", extra={"reason": str(e)})
            # client may already be gone mid-handshake — don't traceback on close
            with contextlib.suppress(Exception):
                await ws.close(code=4401)
            return
        except AuthError as e:
            # reason only — NEVER the token value
            log.info("ws auth failed — closing 4401",
                     extra={"reason": e.detail})
            with contextlib.suppress(Exception):
                await ws.close(code=4401)
            return
        if not p.member:
            log.info("ws authenticated but not a member — closing 4403")
            with contextlib.suppress(Exception):
                await ws.close(code=4403)
            return
        client = await manager.connect(ws, p.role, sub=p.sub, sid=p.sid)
        pump: asyncio.Task | None = None
        exp_task: asyncio.Task | None = None
        if p.exp:
            exp_task = asyncio.create_task(_close_at_exp(client, p.exp))
        try:
            pump = asyncio.create_task(manager.pump(client))
            with contextlib.suppress(asyncio.QueueFull):
                client.queue.put_nowait(ws.app.state.st.health_event())
            while True:
                text = await ws.receive_text()
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict) and msg.get("type") == "ping":
                    with contextlib.suppress(asyncio.QueueFull):
                        client.queue.put_nowait({"type": "pong", "ts": iso_z()})
        except WebSocketDisconnect:
            pass
        finally:
            # disconnect must run even if pump creation raised above —
            # otherwise the Client leaks in _clients forever
            if exp_task is not None:
                exp_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await exp_task
            if pump is not None:
                pump.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pump
            await manager.disconnect(client)
    finally:
        await manager.release_ip(ip)
