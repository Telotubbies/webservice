# backend — industrial dashboard

FastAPI service implementing `../CONTRACT.v2.md`: MQTT ingest over TLS +
dynsec, command lifecycle, alarms, insights, REST `/api/*`, WebSocket `/ws`,
PostgreSQL persistence with row-level security, Keycloak OIDC.

## Run

The supported path is the compose stack (it provides Postgres, the migrated
schema, mosquitto TLS 8883, and Keycloak):

```bash
make secrets certs   # first run only
make up
```

For host-side development the deps still come from compose (the test
overlay publishes Postgres on `127.0.0.1:5433` and plaintext MQTT on 1883):

```bash
pip install -r requirements.txt
# point at the compose services; DSNs accept inline or file-mounted passwords
WDS_APP_DSN=postgresql://wds_app:app-dev-pass@localhost:5433/wds \
WDS_SYSTEM_DSN=postgresql://wds_system:system-dev-pass@localhost:5433/wds \
uvicorn app.main:app --port 8000
```

## Layout

| file | role |
|---|---|
| `app/main.py` | FastAPI app, lifespan, REST routes, `/ws`, ingest worker, JSON logging |
| `app/db/` | asyncpg pools (`wds_app`/`wds_system`), RLS tenant context (`global_tx`/`user_tx`/`tenant_tx`/`invite_tx`), audit-hash chain helpers |
| `app/mqtt_client.py` | paho bridge over TLS 8883: shared-subscribe `v2/+/+/+/{tele/#,hb,cmd-resp/+}`, publish `v2/{org}/{site}/{edge}/cmd/{id}` |
| `app/dynsec.py` | mosquitto dynamic-security reconciler — `edges`/`edge_identities` ↔ broker clients/ACLs |
| `app/commands.py` | command lifecycle state machine |
| `app/ws.py` | WS manager, bounded per-client queues (drop-oldest), shared `origin_allowed` + `OriginGuardMiddleware` |
| `app/auth.py` | `Principal` model + dev-token path (**APP_ENV=dev only**) |
| `app/security.py` | OIDC: JWKS cache, RS256 verify, authz cache, `wds_authz` listener + revalidation sweep, back-channel logout |
| `app/registry.py` | site→org resolution cache for WS site selection + MQTT ingest |
| `app/alarms.py` | alarm rule engine + `alarm_rules_changed` NOTIFY reload |
| `app/insights.py` | insight/anomaly engine |
| `app/observability.py` | metrics, request-id, access-log middleware + log redaction |
| `app/ratelimit.py` | in-process token buckets (single replica) |
| `app/seed.py` / `app/seed_oidc.py` | dev seed + KC demo provisioning (`make seed-dev`) |

## Env vars

`MQTT_HOST` (default `localhost`), `MQTT_PORT` (**8883** — TLS only; plaintext
1883 exists only under the test overlay), `MQTT_USER`/`MQTT_PASSWORD` or
`MQTT_PASSWORD_FILE`, `MQTT_CA_FILE` (self-signed dev CA from `make certs`),
`CORS_ORIGIN` (`http://localhost:5173`), `LOG_LEVEL` (INFO).

Postgres (ADR-13): `WDS_APP_DSN`, `WDS_SYSTEM_DSN` — passwords inline or via
`WDS_APP_PASSWORD_FILE`/`WDS_SYSTEM_PASSWORD_FILE` (compose uses files so
creds never show in `docker inspect`).

Dynsec (doc 17): `DYNSEC_ADMIN_USER` (`svc-dynsec-admin`),
`DYNSEC_ADMIN_PASSWORD_FILE`, `SVC_BACKEND_PW_FILE`, `TESTER_PW_FILE`,
`EDGE_BOOTSTRAP_PW_FILE`, `DYNSEC_RECONCILE_S` (60), `EDGE_CRED_GRACE_S`
(86400).

Rate limiting + admission (v4 T4, doc 16 row 7 — in-process token buckets,
single replica): `RATE_COMMANDS_PER_TAG` (5 per 10 s per user+tag → 429 +
`Retry-After`), `RATE_MUTATIONS_PER_USER` (60 per 60 s, non-command
mutations), `RATE_WS_PER_IP` (20 concurrent `/ws` sockets per client IP →
close 4403), `RATE_LOGOUT_PER_IP` (10 backchannel POSTs per 60 s per IP).

`ALLOWED_ORIGINS` — comma-separated Origin allowlist. The same policy gates
the WS upgrade **and** every mutating `/api` request that carries an Origin
header (`OriginGuardMiddleware`, CONTRACT.v2 §2): allowlist match or
same-origin (Origin's `host[:port]` == `Host`) → pass; mismatch → WS close
4403 / HTTP 403. A *missing* Origin is allowed — non-browser clients send
none; browsers always send it on cross-origin mutations. Outside
`APP_ENV=prod` loopback↔loopback port mismatches are also allowed so a vite
dev proxy on a random port still works. Safe methods
(`GET`/`HEAD`/`OPTIONS`) and non-`/api` paths are never Origin-checked.

`TRUSTED_PROXIES` — CIDRs whose peers may set `X-Real-IP` (the rate-limit +
WS-cap client-IP key); `X-Forwarded-For` is never trusted.

## Auth — OIDC via Keycloak (v4 T5, ADR-12)

`Authorization: Bearer <access JWT>` — RS256 tokens from the Keycloak realm
`wds` (`iss` = `<web origin>/realms/wds`, `aud` must include `wds-api`).
The verifier pins RS256 (the token's `alg` header is never trusted), applies
30 s leeway, requires `iss/aud/exp/iat/sub/sid`, and serves JWKS from a
bounded 10-minute cache with rate-limited unknown-`kid` refetches. **Fail
closed**: IdP down or DB down → 401, never a degraded pass.

- **No anonymous reads.** Every `/api/*` requires a verified token (401
  unauthenticated; org routes resolve tenancy from the path + `memberships`,
  non-member → 404). Only `/healthz`, `/readyz`, `/metrics`, `/api/health`
  and `/api/auth/config` stay public.
- Users are upserted from verified claims on first sight; authorization is
  always the `memberships` table — never token claims.
- Revocation (ADR-12 §7): `revoked_sessions(sid)` + Postgres `NOTIFY
  wds_authz` is the millisecond path — REST ≤5 s (authz-cache TTL), bound WS
  clients evicted immediately (4401 revoked / 4403 membership lost).
  `users.disabled_at` → 401. NOTIFYs published while the LISTEN socket
  reconnects are lost, so two backstops bound the hole: the listener
  revalidates every connected client on each re-subscribe, and
  `authz_sweep` re-reads `revoked_sessions` + `disabled_at` + `memberships`
  for the connected sid/sub set every **`AUTHZ_SWEEP_S`** (default 5 s —
  kept ≤ the SLA).
- Back-channel logout: `POST /api/auth/backchannel-logout` (form-encoded
  `logout_token`; aud = `wds-web`, backchannel event, no `nonce`).
- `/api/me` returns `{user, role, kind, orgs, memberships}` — any valid
  token, even without membership (`role: "none"` → the SPA shows the
  denied wall). `role` is the v1 shim-org role; `memberships` is the full
  org list.
- `/api/auth/config` is the unauthenticated SPA bootstrap
  (`{env, dev_tokens, oidc:{realm, client_id}}`).

WS takes the same token in a first-frame `{"type":"auth"}` message (never
`?token=` — query strings leak into logs); no/empty/bad token → close 4401,
non-member → 4403. `/ws/v1` auth frames must carry `site_id`; the socket
serves that site's org only. OIDC sockets close at `exp + 30 s` — the SPA
silently renews and reconnects.

## Multi-tenancy (ADR-13)

Every tenant table carries `org_id`; Postgres RLS enforces it at the row
layer, not just in app code. Transaction helpers set `app.user_id` /
`app.org_id` per request so RLS policies see the caller's scope; migrations
run as `wds_owner` (migrate job), the runtime roles are `wds_app` (app
queries) and `wds_system` (LISTEN/dynsec/audit writers).

## Self-observability (v4 T8)

- `GET /metrics` — Prometheus exposition (`prometheus-client`): HTTP request
  count + latency histogram labelled by **route template** (never raw paths —
  no tag/org/uuid label leaks), `wds_ws_connections`, `wds_db_pool_connections`,
  `wds_internal_counters_total{counter=…}` (ingest, mqtt-security, dynsec
  reconciler, alarm + insight engines). **Scrape path:** the backend port is
  loopback-bound (`127.0.0.1:8000`) and nginx answers `404` for `/metrics` on
  the web origin, so the endpoint is not publicly scrapeable:
  `curl http://localhost:8000/metrics` from the host, or a metrics container
  on the compose network scraping `http://backend:8000/metrics`.
- `GET /readyz` — readiness: DB connect + `alembic_version` == migrations
  head. Backend-only like /metrics (nginx `404`); the compose healthcheck
  stays on `/api/health`.
- Every HTTP request gets an `X-Request-ID` (a sane inbound value is
  propagated, else minted) and a JSON access log line on the
  `backend.access` logger: method, route template, status, latency_ms,
  request_id, client ip, and the authenticated `sub`. Headers, query strings
  and bodies are never logged — `app.observability.redact` scrubs
  `token=`/`Authorization:`/`Bearer …`/cookie-shaped material as a second
  fence.
- `/docs`, `/redoc`, `/openapi.json` are served only under `APP_ENV=dev`
  (T5-deferred F7); nginx `404`s them on the web origin in every env.
- `GET /api/system/health` detail is operator+ (viewer → 403): viewers get
  the coarse public `/api/health` + WS `health` events, and the SPA doesn't
  poll the detail endpoint for them.

### Dev tokens (APP_ENV=dev only)

- `demo-operator` → operator (read + command + alarm ack)
- `demo-viewer` → viewer (read only; mutating POST → 403)

Under any other `APP_ENV` the dev-token branch doesn't exist — a demo token
falls through to JWT verification and 401s like any other bad token. Token
comparison is constant-time (`hmac.compare_digest`).

### OIDC env vars

`OIDC_ISSUER` (default `http://localhost:5173/realms/wds` — the PUBLIC realm
URL; nginx proxies `/realms/` to Keycloak so iss == browser authority),
`OIDC_AUDIENCE` (`wds-api`), `OIDC_CLIENT_ID` (`wds-web`),
`OIDC_JWKS_URI` (compose-internal `http://keycloak:8080/realms/wds/protocol/openid-connect/certs`),
`JWKS_TTL_S` (600), `JWKS_REFETCH_MIN_S` (30), `AUTHZ_TTL_S` (5 — authz
cache TTL), `AUTHZ_SWEEP_S` (5 — WS revalidation sweep; the missed-NOTIFY
backstop, kept ≤ the revocation SLA). Keycloak itself: `KC_HOSTNAME` (must
equal the web origin), `KC_ADMIN`/`KC_ADMIN_PASSWORD` (bootstrap),
`KC_DEMO_PASSWORD` (realm test users, set by `make seed-dev`).

Realm test users (`admin@demo`/`operator@demo`/`viewer@demo`, password
`KC_DEMO_PASSWORD`) get their org roles from `seed_oidc` memberships — the
realm `wds-*` roles are markers only.

## Command lifecycle

`issued → sent → acked → done | denied | failed | timeout`

- `POST /api/commands {tag, value, ttl_s?=10, idempotency_key?}` →
  `201 {"command_id","status"}`.
- Same `idempotency_key` + same user → `200` replay of existing command.
- Same tag already in-flight (`issued|sent|acked`) →
  `409 {"detail":"command_in_flight","active_command_id"}` — enforced by a
  partial unique index at the DB layer plus an application check.
- Publishes to `v2/{org}/{site}/{edge}/cmd/{command_id}` (QoS 1); `sent` on
  publish.
- `cmd-resp` `done|denied|error` → `done|denied|failed`; no response within
  `ttl_s` → `timeout` (background task). No auto-retry.
- Every transition → `audit_log` row (hash-chained) + WS `command` event.

## Notes / contract ambiguities resolved

- `acked` exists in the status enum but the sim edge only sends final
  `cmd-resp` (`done|denied|error`), so `acked` is skipped unless an edge sends
  an interim `{"status":"acked"}` — supported but normally unused.
- Alarm `state` adds `cleared` beyond the contract's `active|acked` so a rule
  can fire "once per activation" and still leave an auditable recent-alarm
  trail (`GET /api/alarms` returns active + recent).
- Backend does NOT pre-reject writes to read-only/unknown tags (SDLC 06 lists
  `403`); CONTRACT.md defers that to the edge (`denied/not_writable`) — this
  also exercises the denied lifecycle in the demo.
- `tags` registry table added (not in the contract's minimal schema) to back
  `GET /api/tags` (writable/unit) and drop unknown-tag telemetry per SDLC 05
  §1 topic governance.
- Tag `v`/`commands.value` stored as JSONB (bool vs number round-trips
  losslessly).
- Staleness measured on backend receive-time, not payload `ts` (SDLC 05 §6).
- `/ws` no longer broadcasts to anonymous clients at all — v4 T5 removed
  anonymous connections; `command` events go to operator+ roles only, scoped
  per-org.
