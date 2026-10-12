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
| `app/auth.py` | dev-token auth (**demo only**) |
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

## Auth (dev-only — NOT production security)

`Authorization: Bearer <token>`:

- `demo-operator` → operator (read + command + alarm ack)
- `demo-viewer` → viewer (read only; mutating POST → 403)
- missing/unknown → anonymous (GET allowed; POST → 401)

Tokens are compared in constant time (`hmac.compare_digest`). In prod this is
JWT verification (SDLC 06 §5). WS takes the same token in a first-frame `{"type":"auth"}` message (never `?token=` — query strings leak into logs).

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
- `/ws` broadcasts `command` events to anonymous clients too — CONTRACT.md
  §"WebSocket" doesn't restrict them (SDLC 06 §2 does); contract wins.
