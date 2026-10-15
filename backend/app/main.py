"""FastAPI backend — industrial dashboard.

v4 T9: real multi-tenant routing (CONTRACT.v2 §3/§5). The v2 surface
(`/api/v1/orgs/{org}/sites/{site}/…`, `/ws/v1` with a `site_id` auth frame)
resolves the org from the PATH, checked against the caller's memberships —
non-member or unknown org is a flat 404 (no existence oracle; ADR-13 §1).

The v1 `/api/*` + `/ws` surface remains as a documented compatibility shim:
it is pinned to the seeded dev org (config.V1_ORG_ID) and v1 wire shapes.
`v1_tx()` is the only place that pin lives on the read/write path.
"""

from __future__ import annotations

import asyncio
import contextlib
import csv
import hashlib
import io
import json
import logging
import math
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

from . import config
from .alarms import (
    AlarmEngine, RULES_NOTIFY_CHANNEL, Rule, rules_notify_listener,
)
from .auth import OPERATOR_ROLES, Principal
from .commands import CommandManager
from .dynsec import (
    DynsecAdmin, DynsecError, Reconciler,
    edge_acls, edge_client_name, edge_role_name, fingerprint, new_secret,
)
from .insights import INSIGHT_KINDS, InsightEngine
from .db import audit
from .db.context import global_tx, invite_tx, tenant_tx, user_tx
from .db.pool import Pools, create_pools
from .db.util import finite_or_none, iso_z, parse_ts, utcnow
from .mqtt_client import MQTTBridge
from .observability import (
    ObservabilityMiddleware, _client_ip, _trusted_peer,
    metrics_response, migration_at_head, RUNTIME,
)
from .ratelimit import RateLimiter
from .registry import Registry
from .security import (
    AuthError, ForbiddenError, Security, authz_listener, authz_sweep,
)
from .seed import seed
from .ws import (
    OriginGuardMiddleware, WSManager, WSAuthError, origin_allowed,
    read_auth_frame,
)

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


class CommandInV2(BaseModel):
    """CONTRACT.v2 §3 commands body — the tag is selected by tag_id (an id in
    the path site); org/site come ONLY from the path, never the body."""
    tag_id: str
    value: float | bool
    ttl_s: int = Field(default=10, ge=1, le=60)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=200)

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
    p = await st(request).auth.authenticate(token)
    # The access-log middleware reads this AFTER the request completes —
    # the sub, never the token (v4 T8).
    request.state.principal = p
    return p


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
            config.MQTT_HOST, config.MQTT_PORT,
            username=config.MQTT_USER, password=config.MQTT_PASSWORD,
            ca_file=config.MQTT_CA_FILE,
        )
        # svc-dynsec-admin channel (doc 17 §2): provisioning API + reconciler
        self.dynsec = DynsecAdmin(
            config.MQTT_HOST, config.MQTT_PORT,
            config.DYNSEC_ADMIN_USER, config.DYNSEC_ADMIN_PASSWORD or "",
            ca_file=config.MQTT_CA_FILE,
        )
        self.reconciler = Reconciler(
            pools, self.dynsec, reconcile_s=config.DYNSEC_RECONCILE_S,
            svc_backend_pw_file=config.SVC_BACKEND_PW_FILE,
            tester_pw_file=config.TESTER_PW_FILE,
            edge_bootstrap_pw_file=config.EDGE_BOOTSTRAP_PW_FILE,
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
                         "telemetry_future_ts": 0, "telemetry_too_old": 0,
                         # doc 17 §4 — security events, counted + logged
                         "mqtt_topic_identity_mismatch": 0,
                         "mqtt_bad_topic": 0}
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
    """doc 17 §4 trust rules: org/site/edge come FROM THE TOPIC, never the
    payload. The topic edge must exist, be active, and match both topic ids —
    the broker ACL is the primary fence, this is defense in depth."""
    parts = msg.topic.split("/")
    if len(parts) < 5 or parts[0] != "v2":
        return _count(st, "mqtt_bad_topic", "non-v2 topic reached ingest — dropped",
                      topic=msg.topic)
    try:
        org_id, site_id, edge_id = UUID(parts[1]), UUID(parts[2]), UUID(parts[3])
    except ValueError:
        return _count(st, "mqtt_bad_topic", "v2 topic with non-uuid ids — dropped",
                      topic=msg.topic)
    await st.registry.maybe_refresh()
    edge = st.registry.edge(edge_id)
    if (edge is None or edge.status != "active"
            or edge.org_id != org_id or edge.site_id != site_id):
        return _count(st, "mqtt_topic_identity_mismatch",
                      "mqtt.topic_identity_mismatch — dropped",
                      topic=msg.topic)

    kind = parts[4]
    if kind == "hb" and len(parts) == 5:
        return await _handle_heartbeat(st, msg, edge)
    if kind == "cmd-resp" and len(parts) == 6:
        return _handle_cmd_resp(st, msg, org_id, edge_id)
    if kind == "tele" and len(parts) >= 6:
        return await _handle_telemetry(st, msg, edge, "/".join(parts[5:]))
    return _count(st, "mqtt_bad_topic", "unrecognized v2 subtree — dropped",
                  topic=msg.topic)


async def _handle_telemetry(st: State, msg, edge, path: str) -> None:
    # rule 3: the tag path must resolve to a tag of THAT site bound to THIS
    # edge — (site, path) keyed since T9; two orgs may share a path string.
    tag = st.registry.by_path(edge.site_id, path)
    if tag is None or tag.edge_id != edge.id:
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
    async with tenant_tx(st.pools.system, edge.org_id) as tc:
        # tag_latest is monotonic: a late/replayed sample never overwrites newer data
        res = await tc.execute(
            "INSERT INTO tag_latest(tag_id, org_id, v, q, ts) VALUES ($1,$2,$3,$4,$5)"
            " ON CONFLICT (tag_id) DO UPDATE SET v=excluded.v, q=excluded.q, ts=excluded.ts"
            " WHERE tag_latest.ts < excluded.ts",
            tag.id, tc.org_id, v, q, ts)
        await st.alarms.evaluate(tc, tag.id, v, q, ts)
    st.history_buf.append((tag.id, ts, edge.org_id, v, q))
    if len(st.history_buf) >= config.HISTORY_FLUSH_ROWS:
        await _flush_history(st)
    if res.endswith(" 1"):
        # Org-scoped fan-out (v4 T9): only members of edge.org_id see this.
        # `name` is the real site code + path (== v1_name for the shim site);
        # org/site/tag ids ride along for the CONTRACT.v2 §5 wire.
        st.ws.broadcast(
            {"type": "tag", "name": st.registry.display_name(tag),
             "v": v, "q": q, "ts": payload.ts,
             "org_id": str(edge.org_id), "site_id": str(edge.site_id),
             "tag_id": str(tag.id), "path": tag.path},
            org_id=edge.org_id)


async def _handle_heartbeat(st: State, msg, edge) -> None:
    was = st.edge_status()
    try:
        payload = json.loads(msg.payload)
        if not isinstance(payload, dict):
            payload = {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}
    is_v1_edge = edge.id == config.V1_EDGE_ID
    if is_v1_edge:
        st.edge.update(last_rx=time.monotonic(), last_heartbeat_ts=payload.get("ts"),
                       clock_ok=payload.get("clock_ok"), adapter=payload.get("adapter"))
    clock_ok = payload.get("clock_ok") if isinstance(payload.get("clock_ok"), bool) else None
    adapter = payload.get("adapter") if isinstance(payload.get("adapter"), str) else None
    buf_d = payload.get("buffer_depth") if isinstance(payload.get("buffer_depth"), int) else None
    buf_dr = payload.get("buffer_dropped") if isinstance(payload.get("buffer_dropped"), int) else None
    async with tenant_tx(st.pools.system, edge.org_id) as tc:
        await tc.execute(
            "UPDATE edges SET last_hb_at=now(), clock_ok=$2, adapter=$3,"
            " buffer_depth=COALESCE($4, buffer_depth),"
            " buffer_dropped=COALESCE($5, buffer_dropped) WHERE id=$1",
            edge.id, clock_ok, adapter, buf_d, buf_dr)
    if is_v1_edge and st.edge_status() != was:
        # the tracked edge is the shim org's — scope the event to it
        st.ws.broadcast(st.health_event(), org_id=config.V1_ORG_ID)


def _handle_cmd_resp(st: State, msg, org_id: UUID, edge_id: UUID) -> None:
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
    # CONTRACT.v2 §6 names the field `reason`; `detail` tolerated for compat
    asyncio.ensure_future(st.commands.handle_response(
        cid, status, payload.get("reason") or payload.get("detail"),
        org_id, edge_id))


async def _flush_history(st: State) -> None:
    if not st.history_buf:
        return
    rows, st.history_buf = st.history_buf, []
    # rows carry their own org (routed by topic, doc 17 §4) — group so each
    # tenant_tx only ever writes its own tenant's rows
    by_org: dict[UUID, list] = {}
    for r in rows:
        by_org.setdefault(r[2], []).append(r)
    for org_id, batch in by_org.items():
        async with tenant_tx(st.pools.system, org_id) as tc:
            await tc.executemany(
                "INSERT INTO tag_history(tag_id, ts, org_id, v, q) VALUES ($1,$2,$3,$4,$5)"
                " ON CONFLICT (tag_id, ts) DO NOTHING", batch)  # QoS1 replay dedup (I10)


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
            # shim-org event (v1 edge + broker reachability)
            st.ws.broadcast(ev, org_id=config.V1_ORG_ID)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # Prod fail-fast lives in config.py at import (v4 T7) — reaching lifespan
    # means the env already passed: no missing required vars, no dev-default
    # secrets, OIDC endpoints explicit, dev tokens don't exist.
    pools = await create_pools()
    if config.APP_ENV == "dev":
        await seed(pools)
    st = State(pools)
    app.state.st = st
    RUNTIME.bind(st)  # /metrics runtime collector (v4 T8)
    await st.registry.refresh()
    await st.alarms.load_rules()
    # svc-dynsec-admin comes up first so the reconciler's initial pass can
    # mint svc-backend + edge clients BEFORE ingest connects (doc 17 §6:
    # reconcile runs at startup, then every 60 s / on NOTIFY wds_edges).
    st.dynsec.start(asyncio.get_running_loop())
    for _ in range(200):
        if st.dynsec.connected:
            break
        await asyncio.sleep(0.1)
    try:
        await asyncio.wait_for(st.reconciler.reconcile(), timeout=15.0)
    except Exception:  # noqa: BLE001 — reconcile retries on its own cadence
        log.exception("initial dynsec reconcile failed — continuing")
    st.mqtt.on_state_change = lambda connected: st.ws.broadcast(
        st.health_event(), org_id=config.V1_ORG_ID)
    st.mqtt.start(asyncio.get_running_loop())
    await st.commands.sweep_interrupted()  # I9 before accepting traffic
    tasks = [
        asyncio.create_task(ingest_worker(st)),
        asyncio.create_task(st.reconciler.run_forever()),
        asyncio.create_task(_every(config.HISTORY_FLUSH_S, lambda: _flush_history(st),
                                   "history flush")),
        asyncio.create_task(_every(config.STALE_RULE_CHECK_S, st.alarms.sweep_stale,
                                   "stale-rule sweep")),
        asyncio.create_task(st.insights.run_forever()),
        asyncio.create_task(health_watchdog(st)),
        # wds_authz NOTIFY -> ≤5s revocation (backchannel logout, disabled
        # users, membership changes) — v4 T5, ADR-12 §7. The sweep is the
        # missed-NOTIFY backstop: a notification published while the LISTEN
        # socket is down is gone forever, so connected clients are
        # revalidated against the source tables every AUTHZ_SWEEP_S (v4 T14).
        asyncio.create_task(authz_listener(st.auth)),
        asyncio.create_task(authz_sweep(st.auth, config.AUTHZ_SWEEP_S)),
        # alarm_rules_changed NOTIFY -> rule reload without restart (v4 T10)
        asyncio.create_task(rules_notify_listener(st.alarms)),
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
        st.dynsec.stop()
        await pools.close()


# Docs only exist in dev (v4 T8 — T5-deferred F7): a prod deployment must not
# publish the API surface to anyone who can reach the port.
_DEV_DOCS = config.APP_ENV == "dev"
app = FastAPI(
    title="industrial-dashboard backend", lifespan=lifespan,
    docs_url="/docs" if _DEV_DOCS else None,
    redoc_url="/redoc" if _DEV_DOCS else None,
    openapi_url="/openapi.json" if _DEV_DOCS else None)


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
# REST Origin gate (v4 T14, CONTRACT.v2 §2, ADR-12 §8): mutating /api calls
# that carry an Origin header must pass the same allowlist/same-origin
# policy as the WS upgrade — missing Origin is allowed (non-browser clients
# send none; browsers always send it on cross-origin mutations). Runs inside
# ObservabilityMiddleware so a 403 still carries X-Request-ID + access log.
app.add_middleware(
    OriginGuardMiddleware,
    is_allowed=lambda origin, host: origin_allowed(
        origin, host, config.ALLOWED_ORIGINS,
        dev=config.APP_ENV in ("dev", "test")),
)
# Outermost (added last): every HTTP request gets a request-id, a JSON access
# log line and Prometheus counters — including requests CORS rejects (v4 T8).
app.add_middleware(ObservabilityMiddleware)


def st(request: Request) -> State:
    return request.app.state.st


def v1_tx(request: Request, user_id: UUID | None = None):
    """v1 COMPAT SHIM (v4 T9): the /api/* endpoints predate org routing, so
    they are pinned to the seeded dev org. Every v2 call site resolves the
    org from the path instead — this is the only org pin left on the
    request path."""
    return tenant_tx(st(request).pools.app, config.V1_ORG_ID, user_id)


def org_tx(request: Request, org_id: UUID, user_id: UUID | None = None):
    """Tenant transaction for the org the v2 ROUTE resolved (membership
    already checked by the _v2_* scope helpers)."""
    return tenant_tx(st(request).pools.app, org_id, user_id)


def _effective_org_roles(p: Principal) -> dict[UUID, str]:
    """org_id -> role from the principal's hydrated memberships.

    Dev tokens hydrate org_roles from the `memberships` table at
    authenticate() time (v4 T6), so a dev user IS a member of every org the
    table says — including non-shim orgs created by tests/admin paths.
    Fallback: a principal whose memberships couldn't hydrate (pools
    unavailable) keeps only its nominal shim-org role."""
    roles = dict(p.org_roles)
    if not roles and p.member:
        roles = {config.V1_ORG_ID: p.role}
    return roles


# CONTRACT.v2 §1 permission levels used by the v2 scope helpers.
_READ = "read"        # any member
_OPERATE = "operate"  # alarm:ack / command:issue / command:read
_CONFIG = "config"    # config:write


def _v2_org(org: str, p: Principal, need: str = _READ) -> UUID:
    """Resolve + authorize the /api/v1/orgs/{org} segment (v4 T9).

    Non-member OR non-existent org -> 404 — the same response either way,
    so the route is never an existence oracle (CONTRACT.v2 §1, ADR-13 §1).
    A member without the permission level -> 403."""
    org_id = _uuid_or_404(org, "organization")
    role = _effective_org_roles(p).get(org_id)
    if role is None:
        raise HTTPException(404, "not found")
    if need == _OPERATE and role not in OPERATOR_ROLES:
        raise ForbiddenError("operator role required in this org")
    if need == _CONFIG and role not in CONFIG_ROLES:
        raise ForbiddenError("config:write requires admin or owner")
    return org_id


def _v2_scope(org: str, site: str, p: Principal,
              need: str = _READ) -> tuple[UUID, UUID]:
    """Resolve + authorize an /api/v1/orgs/{org}/sites/{site} path."""
    return _v2_org(org, p, need), _uuid_or_404(site, "site")


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


@app.get("/readyz")
async def readyz(request: Request):
    """Readiness: DB connect + alembic_version at the code head (v4 T8,
    doc 18 §1.3). Backend-only — nginx does not proxy it (CONTRACT.v2); the
    compose healthcheck stays on /api/health."""
    s = st(request)
    db_up = await _db_up(s)
    mig_ok, mig_detail = (await migration_at_head(s.pools.app)) if db_up \
        else (False, "db_down")
    ready = db_up and mig_ok
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready",
                 "db": "up" if db_up else "down",
                 "migrations": mig_detail})


@app.get("/metrics")
async def metrics():
    """Prometheus scrape — backend port only (loopback-bound; nginx returns
    404 for /metrics on the web origin). See app.observability docstring."""
    return metrics_response()


async def _db_up(s: State) -> bool:
    try:
        # Bounded wait — under pool saturation the probe must answer
        # down/503, not hang (T8 review).
        async with asyncio.timeout(5):
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
        "idps": config.IDPS,
    }


# CONTRACT.v2 §1 permission table, by org role.
ROLE_PERMISSIONS = {
    "viewer": ["site:read"],
    "operator": ["site:read", "alarm:ack", "command:issue", "command:read"],
    "admin": ["site:read", "alarm:ack", "command:issue", "command:read",
              "config:write", "member:manage", "audit:read"],
    "owner": ["site:read", "alarm:ack", "command:issue", "command:read",
              "config:write", "member:manage", "audit:read",
              "org:delete", "org:transfer"],
}


@app.get("/api/me")
@app.get("/api/v1/me")
async def me(request: Request, p: Principal = Depends(require_user)):
    """Who the bearer token resolves to (CONTRACT.v2 `/api/v1/me` — the v1
    `/api/me` path is the compat alias). `role` is the v1 shim-org role;
    `memberships` is the full org list (CONTRACT.v2 §3 identity shape) so a
    no-membership user gets role 'none' rather than a 403."""
    roles = _effective_org_roles(p)
    names: dict[UUID, str] = {}
    if p.user_id is not None:
        # member orgs only (org_member_read policy) — never reveals others
        async with user_tx(st(request).pools.app, p.user_id) as conn:
            rows = await conn.fetch("SELECT id, name FROM organizations")
        names = {r["id"]: r["name"] for r in rows}
    memberships = [{"org_id": str(o), "org_name": names.get(o), "role": r,
                    "permissions": ROLE_PERMISSIONS.get(r, [])}
                   for o, r in roles.items()]
    return {
        "user": {"sub": p.sub, "display_name": p.user},
        "role": p.role,                       # role in the v1 shim org
        "kind": p.kind,
        "orgs": [{"org_id": str(o), "role": r} for o, r in p.org_roles],
        "memberships": memberships,
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
    """v1 shim: the seeded site's tags only — the registry is now multi-org
    (v4 T9), so the compat surface must filter or other orgs' tags would
    leak under plant1-prefixed names."""
    s = st(request)
    await s.registry.maybe_refresh()
    return [{"name": t.v1_name, "writable": t.writable, **({"unit": t.unit} if t.unit else {})}
            for t in sorted(s.registry.for_site(config.V1_SITE_ID),
                            key=lambda t: t.v1_name)]


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
        # seeded-SITE filter (T9-review F3): /api/tags already scopes to
        # V1_SITE_ID — the bulk latest must too, not just the shim org
        if tag and tag.site_id == config.V1_SITE_ID:
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
    s = st(request)
    code, resp = await s.commands.issue(
        tag=s.registry.by_v1_name(body.tag),   # shim-site resolution only
        org_id=config.V1_ORG_ID, site_id=config.V1_SITE_ID,
        value=body.value, ttl_s=body.ttl_s,
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
                        p: Principal = Depends(require_operator)):
    """Detail health — operator+ only (v4 T8, doc 20 §3.3): ws client counts,
    ingest counters and dynsec internals are operational intel a viewer
    doesn't need. Viewers get the coarse, public /api/health + the WS health
    event; the SPA stops polling this endpoint for them."""
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
            # ingest counters + dynsec reconciler + alarm/insight engines
            # (the same dicts /metrics exports)
            **s.counters,
            **s.reconciler.counters,
            **s.alarms.counters,
            **s.insights.counters,
        },
    }


# ---------------------------------------------------------------------------
# Edge provisioning (doc 17 §5 + CONTRACT.v2 §3 site-scoped routes)
#
# v4 T9: these take `require_user` (any authenticated principal), NOT
# require_principal — the org check is the PATH org's membership via
# _v2_scope. A principal who belongs only to a non-shim org can manage its
# own edges; a member of org A hitting org B's routes sees 404.
# ---------------------------------------------------------------------------
CONFIG_ROLES = frozenset({"admin", "owner"})  # CONTRACT.v2 §1 config:write


class EdgeIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _edge_json(r, latest_ident=None) -> dict:
    return {
        "id": str(r["id"]), "org_id": str(r["org_id"]), "site_id": str(r["site_id"]),
        "name": r["name"], "status": r["status"],
        "mqtt_username": r["mqtt_username"],
        "credential_version": r["credential_version"],
        "last_hb_at": iso_z(r["last_hb_at"]) if r["last_hb_at"] else None,
        "clock_ok": r["clock_ok"], "adapter": r["adapter"],
        # the reconciler recreated a lost credential: broker is live, nobody
        # holds the secret — rotate to regain access (doc 17 §6)
        "needs_rotation": bool(latest_ident and not latest_ident["secret_issued"]),
    }


async def _site_or_404(pools: Pools, org_id: UUID, site_id: UUID) -> None:
    async with tenant_tx(pools.app, org_id) as tc:
        # RLS does the hiding: a site of ANOTHER org is simply not found —
        # identical response to a site that doesn't exist at all (no oracle).
        exists = await tc.fetchval("SELECT 1 FROM sites WHERE id=$1", site_id)
    if not exists:
        raise HTTPException(404, "site not found")


def _v2_tag(t, registry) -> dict:
    """CONTRACT.v2 §4 Tag — path is site-relative; ids only, no v1 names."""
    out = {
        "id": str(t.id),
        "site_id": str(t.site_id),
        "edge_id": str(t.edge_id) if t.edge_id else None,
        "path": t.path,
        "name": t.name,
        "type": t.type,
        "writable": t.writable,
    }
    if t.unit:
        out["unit"] = t.unit
    if t.min_value is not None:
        out["min"] = t.min_value
    if t.max_value is not None:
        out["max"] = t.max_value
    return out


async def _v2_tag_or_404(request: Request, org_id: UUID, site_id: UUID,
                         tag_s: str):
    """Resolve a path tag_id against the registry AND the route's org+site —
    a valid tag id of another tenant is a 404, never a leak."""
    s = st(request)
    tid = _uuid_or_404(tag_s, "tag")
    await s.registry.maybe_refresh()
    t = s.registry.by_id(tid)
    if t is None or t.org_id != org_id or t.site_id != site_id:
        await s.registry.refresh()          # cold-cache retry once
        t = s.registry.by_id(tid)
    if t is None or t.org_id != org_id or t.site_id != site_id:
        raise HTTPException(404, "tag not found")
    return t


# ---------------------------------------------------------------------------
# v2 REST — CONTRACT.v2 §3/§4 org+site-scoped resources (v4 T9)
#
# Every handler resolves (org_id, site_id) via _v2_scope: org_id from the
# PATH authorized against the principal's memberships — non-member == 404 —
# then the site must live inside that org (RLS hides foreign sites → 404).
# No handler ever reads an org from body/query/MQTT payloads (ADR-13 §1).
# ---------------------------------------------------------------------------


@app.get("/api/v1/orgs/{org}")
async def v2_get_org(org: str, request: Request,
                     p: Principal = Depends(require_user)):
    """Org detail for a member; non-member gets the same 404 as a
    non-existent org (CONTRACT.v2 §1 existence rule)."""
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id) as tc:
        row = await tc.fetchrow(
            "SELECT name, created_at FROM organizations WHERE id=$1", org_id)
    return {"id": str(org_id), "name": row["name"],
            "role": _effective_org_roles(p)[org_id],
            "created_at": iso_z(row["created_at"])}


@app.get("/api/v1/orgs/{org}/sites")
async def v2_list_sites(org: str, request: Request,
                        p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, name, code, timezone FROM sites ORDER BY name")
    return {"items": [{"id": str(r["id"]), "name": r["name"],
                       "code": r["code"], "timezone": r["timezone"]}
                      for r in rows],
            "next_cursor": None}


@app.get("/api/v1/orgs/{org}/sites/{site}/tags")
async def v2_list_tags(org: str, site: str, request: Request,
                       search: str | None = Query(None),
                       writable: bool | None = Query(None),
                       p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    s = st(request)
    await s.registry.maybe_refresh()
    items = []
    for t in sorted(s.registry.for_site(site_id), key=lambda t: t.path):
        if search and search.lower() not in t.path.lower() \
                and search.lower() not in t.name.lower():
            continue
        if writable is not None and t.writable != writable:
            continue
        items.append(_v2_tag(t, s.registry))
    return {"items": items, "next_cursor": None}


@app.get("/api/v1/orgs/{org}/sites/{site}/tags/latest")
async def v2_tags_latest(org: str, site: str, request: Request,
                         p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT tag_id, v, q, ts FROM tag_latest WHERE tag_id IN"
            " (SELECT id FROM tags WHERE site_id=$1)", site_id)
    return {"items": [{"tag_id": str(r["tag_id"]), "v": finite_or_none(r["v"]),
                       "q": r["q"], "ts": iso_z(r["ts"])} for r in rows],
            "next_cursor": None}


@app.get("/api/v1/orgs/{org}/sites/{site}/tags/{tag_id}/latest")
async def v2_tag_latest(org: str, site: str, tag_id: str, request: Request,
                        p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    tag = await _v2_tag_or_404(request, org_id, site_id, tag_id)
    async with org_tx(request, org_id) as tc:
        row = await tc.fetchrow(
            "SELECT v, q, ts FROM tag_latest WHERE tag_id=$1", tag.id)
    if row is None:
        raise HTTPException(404, "tag not found or no data yet")
    return {"tag_id": str(tag.id), "v": finite_or_none(row["v"]),
            "q": row["q"], "ts": iso_z(row["ts"])}


@app.get("/api/v1/orgs/{org}/sites/{site}/tags/{tag_id}/history")
async def v2_tag_history(org: str, site: str, tag_id: str, request: Request,
                         from_: str | None = Query(None, alias="from"),
                         to: str | None = Query(None),
                         limit: int = Query(500, ge=1, le=5000),
                         p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    tag = await _v2_tag_or_404(request, org_id, site_id, tag_id)
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, org_id) as tc:
        # newest `limit` rows in range, returned oldest→newest
        rows = await tc.fetch(
            "SELECT v, q, ts FROM (SELECT v, q, ts FROM tag_history"
            " WHERE tag_id=$1 AND ($2::timestamptz IS NULL OR ts >= $2)"
            " AND ($3::timestamptz IS NULL OR ts <= $3)"
            " ORDER BY ts DESC LIMIT $4) x ORDER BY ts ASC",
            tag.id, t_from, t_to, limit)
    return {"items": [{"v": finite_or_none(r["v"]), "q": r["q"],
                       "ts": iso_z(r["ts"])} for r in rows],
            "next_cursor": None}


@app.get("/api/v1/orgs/{org}/sites/{site}/alarm-rules")
async def v2_list_alarm_rules(org: str, site: str, request: Request,
                              p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, tag_id, name, kind, threshold, stale_s, deadband,"
            " severity, enabled FROM alarm_rules WHERE tag_id IN"
            " (SELECT id FROM tags WHERE site_id=$1) ORDER BY name", site_id)
    return {"items": [{"id": str(r["id"]), "tag_id": str(r["tag_id"]),
                       "name": r["name"], "kind": r["kind"],
                       "threshold": r["threshold"], "stale_s": r["stale_s"],
                       "deadband": r["deadband"], "severity": r["severity"],
                       "enabled": r["enabled"]} for r in rows],
            "next_cursor": None}


@app.get("/api/v1/orgs/{org}/sites/{site}/alarms")
async def v2_list_alarms(org: str, site: str, request: Request,
                         state: str | None = Query(None),
                         severity: str | None = Query(None),
                         limit: int = Query(100, ge=1, le=500),
                         p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    async with org_tx(request, org_id) as tc:
        items = await st(request).alarms.list_alarms_v2(
            tc, site_id, state, severity, limit)
    return {"items": items, "next_cursor": None}


@app.post("/api/v1/orgs/{org}/sites/{site}/alarms/{alarm_id}/ack")
async def v2_ack_alarm(org: str, site: str, alarm_id: str, request: Request,
                       p: Principal = Depends(require_user)):
    """alarm:ack — operator role IN THE PATH ORG (a shim-org operator has no
    standing here; the _v2_scope check is per-org, not global)."""
    org_id, site_id = _v2_scope(org, site, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        alarm = await st(request).alarms.ack(
            tc, _uuid_or_404(alarm_id, "alarm"), p.user_id,
            f"user:{p.user_id}", site_id=site_id)
        if alarm is None:
            raise HTTPException(404, "alarm not found")
        out = await st(request).alarms._serialize_v2(tc, UUID(alarm["id"]))
    return out


@app.get("/api/v1/orgs/{org}/sites/{site}/insights")
async def v2_list_insights(org: str, site: str, request: Request,
                           state: str | None = Query(None),
                           kind: str | None = Query(None),
                           tag: str | None = Query(None),
                           from_: str | None = Query(None, alias="from"),
                           to: str | None = Query(None),
                           p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    if state is not None and state not in ("open", "closed"):
        raise HTTPException(400, "invalid_request")
    if kind is not None and kind not in INSIGHT_KINDS:
        raise HTTPException(400, "invalid_request")
    tag_id = None
    if tag is not None:
        tag_id = (await _v2_tag_or_404(request, org_id, site_id, tag)).id
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, org_id) as tc:
        items = await st(request).insights.list_insights(
            tc, state, kind, tag_id, t_from, t_to, site_id=site_id)
    return {"items": items, "next_cursor": None}


@app.post("/api/v1/orgs/{org}/sites/{site}/commands", status_code=201)
async def v2_post_command(org: str, site: str, body: CommandInV2,
                          request: Request,
                          p: Principal = Depends(require_user)):
    """command:issue — operator+ in the PATH org (CONTRACT.v2 §1)."""
    org_id, site_id = _v2_scope(org, site, p, need=_OPERATE)
    tag = await _v2_tag_or_404(request, org_id, site_id, body.tag_id)
    s = st(request)
    code, resp = await s.commands.issue(
        tag=tag, org_id=org_id, site_id=site_id, value=body.value,
        ttl_s=body.ttl_s, idempotency_key=body.idempotency_key,
        user_id=p.user_id, note=body.note)
    if code in (200, 201):
        async with org_tx(request, org_id) as tc:
            cmd = await s.commands.get_v2(
                tc, UUID(resp["command_id"]), site_id)
        out = JSONResponse(status_code=code, content={"command": cmd})
    else:
        out = JSONResponse(status_code=code, content=resp)
    if code == 429:
        out.headers["Retry-After"] = str(resp.get("retry_after_s", 1))
    return out


@app.get("/api/v1/orgs/{org}/sites/{site}/commands")
async def v2_list_commands(org: str, site: str, request: Request,
                           limit: int = Query(50, ge=1, le=500),
                           cursor: str | None = Query(None),
                           p: Principal = Depends(require_user)):
    """command:read — operator+ in the path org (CONTRACT.v2 §1)."""
    org_id, site_id = _v2_scope(org, site, p, need=_OPERATE)
    await _site_or_404(st(request).pools, org_id, site_id)
    async with org_tx(request, org_id) as tc:
        items, next_cursor = await st(request).commands.list_v2(
            tc, site_id, limit, cursor)
    return {"items": items, "next_cursor": next_cursor}


@app.get("/api/v1/orgs/{org}/sites/{site}/commands/{command_id}")
async def v2_get_command(org: str, site: str, command_id: str,
                         request: Request,
                         p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p, need=_OPERATE)
    async with org_tx(request, org_id) as tc:
        cmd = await st(request).commands.get_v2(
            tc, _uuid_or_404(command_id, "command"), site_id)
    if cmd is None:
        raise HTTPException(404, "command not found")
    return {"command": cmd}


@app.get("/api/v1/orgs/{org}/sites/{site}/health")
async def v2_site_health(org: str, site: str, request: Request,
                         p: Principal = Depends(require_user)):
    """Site liveness rollup: edges of THIS site only + shared substrate
    status (broker/db). The tracked edge heartbeat stays a v1-shim signal
    on /api/system/health — per-site health is the edge rows themselves."""
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    s = st(request)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, name, status, last_hb_at, clock_ok, buffer_depth"
            " FROM edges WHERE site_id=$1 ORDER BY name", site_id)
        db_ok = await tc.fetchval("SELECT 1") == 1
    return {"edges": [{"id": str(r["id"]), "name": r["name"],
                       "status": r["status"],
                       "last_hb": iso_z(r["last_hb_at"])
                                 if r["last_hb_at"] else None,
                       "clock_ok": r["clock_ok"],
                       "buffer_depth": r["buffer_depth"]} for r in rows],
            "mqtt": "up" if s.mqtt.connected else "down",
            "db": "up" if db_ok else "down"}


@app.get("/api/v1/orgs/{org}/sites/{site}/edges")
async def list_edges(org: str, site: str, request: Request,
                     p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p)
    await _site_or_404(st(request).pools, org_id, site_id)
    async with tenant_tx(st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, org_id, site_id, name, status, mqtt_username,"
            " credential_version, last_hb_at, clock_ok, adapter FROM edges"
            " WHERE site_id=$1 ORDER BY name", site_id)
        latest = await tc.fetch(
            "SELECT DISTINCT ON (edge_id) edge_id, secret_issued"
            " FROM edge_identities ORDER BY edge_id, version DESC")
    latest_by_edge = {r["edge_id"]: r for r in latest}
    return {"items": [_edge_json(r, latest_by_edge.get(r["id"])) for r in rows]}


@app.post("/api/v1/orgs/{org}/sites/{site}/edges", status_code=201)
async def provision_edge(org: str, site: str, body: EdgeIn, request: Request,
                         p: Principal = Depends(require_user)):
    """Provision an edge + its first MQTT credential (doc 17 §5).

    Order matters: the broker client is created BEFORE the rows commit —
    if the DB write fails, the stray client is an orphan the reconciler
    disables, never a half-live credential. The secret is returned ONCE;
    the DB stores only its sha256 fingerprint."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _site_or_404(st(request).pools, org_id, site_id)
    await _mutation_gate(request, p.user_id)
    async with tenant_tx(st(request).pools.app, org_id) as tc:
        cap = await tc.fetchval(
            "SELECT (plan_limits->>'max_edges')::int FROM organizations"
            " WHERE id=$1", org_id)
        # Disabled edges don't consume plan slots — with delete deferred
        # (doc 17 §8) there is no re-enable path, so disabled is terminal
        # and counting it would turn the cap into an unrecoverable wall.
        n_edges = await tc.fetchval(
            "SELECT count(*) FROM edges WHERE org_id=$1"
            " AND status<>'disabled'", org_id)
    if cap is not None and n_edges >= cap:
        raise HTTPException(403, "plan_limit_exceeded: max_edges")
    eid = uuid.uuid4()
    version = 1
    username = edge_client_name(eid, version)
    secret = new_secret()
    fp = fingerprint(secret)
    try:
        await st(request).dynsec.ensure_role(
            edge_role_name(eid), edge_acls(org_id, site_id, eid))
        await st(request).dynsec.create_client(username, secret, edge_role_name(eid))
    except DynsecError as exc:
        log.warning("edge provisioning failed at broker", extra={"error": str(exc)})
        return JSONResponse(status_code=503, content={"detail": "provisioning_failed"})
    async with tenant_tx(st(request).pools.app, org_id, p.user_id) as tc:
        await tc.execute(
            "INSERT INTO edges(id, org_id, site_id, name, status, mqtt_username,"
            " credential_version, credential_fingerprint)"
            " VALUES ($1,$2,$3,$4,'active',$5,1,$6)",
            eid, org_id, site_id, body.name, username, fp)
        await tc.execute(
            "INSERT INTO edge_identities(org_id, edge_id, version, username,"
            " fingerprint, status, secret_issued) VALUES ($1,$2,$3,$4,$5,'active',true)",
            org_id, eid, version, username, fp)
        await audit.append(tc, f"user:{p.user_id}", "edge.provisioned",
                           {"edge_id": str(eid), "username": username},
                           {"name": body.name})
        await tc.execute("SELECT pg_notify('wds_edges', $1)", str(eid))
    await st(request).registry.refresh()
    edge = {"id": str(eid), "org_id": str(org_id), "site_id": str(site_id),
            "name": body.name, "status": "active", "mqtt_username": username,
            "credential_version": version, "needs_rotation": False}
    return {"edge": edge, "secret": secret}


@app.post("/api/v1/orgs/{org}/sites/{site}/edges/{edge_id}/rotate")
async def rotate_edge(org: str, site: str, edge_id: str, request: Request,
                      p: Principal = Depends(require_user)):
    """Rotate the edge credential (doc 17 §5): new client edge-{e}-v{n+1} on
    the same role; the old one keeps a grace window or is disabled at
    cut-over — the reconciler owns the retirement."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    eid = _uuid_or_404(edge_id, "edge")
    async with tenant_tx(st(request).pools.app, org_id) as tc:
        edge = await tc.fetchrow(
            "SELECT id, status FROM edges WHERE id=$1 AND site_id=$2", eid, site_id)
        if edge is None:
            raise HTTPException(404, "edge not found")
        if edge["status"] != "active":
            raise HTTPException(409, "edge_not_active")
        maxv = await tc.fetchval(
            "SELECT max(version) FROM edge_identities WHERE edge_id=$1", eid) or 0
    version = int(maxv) + 1
    username = edge_client_name(eid, version)
    secret = new_secret()
    fp = fingerprint(secret)
    try:
        await st(request).dynsec.ensure_role(
            edge_role_name(eid), edge_acls(org_id, site_id, eid))
        await st(request).dynsec.create_client(username, secret, edge_role_name(eid))
    except DynsecError as exc:
        log.warning("edge rotation failed at broker", extra={"error": str(exc)})
        return JSONResponse(status_code=503, content={"detail": "provisioning_failed"})
    async with tenant_tx(st(request).pools.app, org_id, p.user_id) as tc:
        # current credential -> grace: stays enabled until cut-over or the
        # grace deadline, whichever the reconciler sees first (doc 17 §5)
        await tc.execute(
            "UPDATE edge_identities SET status='grace', rotated_at=now(),"
            " grace_until=now() + $2::int * interval '1 second'"
            " WHERE edge_id=$1 AND status='active'",
            eid, int(config.EDGE_CRED_GRACE_S))
        await tc.execute(
            "INSERT INTO edge_identities(org_id, edge_id, version, username,"
            " fingerprint, status, secret_issued) VALUES ($1,$2,$3,$4,$5,'active',true)",
            org_id, eid, version, username, fp)
        await tc.execute(
            "UPDATE edges SET credential_version=$2, mqtt_username=$3,"
            " credential_fingerprint=$4 WHERE id=$1",
            eid, version, username, fp)
        await audit.append(tc, f"user:{p.user_id}", "edge.rotated",
                           {"edge_id": str(eid), "username": username},
                           {"credential_version": version})
        await tc.execute("SELECT pg_notify('wds_edges', $1)", str(eid))
    await st(request).registry.refresh()
    return {"edge_id": str(eid), "credential_version": version,
            "mqtt_username": username, "secret": secret,
            "grace_s": int(config.EDGE_CRED_GRACE_S)}


@app.post("/api/v1/orgs/{org}/sites/{site}/edges/{edge_id}/disable")
async def disable_edge(org: str, site: str, edge_id: str, request: Request,
                       p: Principal = Depends(require_user)):
    """Disable the edge: every credential version is disabled at the broker
    (dynsec kicks the live connection immediately — doc 17 §5)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    eid = _uuid_or_404(edge_id, "edge")
    async with tenant_tx(st(request).pools.app, org_id, p.user_id) as tc:
        edge = await tc.fetchrow(
            "SELECT id, status FROM edges WHERE id=$1 AND site_id=$2", eid, site_id)
        if edge is None:
            raise HTTPException(404, "edge not found")
        usernames = [r["username"] for r in await tc.fetch(
            "UPDATE edge_identities SET status='disabled'"
            " WHERE edge_id=$1 AND status<>'disabled' RETURNING username", eid)]
        await tc.execute("UPDATE edges SET status='disabled' WHERE id=$1", eid)
        await audit.append(tc, f"user:{p.user_id}", "edge.disabled",
                           {"edge_id": str(eid)}, None)
        await tc.execute("SELECT pg_notify('wds_edges', $1)", str(eid))
    # kick now — the reconcile tick would eventually agree, but an incident-
    # response disable must not wait (doc 17 §5: kicked immediately)
    for username in usernames:
        with contextlib.suppress(DynsecError):
            await st(request).dynsec.disable_client(username)
    await st(request).registry.refresh()
    return {"edge_id": str(eid), "status": "disabled"}


# ---------------------------------------------------------------------------
# v2 admin (v4 T10, CONTRACT.v2 §3): alarm-rule CRUD, memberships, invites,
# audit export.
#
# Permission mapping (CONTRACT.v2 §1 table): config:write, member:manage and
# audit:read ALL sit in the admin|owner band — the _CONFIG check is the same
# gate for each. Operators get read access where the table allows
# (alarm-rules list is site:read) and a flat 403 on mutations.
# ---------------------------------------------------------------------------
MEMBER_ROLES = frozenset({"owner", "admin", "operator", "viewer"})
INVITABLE_ROLES = frozenset({"admin", "operator", "viewer"})  # schema CHECK
RULE_KINDS = frozenset({"hi", "hihi", "lo", "lolo", "stale"})
RULE_SEVERITIES = frozenset({"info", "warning", "critical"})
INVITE_TTL_D = 7
MEMBER_LIST_MAX = 5000  # T10-review F9 — same bound as the audit export


class AlarmRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tag_id: str
    kind: str
    threshold: float | None = None
    stale_s: int | None = None
    deadband: float = Field(default=0, ge=0)
    severity: str
    enabled: bool = True


class AlarmRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    threshold: float | None = None
    stale_s: int | None = None
    deadband: float | None = Field(default=None, ge=0)
    severity: str | None = None
    enabled: bool | None = None


class MemberPatch(BaseModel):
    role: str | None = None
    disabled: bool | None = None


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: str

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("invalid email")
        return v


class InviteAcceptIn(BaseModel):
    # T10-review F1: the token travels in the body, never the URL path —
    # a path token lands in access logs and proxy traces.
    token: str = Field(min_length=1, max_length=128)


def _validate_rule(kind: str, threshold, stale_s, severity: str,
                   deadband: float) -> None:
    """Mirror the alarm_rules CHECK constraints in request terms (400, not a
    500 from a violated CHECK)."""
    if kind not in RULE_KINDS:
        raise HTTPException(400, "invalid_request: kind")
    if severity not in RULE_SEVERITIES:
        raise HTTPException(400, "invalid_request: severity")
    if deadband is not None and deadband < 0:
        raise HTTPException(400, "invalid_request: deadband")
    if kind == "stale":
        if stale_s is None or not (5 <= stale_s <= 86400):
            raise HTTPException(400, "invalid_request: stale rule needs stale_s 5..86400")
    elif threshold is None:
        raise HTTPException(400, "invalid_request: threshold rule needs a threshold")


def _rule_json(r) -> dict:
    return {"id": str(r["id"]), "tag_id": str(r["tag_id"]), "name": r["name"],
            "kind": r["kind"], "threshold": r["threshold"],
            "stale_s": r["stale_s"], "deadband": r["deadband"],
            "severity": r["severity"], "enabled": r["enabled"]}


def _row_to_rule(row, org_id: UUID) -> Rule:
    """_RULE_COLS row -> engine Rule (the row carries `enabled`, which the
    engine dataclass does not)."""
    d = {k: v for k, v in dict(row).items() if k != "enabled"}
    return Rule(org_id=org_id, **d)


_RULE_COLS = ("id, tag_id, name, kind, threshold, stale_s, deadband,"
              " severity, enabled")


async def _rule_or_404(tc, rule_id: str, site_id: UUID):
    """Rule resolved inside the path site — a foreign-site rule id is 404,
    never a cross-tenant leak (same oracle rule as _v2_tag_or_404)."""
    try:
        rid = UUID(rule_id)
    except ValueError:
        raise HTTPException(404, "alarm rule not found") from None
    row = await tc.fetchrow(
        f"SELECT {_RULE_COLS} FROM alarm_rules WHERE id=$1"
        " AND tag_id IN (SELECT id FROM tags WHERE site_id=$2)", rid, site_id)
    if row is None:
        raise HTTPException(404, "alarm rule not found")
    return row


@app.post("/api/v1/orgs/{org}/sites/{site}/alarm-rules", status_code=201)
async def v2_create_alarm_rule(org: str, site: str, body: AlarmRuleIn,
                               request: Request,
                               p: Principal = Depends(require_user)):
    """config:write in the path org. NOTIFYs alarm_rules_changed so the
    engine reloads its rule set without a restart (v4 T10)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _site_or_404(st(request).pools, org_id, site_id)
    tag = await _v2_tag_or_404(request, org_id, site_id, body.tag_id)
    _validate_rule(body.kind, body.threshold, body.stale_s,
                   body.severity, body.deadband)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                f"INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold,"
                " stale_s, deadband, severity, enabled)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING " + _RULE_COLS,
                org_id, tag.id, body.name, body.kind, body.threshold,
                body.stale_s, body.deadband, body.severity, body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "alarm rule name already exists on this tag")
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.created",
                           {"rule_id": str(row["id"]), "tag_id": str(tag.id)},
                           {"name": body.name, "kind": body.kind})
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return {"rule": _rule_json(row)}


@app.patch("/api/v1/orgs/{org}/sites/{site}/alarm-rules/{rule_id}")
async def v2_patch_alarm_rule(org: str, site: str, rule_id: str,
                              body: AlarmRulePatch, request: Request,
                              p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "invalid_request: empty patch")
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _rule_or_404(tc, rule_id, site_id)
        merged = {
            "name": changes.get("name", cur["name"]),
            "kind": changes.get("kind", cur["kind"]),
            "threshold": changes.get("threshold", cur["threshold"]),
            "stale_s": changes.get("stale_s", cur["stale_s"]),
            "deadband": changes.get("deadband", cur["deadband"]),
            "severity": changes.get("severity", cur["severity"]),
            "enabled": changes.get("enabled", cur["enabled"]),
        }
        _validate_rule(merged["kind"], merged["threshold"], merged["stale_s"],
                       merged["severity"], merged["deadband"])
        try:
            row = await tc.fetchrow(
                "UPDATE alarm_rules SET name=$2, kind=$3, threshold=$4, stale_s=$5,"
                " deadband=$6, severity=$7, enabled=$8 WHERE id=$1"
                " RETURNING " + _RULE_COLS,
                cur["id"], merged["name"], merged["kind"], merged["threshold"],
                merged["stale_s"], merged["deadband"], merged["severity"],
                merged["enabled"])
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "alarm rule name already exists on this tag")
        if merged["enabled"] is False:
            # T10-review F6: a disabled rule can never evaluate-clear again —
            # resolve its open alarms now, through the engine's close path.
            await st(request).alarms.close_for_rule(
                tc, _row_to_rule(row, org_id))
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.updated",
                           {"rule_id": str(cur["id"])}, changes)
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return {"rule": _rule_json(row)}


@app.delete("/api/v1/orgs/{org}/sites/{site}/alarm-rules/{rule_id}",
            status_code=204)
async def v2_delete_alarm_rule(org: str, site: str, rule_id: str,
                               request: Request,
                               p: Principal = Depends(require_user)):
    """Deletes the rule; its alarms cascade away with it (schema FK)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _rule_or_404(tc, rule_id, site_id)
        # T10-review F6: resolve open alarms BEFORE the row disappears —
        # _clear's serialize joins alarm_rules for the broadcast payload.
        await st(request).alarms.close_for_rule(
            tc, _row_to_rule(cur, org_id))
        await tc.execute("DELETE FROM alarm_rules WHERE id=$1", cur["id"])
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.deleted",
                           {"rule_id": str(cur["id"])},
                           {"name": cur["name"]})
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Memberships — member:manage (admin|owner)
# ---------------------------------------------------------------------------
def _member_json(r) -> dict:
    return {"user_id": str(r["user_id"]), "role": r["role"],
            "sub": r["sub"], "display_name": r["display_name"],
            "email": r["email"],
            "disabled": r["disabled_at"] is not None}


async def _membership_or_404(tc, user_id: str):
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(404, "member not found") from None
    row = await tc.fetchrow(
        "SELECT m.user_id, m.role, u.sub, u.display_name, u.email, u.disabled_at"
        " FROM memberships m JOIN users u ON u.id = m.user_id"
        " WHERE m.user_id=$1", uid)
    if row is None:
        raise HTTPException(404, "member not found")
    return row


@app.get("/api/v1/orgs/{org}/members")
async def v2_list_members(org: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT m.user_id, m.role, u.sub, u.display_name, u.email,"
            " u.disabled_at FROM memberships m JOIN users u ON u.id = m.user_id"
            " ORDER BY u.display_name LIMIT $1", MEMBER_LIST_MAX)
    return {"items": [_member_json(r) for r in rows], "next_cursor": None}


@app.patch("/api/v1/orgs/{org}/members/{user_id}")
async def v2_patch_member(org: str, user_id: str, body: MemberPatch,
                          request: Request,
                          p: Principal = Depends(require_user)):
    """Role change and/or user disable (CONTRACT.v2 §3 member:manage).

    Guards: an admin cannot touch an owner row (demote OR disable), nobody
    can demote the last owner, and only an owner can grant 'owner'. A
    membership change NOTIFYs wds_authz so the ≤5s revocation path applies.
    """
    org_id = _v2_org(org, p, need=_CONFIG)
    if body.role is None and body.disabled is None:
        raise HTTPException(400, "invalid_request: empty patch")
    if body.role is not None and body.role not in MEMBER_ROLES:
        raise HTTPException(400, "invalid_request: role")
    caller_role = _effective_org_roles(p)[org_id]
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        target = await _membership_or_404(tc, user_id)
        if target["user_id"] == p.user_id and (
                body.disabled or (body.role and body.role != target["role"])):
            raise HTTPException(400, "cannot change your own role or disable yourself")
        if caller_role != "owner":
            # an admin may not demote/disable an owner, nor mint a new one
            if target["role"] == "owner" or body.role == "owner":
                raise ForbiddenError("owner rows are managed by owners")
        if body.role is not None and target["role"] == "owner" \
                and body.role != "owner":
            owners = await tc.fetchval(
                "SELECT count(*) FROM memberships WHERE role='owner'")
            if owners <= 1:
                raise HTTPException(409, "org must keep at least one owner")
        if body.role is not None and body.role != target["role"]:
            await tc.execute(
                "UPDATE memberships SET role=$2 WHERE user_id=$1",
                target["user_id"], body.role)
        if body.disabled is not None:
            if body.disabled and target["role"] == "owner":
                owners_active = await tc.fetchval(
                    "SELECT count(*) FROM memberships m JOIN users u"
                    " ON u.id=m.user_id WHERE m.role='owner'"
                    " AND u.disabled_at IS NULL")
                if owners_active <= 1:
                    raise HTTPException(409, "org must keep at least one active owner")
            await tc.execute(
                "UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END"
                " WHERE id=$1", target["user_id"], body.disabled)
        await audit.append(tc, f"user:{p.user_id}", "member.updated",
                           {"user_id": str(target["user_id"])},
                           body.model_dump(exclude_unset=True))
    # local eviction now, NOTIFY for other replicas/listeners (same pattern
    # as Security.record_logout — no need to wait the listener round-trip)
    st(request).auth.on_notify(json.dumps(
        {"type": "user_disabled" if body.disabled else "membership_changed",
         "sub": target["sub"]}))
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "user_disabled" if body.disabled
                        else "membership_changed", "sub": target["sub"]}))
    async with org_tx(request, org_id) as tc:
        row = await _membership_or_404(tc, str(target["user_id"]))
    return {"member": _member_json(row)}


@app.delete("/api/v1/orgs/{org}/members/{user_id}")
async def v2_delete_member(org: str, user_id: str, request: Request,
                           p: Principal = Depends(require_user)):
    """Remove the membership. The user row survives — it is global and may
    hold memberships elsewhere; this revokes THIS org only (wds_authz)."""
    org_id = _v2_org(org, p, need=_CONFIG)
    caller_role = _effective_org_roles(p)[org_id]
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        target = await _membership_or_404(tc, user_id)
        if target["user_id"] == p.user_id and target["role"] == "owner":
            raise HTTPException(400, "an owner cannot remove themselves")
        if caller_role != "owner" and target["role"] == "owner":
            raise ForbiddenError("owner rows are managed by owners")
        if target["role"] == "owner":
            owners = await tc.fetchval(
                "SELECT count(*) FROM memberships WHERE role='owner'")
            if owners <= 1:
                raise HTTPException(409, "org must keep at least one owner")
        await tc.execute("DELETE FROM memberships WHERE user_id=$1",
                         target["user_id"])
        await audit.append(tc, f"user:{p.user_id}", "member.removed",
                           {"user_id": str(target["user_id"])},
                           {"role": target["role"]})
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "membership_changed", "sub": target["sub"]}))
    return {"user_id": str(target["user_id"]), "removed": True}


# ---------------------------------------------------------------------------
# Invites — member:manage; accept is a global route (CONTRACT.v2 §3 identity)
# ---------------------------------------------------------------------------
def _invite_json(r) -> dict:
    return {"id": str(r["id"]), "email": r["email"], "role": r["role"],
            "expires_at": iso_z(r["expires_at"]),
            "accepted_at": iso_z(r["accepted_at"]) if r["accepted_at"] else None}


@app.get("/api/v1/orgs/{org}/invites")
async def v2_list_invites(org: str, request: Request,
                          p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, email, role, expires_at, accepted_at FROM invites"
            " ORDER BY created_at DESC LIMIT 200")
    return {"items": [_invite_json(r) for r in rows], "next_cursor": None}


@app.post("/api/v1/orgs/{org}/invites", status_code=201)
async def v2_create_invite(org: str, body: InviteIn, request: Request,
                           p: Principal = Depends(require_user)):
    """Mint an invite; the raw token is returned ONCE and only its sha256 is
    stored (CONTRACT.v2 §3: 32 random bytes, single-use, 7-day expiry)."""
    org_id = _v2_org(org, p, need=_CONFIG)
    if body.role not in INVITABLE_ROLES:
        raise HTTPException(400, "invalid_request: role")
    await _mutation_gate(request, p.user_id)
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    iid = uuid.uuid4()
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO invites(id, org_id, email, role, token_hash, invited_by,"
            " expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + $7::int * interval '1 day')"
            " RETURNING id, email, role, expires_at, accepted_at",
            iid, org_id, body.email, body.role, token_hash, p.user_id,
            INVITE_TTL_D)
        await audit.append(tc, f"user:{p.user_id}", "invite.created",
                           {"invite_id": str(iid)},
                           {"email": body.email, "role": body.role})
    return {"invite": _invite_json(row), "token": token}


@app.delete("/api/v1/orgs/{org}/invites/{invite_id}")
async def v2_revoke_invite(org: str, invite_id: str, request: Request,
                           p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    iid = _uuid_or_404(invite_id, "invite")
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "DELETE FROM invites WHERE id=$1 AND accepted_at IS NULL"
            " RETURNING id, email", iid)
        if row is None:
            raise HTTPException(404, "invite not found")
        await audit.append(tc, f"user:{p.user_id}", "invite.revoked",
                           {"invite_id": str(iid)}, {"email": row["email"]})
    return {"id": str(iid), "revoked": True}


@app.post("/api/v1/invites/accept")
async def v2_accept_invite(body: InviteAcceptIn, request: Request,
                           p: Principal = Depends(require_user)):
    """Accept an invite (CONTRACT.v2 §3): the token resolves to exactly one
    invite via the invite_hash RLS context; the caller's VERIFIED email must
    match the invite email. Single-use — accepted/expired/unknown all 404 so
    the endpoint is not an existence oracle."""
    if len(body.token) != 64:
        raise HTTPException(404, "invite not found")
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    await _mutation_gate(request, p.user_id)
    async with invite_tx(st(request).pools.app, token_hash) as conn:
        invite = await conn.fetchrow(
            "SELECT id, org_id, email, role, expires_at, accepted_at"
            " FROM invites")
    if invite is None or invite["accepted_at"] is not None \
            or invite["expires_at"] <= utcnow():
        raise HTTPException(404, "invite not found")
    async with global_tx(st(request).pools.app) as conn:
        user = await conn.fetchrow(
            "SELECT email, email_verified, disabled_at FROM users WHERE id=$1",
            p.user_id)
    if user is None or user["disabled_at"] is not None:
        raise ForbiddenError("account cannot accept invites")
    if not user["email_verified"] or (user["email"] or "").lower() \
            != invite["email"].lower():
        raise ForbiddenError("invite email does not match your verified email")
    async with tenant_tx(st(request).pools.app, invite["org_id"], p.user_id) as tc:
        # T10-review F2: the single-use claim is the row UPDATE itself —
        # a racing second accept gets UPDATE 0 → 404, not a double-write.
        n = await tc.execute(
            "UPDATE invites SET accepted_at=now(), accepted_by=$2"
            " WHERE id=$1 AND accepted_at IS NULL", invite["id"], p.user_id)
        if n == "UPDATE 0":
            raise HTTPException(404, "invite not found")
        # T10-review F3: an EXISTING member keeps their current role — the
        # invite only confirms membership. A blind upsert would let an admin
        # demote (e.g.) the last owner by inviting their email.
        cur = await tc.fetchrow(
            "SELECT role FROM memberships WHERE user_id=$1", p.user_id)
        if cur is None:
            await tc.execute(
                "INSERT INTO memberships(org_id, user_id, role)"
                " VALUES ($1,$2,$3)", invite["org_id"], p.user_id,
                invite["role"])
        await audit.append(tc, f"user:{p.user_id}", "invite.accepted",
                           {"invite_id": str(invite["id"])},
                           {"role": invite["role"],
                            "membership": "created" if cur is None
                            else "existing"})
    async with global_tx(st(request).pools.app) as conn:
        await conn.execute(
            "SELECT pg_notify($1, $2)", "wds_authz",
            json.dumps({"type": "membership_changed", "sub": p.sub}))
    return {"status": "accepted", "org_id": str(invite["org_id"]),
            "role": invite["role"] if cur is None else cur["role"]}


# ---------------------------------------------------------------------------
# Audit export — audit:read (admin|owner), bounded
# ---------------------------------------------------------------------------
AUDIT_EXPORT_MAX = 5000


@app.get("/api/v1/orgs/{org}/audit")
async def v2_audit_export(org: str, request: Request,
                          from_: str | None = Query(None, alias="from"),
                          to: str | None = Query(None),
                          action: str | None = Query(None),
                          actor: str | None = Query(None),
                          format: str = Query("json"),
                          limit: int = Query(500, ge=1, le=AUDIT_EXPORT_MAX),
                          p: Principal = Depends(require_user)):
    """Tenant-scoped audit export (CONTRACT.v2 §3): the hash-chained log for
    THIS org only — RLS makes cross-tenant reads structurally impossible."""
    org_id = _v2_org(org, p, need=_CONFIG)
    if format not in ("json", "csv"):
        raise HTTPException(400, "invalid_request: format")
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, org_id) as tc:
        rows = await tc.fetch(
            "SELECT seq, at, actor, action, target, detail, hash FROM audit_log"
            " WHERE ($1::timestamptz IS NULL OR at >= $1)"
            " AND ($2::timestamptz IS NULL OR at <= $2)"
            " AND ($3::text IS NULL OR action = $3)"
            " AND ($4::text IS NULL OR actor = $4)"
            " ORDER BY seq ASC LIMIT $5",
            t_from, t_to, action, actor, limit)
    items = [{"seq": r["seq"], "at": iso_z(r["at"]), "actor": r["actor"],
              "action": r["action"], "target": r["target"],
              "detail": r["detail"], "hash": r["hash"]} for r in rows]
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["seq", "at", "actor", "action", "target", "detail", "hash"])
        for it in items:
            w.writerow([it["seq"], it["at"], it["actor"], it["action"],
                        json.dumps(it["target"], separators=(",", ":"))
                        if it["target"] is not None else "",
                        json.dumps(it["detail"], separators=(",", ":"))
                        if it["detail"] is not None else "",
                        it["hash"]])
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition":
                     f'attachment; filename="audit-{org_id}.csv"'})
    return {"items": items, "next_cursor": None}


# ---------------------------------------------------------------------------
# WebSocket (v1)
# ---------------------------------------------------------------------------
# _trusted_peer/_client_ip live in app.observability (v4 T8) — same code the
# access-log middleware uses to compute the request's IP field.
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


@app.websocket("/ws")      # v1 compat shim — pins the seeded org's site
@app.websocket("/ws/v1")   # CONTRACT.v2 §5 — auth frame MUST carry site_id
async def ws_endpoint(ws: WebSocket):
    # First-frame auth (v4 T3): the token rides in the first client frame —
    # {"type":"auth","token":"…","site_id":"…"} — never ?token= in the URL,
    # which leaked into access logs and proxy traces.
    #
    # v4 T9 (CONTRACT.v2 §5): site_id selects the site's org; the org must be
    # one of the principal's memberships or the socket closes 4403 — the same
    # indistinguishable response for "site doesn't exist" and "site belongs
    # to an org you aren't in". The v1 `/ws` alias defaults site_id to the
    # seeded site, so a member of a non-shim org alone gets 4403 there —
    # same as require_principal on /api/* (shim = shim only).
    #
    # v4 T5: anonymous connections are gone. Absent/unresolvable token ->
    # 4401; authenticated but not a member anywhere -> 4403.
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
            frame = await read_auth_frame(ws)
            p = await ws.app.state.st.auth.authenticate(frame["token"] or None)
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
        # --- site selection (v4 T9, CONTRACT.v2 §5) -------------------------
        v2 = ws.url.path == "/ws/v1"
        site_s = frame["site_id"]
        if site_s is None:
            if v2:
                # v2 auth frames must select a site — a missing site_id is a
                # malformed auth frame, not an authorization failure.
                log.info("ws /ws/v1 auth frame without site_id — closing 4401")
                with contextlib.suppress(Exception):
                    await ws.close(code=4401)
                return
            site_id = config.V1_SITE_ID  # v1 shim: seeded site implicitly
        else:
            try:
                site_id = UUID(site_s)
            except ValueError:
                with contextlib.suppress(Exception):
                    await ws.close(code=4403)
                return
        st_ = ws.app.state.st
        await st_.registry.maybe_refresh()
        org_id = st_.registry.site_org(site_id)
        if org_id is None:                      # cold cache — retry once
            await st_.registry.refresh()
            org_id = st_.registry.site_org(site_id)
        roles = _effective_org_roles(p)
        # site:read — org of the selected site must be one of the caller's.
        # Unknown site and wrong-org site close identically (no oracle).
        if org_id is None or org_id not in roles:
            log.info("ws site not visible to principal — closing 4403",
                     extra={"site": str(site_id)})
            with contextlib.suppress(Exception):
                await ws.close(code=4403)
            return
        client = await manager.connect(ws, roles[org_id], sub=p.sub, sid=p.sid,
                                       org_id=org_id, org_roles=roles,
                                       user_id=p.user_id)
        pump: asyncio.Task | None = None
        exp_task: asyncio.Task | None = None
        if p.exp:
            exp_task = asyncio.create_task(_close_at_exp(client, p.exp))
        try:
            pump = asyncio.create_task(manager.pump(client))
            if org_id == config.V1_ORG_ID:
                # the tracked health edge belongs to the shim org — don't
                # leak its state onto another tenant's socket
                with contextlib.suppress(asyncio.QueueFull):
                    client.queue.put_nowait(st_.health_event())
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
