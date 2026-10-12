# backend — industrial dashboard demo

FastAPI service implementing the binding `../CONTRACT.md`: MQTT ingest,
command lifecycle, alarms, REST `/api/*`, WebSocket `/ws`, SQLite persistence.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Or with Docker:

```bash
docker build -t idb-backend .
docker run -p 8000:8000 -e MQTT_HOST=host.docker.internal idb-backend
```

## Layout

| file | role |
|---|---|
| `app/main.py` | FastAPI app, lifespan, REST routes, `/ws`, ingest worker, JSON logging |
| `app/db.py` | stdlib `sqlite3`, schema + tag registry, portable SQL |
| `app/mqtt_client.py` | paho bridge: subscribe `{site}/#`, publish commands |
| `app/commands.py` | command lifecycle state machine |
| `app/ws.py` | WS manager, bounded per-client queues (drop-oldest) |
| `app/auth.py` | `Principal` model + dev-token path (**APP_ENV=dev only**) |
| `app/security.py` | OIDC: JWKS cache, RS256 verify, authz cache, `wds_authz` listener, back-channel logout |
| `app/seed_oidc.py` | dev provisioning: KC demo passwords + org memberships (`make seed-dev`) |
| `app/alarms.py` | alarm rule engine |

## Env vars

`MQTT_HOST` (default `localhost`), `MQTT_PORT` (1883), `SITE` (plant1),
`EDGE_ID` (edge1), `DB_PATH` (`data/app.db`),
`CORS_ORIGIN` (`http://localhost:5173`), `LOG_LEVEL` (INFO).

Rate limiting + WS admission (v4 T4, doc 16 row 7 — in-process token buckets,
single replica):
`RATE_COMMANDS_PER_TAG` (5 per `RATE_COMMANDS_WINDOW_S`=10 s, per user+tag;
over → 429 + `Retry-After`), `RATE_MUTATIONS_PER_USER` (60 per
`RATE_MUTATIONS_WINDOW_S`=60 s, non-command mutations),
`RATE_WS_PER_IP` (20 concurrent `/ws` sockets per client IP; over → close
4403), `ALLOWED_ORIGINS` (comma-separated WS Origin allowlist; unset/empty =
same-origin only — the request Origin's host:port must equal the Host header;
a missing Origin is allowed for non-browser clients; outside `APP_ENV=prod`,
loopback↔loopback port mismatches are also allowed so a vite dev proxy on a
random port still works).

## Auth — OIDC via Keycloak (v4 T5, ADR-12)

`Authorization: Bearer <access JWT>` — RS256 tokens from the Keycloak realm
`wds` (`iss` = `<web origin>/realms/wds`, `aud` must include `wds-api`).
The verifier pins RS256 (the token's `alg` header is never trusted), applies
30 s leeway, requires `iss/aud/exp/iat/sub/sid`, and serves JWKS from a
bounded 10-minute cache with rate-limited unknown-`kid` refetches. **Fail
closed**: IdP down or DB down → 401, never a degraded pass.

- **No anonymous reads.** Every `/api/*` requires a verified token with a
  `memberships` row in the org (401 unauthenticated, 403 non-member). Only
  `/healthz`, `/api/health` and `/api/auth/config` stay public.
- Users are upserted from verified claims on first sight; authorization is
  always the `memberships` table — never token claims.
- Revocation: `revoked_sessions(sid)` + Postgres `NOTIFY wds_authz` takes
  effect ≤5 s on REST (5 s authz-cache TTL) and immediately evicts bound WS
  clients (4401 revoked / 4403 membership lost). `users.disabled_at` → 401.
- Back-channel logout: `POST /api/auth/backchannel-logout` (form-encoded
  `logout_token`; aud = `wds-web`, backchannel event, no `nonce`).
- `/api/me` returns `{user, role, kind, orgs}` — any valid token, even
  without membership (`role: "none"` → the SPA shows the denied wall).
- `/api/auth/config` is the unauthenticated SPA bootstrap
  (`{env, dev_tokens, oidc:{realm, client_id}}`).

WS takes the same token in a first-frame `{"type":"auth"}` message (never
`?token=` — query strings leak into logs); no/empty/bad token → close 4401,
non-member → 4403. OIDC sockets close at `exp + 30 s` — the SPA silently
renews and reconnects.

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
  head (wds_app reads the version table via the 0005 grant). 200/503.
  Backend-only like /metrics (nginx `404`); the compose healthcheck stays on
  `/api/health`.
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
`JWKS_TTL_S` (600), `JWKS_REFETCH_MIN_S` (30), `AUTHZ_TTL_S` (5 — the
revocation SLA). Keycloak itself: `KC_HOSTNAME` (must equal the web origin),
`KC_ADMIN`/`KC_ADMIN_PASSWORD` (bootstrap), `KC_DEMO_PASSWORD` (realm test
users, set by `make seed-dev`).

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
- Publishes to `plant1/cmd/edge1/{command_id}` (QoS 1); `sent` on publish.
- `cmd-resp` `done|denied|error` → `done|denied|failed`; no response within
  `ttl_s` → `timeout` (background task). No auto-retry.
- Every transition → `audit_log` row + WS `command` event.

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
- Tag `v`/`commands.value` stored JSON-encoded in TEXT columns (bool vs
  number round-trips losslessly; portable SQL).
- Staleness measured on backend receive-time, not payload `ts` (SDLC 05 §6).
- `/ws` no longer broadcasts to anonymous clients at all — v4 T5 removed
  anonymous connections; `command` events go to operator+ roles only.
