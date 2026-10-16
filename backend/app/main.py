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
import base64
import contextlib
import json
import logging
import math
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from .core import config
from .iam import consents, orgguard
from .edge import credpush, edgelogs, enroll_codes
from .production import eventsfeed, statuspage, tagquery
from .alarming import inference, notify
from .tenancy import onboarding, orgapi, orgs as orgs_mod, plans, platform as platform_api, workers
from .alarming.alarms import AlarmEngine, RULES_NOTIFY_CHANNEL, Rule, rules_notify_listener
from .iam.auth import OPERATOR_ROLES, Principal
from .edge.commands import CommandManager
from .edge.dynsec import (
    DynsecAdmin,
    DynsecError,
    Reconciler,
    edge_acls,
    edge_client_name,
    edge_role_name,
    fingerprint,
    new_secret,
)
from .alarming.insights import INSIGHT_KINDS, InsightEngine
from .db import audit
from .datasources.publisher import CfgPublisher, parse_cfg_req
from .datasources.routes import router as datasources_router, tags_notify_listener
from .vision import stream as vision_stream
from .vision import models as vision_models
from .vision.cameras import router as cameras_router
from .vision.classes import router as classes_router
from .vision import events as vision_events
from .vision.events import router as vision_events_router
from .vision.rules import router as vision_rules_router
from .vision.external import router as vision_external_router
from .vision.material import router as material_router
from .artifacts import router as artifacts_router
from .vision.models import router as models_router
from .vision.relay import FrameRelay
from .vision.stream import router as stream_router
from .vision.videos import router as videos_router
from .plant.routes import router as plant_router
from .db.context import global_tx, invite_tx, tenant_tx, user_tx
from .db.pool import Pools, create_pools
from .db.util import finite_or_none, iso_z, parse_ts, utcnow
from .edge.mqtt_client import MQTTBridge
from .production.oee import router as oee_router, downtime_sweep
from .production.reports import router as reports_router, report_sweep
from .core.observability import (
    ObservabilityMiddleware,
    _client_ip,
    metrics_response,
    migration_at_head,
    RUNTIME,
)
from .core.ratelimit import RateLimiter
from .edge.registry import Registry
from .iam.security import (
    API_KEY_PREFIX,
    AuthError,
    ForbiddenError,
    Security,
    authz_listener,
    authz_sweep,
)
from .ops.seed import seed
from .deps import (
    CONFIG_ROLES,
    Scope,
    _CONFIG,
    _OPERATE,
    _READ,
    _authenticate,
    _effective_org_roles,
    _mutation_gate,
    _scope,
    _site_or_404,
    _uuid_or_404,
    _v2_org,
    _v2_scope,
    _v2_tag_or_404,
    org_tx,
    require_authenticated,
    require_operator,
    require_principal,
    require_user,
    st,
    v1_operate,
    v1_read,
    v1_tx,
)
from .api import routers as api_routers
from .edge.ws import OriginGuardMiddleware, WSManager, WSAuthError, origin_allowed, read_auth_frame

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
        # unauthenticated enroll endpoint: tight per-IP bucket (code guessing)
        self.enroll_limiter = RateLimiter(config.RATE_ENROLL_PER_IP,
                                          config.RATE_ENROLL_WINDOW_S)
        self.commands = CommandManager(pools, self.ws, self.mqtt, self.registry,
                                       cmd_limiter=self.cmd_limiter)
        self.alarms = AlarmEngine(pools, self.ws, self.registry)
        self.cfgpub = CfgPublisher(pools, self.mqtt, self.registry)
        self.relay = FrameRelay(vision_stream.cameras_lookup(pools))
        self.insights = InsightEngine(pools, self.ws, self.registry)
        self.auth = Security(pools, self.ws)  # v4 T5 — OIDC verify + authz
        self.history_buf: list[tuple] = []
        self.edge = {"last_rx": None, "last_heartbeat_ts": None, "clock_ok": None,
                     "adapter": None}
        self.counters = new_ingest_counters()
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
def new_ingest_counters() -> dict:
    return {"telemetry_unknown_tag": 0, "telemetry_bad_payload": 0,
            "telemetry_future_ts": 0, "telemetry_too_old": 0,
            # doc 17 §4 — security events, counted + logged
            "mqtt_topic_identity_mismatch": 0,
            "mqtt_bad_topic": 0,
            "cfg_bad_payload": 0}


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
    if kind in ("cfg-req", "cfg-ack") and len(parts) == 5:
        return await _handle_cfg(st, msg, edge, kind)
    if kind == "vision" and len(parts) == 7 and parts[5] == "frame":
        return await vision_stream.handle_frame(st, msg, edge, parts[6])
    if kind == "vision" and len(parts) == 6 and parts[5] == "stat":
        return await vision_stream.handle_stat(st, msg, edge)
    if kind == "vision" and len(parts) == 6 and parts[5] == "caps":
        return await vision_stream.handle_caps(st, msg, edge)
    if kind == "vision" and len(parts) == 6 and parts[5] == "event":
        return await vision_events.handle_event(st, msg, edge)
    if kind == "vision" and len(parts) == 6 and parts[5] == "audit":
        return await vision_events.handle_audit(st, msg, edge)
    if kind == "vision" and len(parts) == 6 and parts[5] == "count":
        return await vision_events.handle_count(st, msg, edge)
    if kind == "logs" and len(parts) == 5:
        return await edgelogs.ingest_edge_log(
            st, org_id, site_id, edge_id, msg.payload)
    if kind == "cmd-resp" and len(parts) == 6:
        return _handle_cmd_resp(st, msg, org_id, edge_id)
    if kind == "tele" and len(parts) >= 6:
        return await _handle_telemetry(st, msg, edge, "/".join(parts[5:]))
    return _count(st, "mqtt_bad_topic", "unrecognized v2 subtree — dropped",
                  topic=msg.topic)


async def _handle_cfg(st: State, msg, edge, kind: str) -> None:
    try:
        payload = json.loads(msg.payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _count(st, "cfg_bad_payload", f"bad {kind} payload", topic=msg.topic)
    if kind == "cfg-req":
        valid, have = parse_cfg_req(payload)
        if not valid:
            return _count(st, "cfg_bad_payload", "bad cfg-req payload", topic=msg.topic)
        return await st.cfgpub.on_request(edge, have)
    await st.cfgpub.on_ack(edge, payload)


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
    # edge ops (test_source/browse) answer here, before any commands-table lookup
    if st.commands.resolve_op(cid, edge_id, payload):
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
        # per-org plan retention replaces the single global window (6.2)
        asyncio.create_task(_every(config.HISTORY_PRUNE_S,
                                   lambda: plans.retention_prune(st.pools),
                                   "retention prune")),
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
        # wds_tags NOTIFY -> registry refresh on data-source/tag CRUD (spec 5.6)
        asyncio.create_task(tags_notify_listener(st.registry, st.pools)),
        # wds_cfg NOTIFY -> push edge config over MQTT (spec 5.4)
        asyncio.create_task(st.cfgpub.start()),
        # converter spool -> model versions (plan M1-04)
        asyncio.create_task(vision_models.ingest_loop(pools)),
        # notifications: delivery retries, escalation, shelf expiry, vision alarms
        asyncio.create_task(_every(config.NOTIFY_POLL_S, lambda: notify.notify_jobs_worker(st),
                                   "notify jobs")),
        asyncio.create_task(_every(config.ESCALATE_SWEEP_S, lambda: notify.escalate_sweep(st),
                                   "escalation sweep")),
        asyncio.create_task(_every(config.SHELVE_SWEEP_S, lambda: notify.shelve_sweep(st),
                                   "shelve sweep")),
        asyncio.create_task(_every(config.VISION_ALARM_SWEEP_S,
                                   lambda: notify.vision_alarm_sweep(st), "vision alarms")),
        # generic job runner (exports, webhook delivery) + sweeps
        asyncio.create_task(_every(config.JOBS_WORKER_S, lambda: workers.job_runner(st),
                                   "job runner")),
        asyncio.create_task(_every(config.WEBHOOK_SWEEP_S, lambda: workers.webhook_sweep(st),
                                   "webhook sweep")),
        asyncio.create_task(_every(config.EXPORT_SWEEP_S,
                                   lambda: workers.expired_exports_sweep(st),
                                   "expired exports")),
        # production KPIs: stop detection + scheduled reports
        asyncio.create_task(_every(60, lambda: downtime_sweep(st.pools), "downtime sweep")),
        asyncio.create_task(_every(60, lambda: report_sweep(st.pools), "report sweep")),
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


# Plan-cap triggers (0033: memberships/invites/edges) refuse with
# RAISE EXCEPTION 'plan_limit:<key>' USING ERRCODE=check_violation — that
# lands here as a CheckViolationError (RaiseError covers any future plain
# RAISE with the same convention). Map to the same 402 plans.check_limit
# emits; anything not 'plan_limit:*' re-raises into a real 500.
@app.exception_handler(asyncpg.CheckViolationError)
@app.exception_handler(asyncpg.RaiseError)
async def plan_limit_handler(request: Request, exc: asyncpg.PostgresError):
    msg = getattr(exc, "message", None) or str(exc)
    if msg.startswith("plan_limit:"):
        key = msg.split(":", 1)[1].split("\n")[0].strip()
        return JSONResponse(
            status_code=402,
            content={"detail": {"error": "plan_limit", "limit": key}})
    raise exc


# Starlette wraps LATER add_middleware calls OUTSIDE earlier ones, so the
# first registration here is the innermost user middleware.
# Resulting wrap order (outermost -> innermost):
#   Observability -> OriginGuard -> CORS -> OrgGuard -> routes.
# OrgGuard is innermost: its 403/404 rejections still travel back through
# CORS + observability, so a refused request carries the CORS headers, an
# X-Request-ID, an access-log line and metrics like any other response.
app.add_middleware(orgguard.OrgGuardMiddleware)   # suspended/deleted org gate (roadmap 7.1/1.6)
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
    404 for /metrics on the web origin). See app.core.observability docstring."""
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


class OrgCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str
    timezone: str = "Asia/Bangkok"
    language: str = "en"


@app.post("/api/v1/orgs", status_code=201)
async def create_organization(body: OrgCreateIn, request: Request,
                              p: Principal = Depends(require_user)):
    """Self-serve org creation (roadmap 1.2): creator becomes owner, a default
    site is created. Needs a verified email; API keys cannot create orgs."""
    if p.user_id is None or p.kind not in ("oidc", "dev"):
        raise ForbiddenError("a signed-in user is required")
    await _mutation_gate(request, p.user_id)
    try:
        out = await orgs_mod.create_org(
            st(request).pools, p.user_id, name=body.name, slug=body.slug,
            timezone=body.timezone, language=body.language)
    except orgs_mod.OrgError as e:
        raise HTTPException(e.status, e.code) from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    st(request).auth.forget(p.sub)  # /me shows the new org at once
    return out


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
async def list_tags(request: Request, sc: Scope = Depends(v1_read)):
    """v1 shim: the seeded site's tags only — the registry is now multi-org
    (v4 T9), so the compat surface must filter or other orgs' tags would
    leak under plant1-prefixed names."""
    s = st(request)
    await s.registry.maybe_refresh()
    return [{"name": s.registry.display_name(t), "writable": t.writable,
             **({"unit": t.unit} if t.unit else {})}
            for t in sorted(s.registry.for_site(sc.site_id),
                            key=lambda t: s.registry.display_name(t))]


@app.get("/api/tags/latest")
async def tags_latest_bulk(request: Request, sc: Scope = Depends(v1_read)):
    """All latest values for the site in one call (CONTRACT.v2 `/tags/latest`)."""
    s = st(request)
    await s.registry.maybe_refresh()
    async with org_tx(request, sc.org_id) as tc:
        rows = await tc.fetch("SELECT tag_id, v, q, ts FROM tag_latest")
    out = []
    for r in rows:
        tag = s.registry.by_id(r["tag_id"])
        # seeded-SITE filter (T9-review F3): /api/tags already scopes to
        # V1_SITE_ID — the bulk latest must too, not just the shim org
        if tag and tag.site_id == sc.site_id:
            out.append({"name": s.registry.display_name(tag), "v": finite_or_none(r["v"]), "q": r["q"],
                        "ts": iso_z(r["ts"])})
    return out


@app.get("/api/alarm-rules")
async def list_alarm_rules(request: Request, sc: Scope = Depends(v1_read)):
    s = st(request)
    async with org_tx(request, sc.org_id) as tc:
        rows = await tc.fetch("SELECT tag_id, name, kind, threshold, stale_s, deadband, severity,"
                              " enabled FROM alarm_rules ORDER BY name")
    out = []
    for r in rows:
        tag = s.registry.by_id(r["tag_id"])
        if tag is not None and tag.site_id != sc.site_id:
            continue
        out.append({"tag": s.registry.display_name(tag) if tag else None,
                    "name": r["name"], "kind": r["kind"],
                    "threshold": r["threshold"], "stale_s": r["stale_s"],
                    "deadband": r["deadband"], "severity": r["severity"],
                    "enabled": r["enabled"]})
    return out


@app.get("/api/tags/{name:path}/latest")
async def tag_latest(name: str, request: Request, sc: Scope = Depends(v1_read)):
    tag = st(request).registry.by_display_name(sc.site_id, name)
    if tag is None:
        raise HTTPException(404, "tag not found or no data yet")
    async with org_tx(request, sc.org_id) as tc:
        row = await tc.fetchrow("SELECT v, q, ts FROM tag_latest WHERE tag_id=$1", tag.id)
    if row is None:
        raise HTTPException(404, "tag not found or no data yet")
    return {"name": name, "v": finite_or_none(row["v"]), "q": row["q"],
            "ts": iso_z(row["ts"])}


@app.get("/api/tags/{name:path}/history")
async def tag_history(
    name: str,
    request: Request,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    sc: Scope = Depends(v1_read),
):
    tag = st(request).registry.by_display_name(sc.site_id, name)
    if tag is None:
        return []
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, sc.org_id) as tc:
        # newest `limit` rows in range, returned oldest→newest (trend seeding)
        rows = await tc.fetch(
            "SELECT v, q, ts FROM (SELECT v, q, ts FROM tag_history WHERE tag_id=$1"
            " AND ($2::timestamptz IS NULL OR ts >= $2) AND ($3::timestamptz IS NULL OR ts <= $3)"
            " ORDER BY ts DESC LIMIT $4) x ORDER BY ts ASC", tag.id, t_from, t_to, limit)
    return [{"v": finite_or_none(r["v"]), "q": r["q"], "ts": iso_z(r["ts"])} for r in rows]


@app.get("/api/tags/{name:path}/availability")
async def tag_availability(
    name: str,
    request: Request,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    sc: Scope = Depends(v1_read),
):
    """Share of samples with quality 'good' in the window (SLO SLI).
    Only as deep as tag_history retention (HISTORY_MAX_AGE_S)."""
    tag = st(request).registry.by_display_name(sc.site_id, name)
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else utcnow()
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    out = {"name": name, "from": iso_z(t_from) if t_from else None, "to": iso_z(t_to),
           "samples": 0, "good_frac": None, "uptime": None, "down_s": None}
    if tag is None:
        return out
    async with org_tx(request, sc.org_id) as tc:
        row = await tc.fetchrow(
            "SELECT count(*) AS n, count(*) FILTER (WHERE q='good') AS good,"
            " min(ts) AS first FROM tag_history WHERE tag_id=$1"
            " AND ($2::timestamptz IS NULL OR ts >= $2) AND ts <= $3",
            tag.id, t_from, t_to)
    if row["n"]:
        frac = row["good"] / row["n"]
        # window actually covered: retention may be shorter than the request
        start = max(t_from, row["first"]) if t_from else row["first"]
        out.update(samples=row["n"], good_frac=frac, uptime=frac,
                   down_s=round((1 - frac) * (t_to - start).total_seconds(), 1))
    return out


@app.post("/api/commands", status_code=201)
async def post_command(body: CommandIn, request: Request,
                       sc: Scope = Depends(v1_operate)):
    s = st(request)
    code, resp = await s.commands.issue(
        tag=s.registry.by_display_name(sc.site_id, body.tag),
        org_id=sc.org_id, site_id=sc.site_id,
        value=body.value, ttl_s=body.ttl_s,
        idempotency_key=body.idempotency_key, user_id=sc.p.user_id)
    out = JSONResponse(status_code=code, content=resp)
    if code == 429:
        # RFC 6585 — clients back off on the header, not the body
        out.headers["Retry-After"] = str(resp.get("retry_after_s", 1))
    return out


@app.get("/api/commands")
async def list_commands(request: Request, limit: int = Query(50, ge=1, le=500),
                        tag: str | None = None, user: str | None = None,
                        sc: Scope = Depends(v1_operate)):
    async with org_tx(request, sc.org_id) as tc:
        return await st(request).commands.list(tc, limit, tag, user, site_id=sc.site_id)


@app.get("/api/commands/{cid}")
async def get_command(cid: str, request: Request, sc: Scope = Depends(v1_operate)):
    async with org_tx(request, sc.org_id) as tc:
        cmd = await st(request).commands.get(tc, _uuid_or_404(cid, "command"))
    if cmd is None:
        raise HTTPException(404, "command not found")
    return cmd


@app.get("/api/alarms")
async def list_alarms(request: Request, status: str | None = Query(None),
                      severity: str | None = Query(None),
                      limit: int = Query(100, ge=1, le=500),
                      sc: Scope = Depends(v1_read)):
    async with org_tx(request, sc.org_id) as tc:
        return await st(request).alarms.list_alarms(tc, status, severity, limit,
                                                    site_id=sc.site_id)


@app.get("/api/insights")
async def list_insights(request: Request,
                        state: str | None = Query(None),
                        kind: str | None = Query(None),
                        tag: str | None = Query(None),
                        from_: str | None = Query(None, alias="from"),
                        to: str | None = Query(None),
                        sc: Scope = Depends(v1_read)):
    """Engine-generated insights (doc 19 §4.3) — additive v1 endpoint.
    Member read, same policy as /api/alarms (anonymous removed, v4 T5)."""
    s = st(request)
    if state is not None and state not in ("open", "closed"):
        raise HTTPException(400, "invalid_request")
    if kind is not None and kind not in INSIGHT_KINDS:
        raise HTTPException(400, "invalid_request")
    tag_id = None
    if tag is not None:
        t = s.registry.by_display_name(sc.site_id, tag)
        if t is None:
            return []
        tag_id = t.id
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with org_tx(request, sc.org_id) as tc:
        return await s.insights.list_insights(tc, state, kind, tag_id, t_from, t_to,
                                            site_id=sc.site_id)


@app.post("/api/alarms/{alarm_id}/ack")
async def ack_alarm(alarm_id: str, request: Request,
                    sc: Scope = Depends(v1_operate)):
    uid = sc.p.user_id
    await _mutation_gate(request, uid)
    async with org_tx(request, sc.org_id, uid) as tc:
        alarm = await st(request).alarms.ack(tc, _uuid_or_404(alarm_id, "alarm"), uid,
                                             f"user:{uid}", site_id=sc.site_id)
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
        "config_version": r["config_version"], "config_applied": r["config_applied"],
        "config_error": r["config_error"],
        # the reconciler recreated a lost credential: broker is live, nobody
        # holds the secret — rotate to regain access (doc 17 §6)
        "needs_rotation": bool(latest_ident and not latest_ident["secret_issued"]),
    }


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
            " severity, window_s, enabled FROM alarm_rules WHERE tag_id IN"
            " (SELECT id FROM tags WHERE site_id=$1) ORDER BY name", site_id)
    return {"items": [{"id": str(r["id"]), "tag_id": str(r["tag_id"]),
                       "name": r["name"], "kind": r["kind"],
                       "threshold": r["threshold"], "stale_s": r["stale_s"],
                       "window_s": r["window_s"],
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
            " credential_version, last_hb_at, clock_ok, adapter,"
            " config_version, config_applied, config_error FROM edges"
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
        # Plan cap inside the INSERT tx — check_limit's org-row lock
        # serializes racing provisions (402 plan_limit on a full plan); the
        # edges_plan_cap trigger (0033) backstops every other insert path.
        # A cap refusal AFTER the dynsec client exists leaves an orphan the
        # reconciler disables — same failure posture as a failed INSERT.
        await plans.check_limit(tc, org_id, "max_edges")
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
        enroll_code, enroll_expires = await _issue_enroll_code(
            tc, eid, p.user_id)
        await tc.execute("SELECT pg_notify('wds_edges', $1)", str(eid))
    await st(request).registry.refresh()
    edge = {"id": str(eid), "org_id": str(org_id), "site_id": str(site_id),
            "name": body.name, "status": "active", "mqtt_username": username,
            "credential_version": version, "needs_rotation": False,
            "config_version": 0, "config_applied": None, "config_error": None}
    return {"edge": edge, "secret": secret, "enroll_code": enroll_code,
            "enroll_expires_at": iso_z(enroll_expires)}


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
    cred = await _rotate_edge_credential(
        request, st(request).pools.app, org_id, site_id, eid,
        actor=f"user:{p.user_id}", user_id=p.user_id, action="edge.rotated")
    if cred is None:
        return JSONResponse(status_code=503, content={"detail": "provisioning_failed"})
    # Always push in-band: gateways enrolled via a code listen on /cred and
    # adopt it; env-bootstrap gateways ignore the message (they use files/env).
    credpush.push_cred(st(request).mqtt, org_id, site_id, eid,
                       cred["version"], cred["username"], cred["secret"])
    return {"edge_id": str(eid), "credential_version": cred["version"],
            "mqtt_username": cred["username"], "secret": cred["secret"],
            "grace_s": int(config.EDGE_CRED_GRACE_S)}


async def _rotate_edge_credential(request: Request, pool, org_id: UUID,
                                  site_id: UUID, eid: UUID, *, actor: str,
                                  user_id: UUID | None, action: str,
                                  audit_detail: dict | None = None) -> dict | None:
    """Mint credential version n+1 on the edge's role (doc 17 §5): broker
    client first, then the rows; the previous active identity drops to grace.
    Shared by the operator rotate route and enrollment. None = broker failure
    (nothing committed; a stray client is an orphan the reconciler disables)."""
    async with tenant_tx(pool, org_id) as tc:
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
        return None
    async with tenant_tx(pool, org_id, user_id) as tc:
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
        await audit.append(tc, actor, action,
                           {"edge_id": str(eid), "username": username},
                           {"credential_version": version, **(audit_detail or {})})
        await tc.execute("SELECT pg_notify('wds_edges', $1)", str(eid))
    await st(request).registry.refresh()
    return {"version": version, "username": username, "secret": secret}


async def _issue_enroll_code(tc, eid: UUID, user_id: UUID | None):
    """New one-time code for an edge; unused older codes are voided. Only the
    sha256 is stored (spec 5.1)."""
    code = enroll_codes.new_code()
    expires = utcnow() + timedelta(seconds=enroll_codes.CODE_TTL_S)
    await tc.execute(
        "UPDATE edge_enrollments SET used_at=now()"
        " WHERE edge_id=$1 AND used_at IS NULL", eid)
    await tc.execute(
        "INSERT INTO edge_enrollments(org_id, edge_id, code_hash, expires_at,"
        " created_by) VALUES ($1,$2,$3,$4,$5)",
        tc.org_id, eid, enroll_codes.hash_code(code), expires, user_id)
    return code, expires


@app.post("/api/v1/orgs/{org}/sites/{site}/edges/{edge_id}/enroll-code")
async def new_enroll_code(org: str, site: str, edge_id: str, request: Request,
                          p: Principal = Depends(require_user)):
    """Fresh 30-min enrollment code for an edge (e.g. the first one expired)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    eid = _uuid_or_404(edge_id, "edge")
    async with tenant_tx(st(request).pools.app, org_id, p.user_id) as tc:
        edge = await tc.fetchrow(
            "SELECT id, status FROM edges WHERE id=$1 AND site_id=$2", eid, site_id)
        if edge is None:
            raise HTTPException(404, "edge not found")
        if edge["status"] != "active":
            raise HTTPException(409, "edge_not_active")
        code, expires = await _issue_enroll_code(tc, eid, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "edge.enroll_code_issued",
                           {"edge_id": str(eid)}, None)
    return {"enroll_code": code, "enroll_expires_at": iso_z(expires)}


ENROLL_BODY_MAX = 1024


class EnrollIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)


def _read_ca_pem() -> str:
    if not config.MQTT_CA_FILE:
        return ""
    try:
        with open(config.MQTT_CA_FILE, encoding="utf-8") as f:
            return f.read()
    except OSError:
        log.warning("MQTT_CA_FILE unreadable for enroll response")
        return ""


@app.post("/api/v1/edge/enroll")
async def edge_enroll(request: Request):
    """Exchange a one-time code for the gateway identity (spec 5.1). No auth:
    the code is the credential, so the endpoint is per-IP rate limited and
    the code is single-use. The MQTT credential is rotated here, so the
    provision-time secret is no longer the live one."""
    s = st(request)
    ip = _client_ip(request)
    if not await s.enroll_limiter.allow(ip):
        retry = await s.enroll_limiter.retry_after(ip)
        raise HTTPException(status_code=429, detail="rate_limited",
                            headers={"Retry-After": str(max(1, math.ceil(retry)))})
    # the limiter runs BEFORE the body is read or parsed: junk bodies cost a token
    raw = await request.body()
    if len(raw) > ENROLL_BODY_MAX:
        raise HTTPException(413, "body_too_large")
    try:
        body = EnrollIn.model_validate_json(raw)
    except ValueError:
        raise HTTPException(422, "invalid_body") from None
    code_hash = enroll_codes.hash_code(body.code)
    if code_hash is None:
        raise HTTPException(404, "unknown_code")
    async with global_tx(s.pools.system) as conn:
        row = await conn.fetchrow(
            "SELECT en.id, en.org_id, en.edge_id, en.expires_at, en.used_at,"
            " e.site_id, e.status, o.deleted_at AS org_deleted_at"
            " FROM edge_enrollments en"
            " JOIN edges e ON e.org_id=en.org_id AND e.id=en.edge_id"
            " JOIN organizations o ON o.id=en.org_id"
            " WHERE en.code_hash=$1", code_hash)
    if row is None:
        raise HTTPException(404, "unknown_code")
    # Deleted org is terminal — same refusal OrgGuard gives its REST routes.
    # Suspended orgs are deliberately NOT refused: OrgGuard gates member
    # writes only, and a suspended org's gateways must stay connectable —
    # enroll is device provisioning, not member traffic.
    if row["org_deleted_at"] is not None:
        raise HTTPException(410, "org_deleted")
    if row["status"] != "active":
        raise HTTPException(410, "edge_disabled")
    if row["used_at"] is not None:
        raise HTTPException(410, "code_used")
    if row["expires_at"] <= utcnow():
        raise HTTPException(410, "code_expired")
    org_id, site_id, eid = row["org_id"], row["site_id"], row["edge_id"]
    async with tenant_tx(s.pools.system, org_id) as tc:
        # single-statement claim: two concurrent enrolls cannot both win
        won = await tc.fetchval(
            "UPDATE edge_enrollments SET used_at=now() WHERE id=$1"
            " AND used_at IS NULL AND expires_at > now() RETURNING id", row["id"])
    if won is None:
        raise HTTPException(410, "code_used")
    cred = await _rotate_edge_credential(
        request, s.pools.system, org_id, site_id, eid,
        actor=f"edge:{eid}", user_id=None, action="edge.enrolled",
        audit_detail={"enrollment_id": str(row["id"]), "ip": ip})
    if cred is None:
        # broker down: give the code back so the gateway's restart retries
        async with tenant_tx(s.pools.system, org_id) as tc:
            await tc.execute(
                "UPDATE edge_enrollments SET used_at=NULL WHERE id=$1", row["id"])
        return JSONResponse(status_code=503, content={"detail": "provisioning_failed"})
    return JSONResponse(headers={"Cache-Control": "no-store"}, content={
        "org_id": str(org_id), "site_id": str(site_id), "edge_id": str(eid),
        "mqtt_host": config.PUBLIC_MQTT_HOST or request.url.hostname or "localhost",
        "mqtt_port": config.PUBLIC_MQTT_PORT,
        "ca_pem": _read_ca_pem(),
        "mqtt_username": cred["username"], "mqtt_password": cred["secret"],
        # gateway-side at-rest key; deliberately not stored server-side
        "state_key": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
    })


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


# data sources + tags CRUD (spec 5.2) — handlers resolve auth helpers from this
# module lazily, so including here (after the helpers exist) is safe.
app.include_router(datasources_router)
app.include_router(videos_router)
app.include_router(plant_router)
app.include_router(cameras_router)
app.include_router(material_router)
app.include_router(artifacts_router)
app.include_router(models_router)
app.include_router(classes_router)
app.include_router(stream_router)
app.include_router(vision_rules_router)
app.include_router(vision_events_router)
app.include_router(vision_external_router)
app.include_router(notify.router)
app.include_router(orgapi.router)
app.include_router(platform_api.router)
app.include_router(oee_router)
app.include_router(reports_router)
app.include_router(consents.router)
app.include_router(onboarding.router)
app.include_router(eventsfeed.router)
app.include_router(tagquery.router)
app.include_router(edgelogs.router)
app.include_router(statuspage.router)
for _r in api_routers:
    app.include_router(_r)


# ---------------------------------------------------------------------------
# WebSocket (v1)
# ---------------------------------------------------------------------------
# _trusted_peer/_client_ip live in app.core.observability (v4 T8) — same code the
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
