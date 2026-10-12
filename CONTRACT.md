# Demo Contract — webservice industrial dashboard

> **v1 — describes the code that runs today.** The target multi-tenant contract is [CONTRACT.v2.md](CONTRACT.v2.md); v1 is retired when phase 4 lands.

Single source of truth for all services. Derived from `SDLC/industrial-dashboard/`
(esp. `04-edge-bridge.md`, `05-data-model.md`, `06-api-realtime.md`). If a doc and
this file disagree, this file wins for the demo; note the discrepancy in a comment.

## Topology

- MQTT broker: `mosquitto:1883` inside compose (`127.0.0.1:1883` on host — localhost-bound only). QoS 1 everywhere. **Broker auth enabled**: password file + per-identity ACL (`infra/mosquitto.acl`, `infra/mosquitto.passwd`). Identities: `backend` (sub `plant1/#`, pub `plant1/cmd/#`), `edge` (pub telemetry+heartbeat+cmd-resp, sub `plant1/cmd/#`), `tester` (wide `plant1/#` — test-only identity for fault injection). No TLS in demo (TLS = AWS track, doc 10).
- `edge-bridge` (Python): adapter=`sim` default; `modbus` stub. edge_id=`edge1`, site=`plant1`.
- `backend` (Python/FastAPI): `:8000`, REST prefix `/api`, WebSocket `/ws`.
- `web` (React+Vite): `:5173`, proxies `/api` + `/ws` to backend.
- `db`: SQLite file `backend/data/app.db` in demo (TimescaleDB is prod target — keep SQL portable).

## MQTT topics

| Topic | Dir | Payload |
|---|---|---|
| `plant1/{area}/{line}/{device}/{signal}` | edge→broker | `{"v": <num|bool>, "q": "good\|bad\|stale\|uncertain", "ts": <ISO8601 UTC Z>}` |
| `plant1/edge/edge1/heartbeat` | edge→broker, every 5s | `{"status":"up","clock_ok":true,"adapter":"sim","ts":...}` |
| `plant1/cmd/edge1/{req_id}` | backend→edge | `{"command_id","tag","value","issued_at","ttl_s","idempotency_key","user"}` |
| `plant1/cmd-resp/edge1/{req_id}` | edge→backend | `{"command_id","status":"done\|denied\|error","detail":"..."}` |

## Sim tags (edge-bridge `sim` adapter)

| Tag (UNS name = topic tail) | Type | Writable | Behavior |
|---|---|---|---|
| `plant1.sort.line1.motor1.running` | bool | yes | start/stop conveyor |
| `plant1.sort.line1.motor1.speed_sp` | num | yes | setpoint Hz 0–60; writes outside range → `denied/out_of_range` |
| `plant1.sort.line1.conv1.speed_mps` | num | no | follows motor1 (0 when stopped) + noise |
| `plant1.sort.line1.conv1.temp_c` | num | no | drifts up when running, >80 = alarm territory |
| `plant1.sort.line1.bin1.level_pct` | num | no | ramps 0→100 when running, decays when stopped |
| `plant1.sort.vision.cam1.gravel_ratio` | num | no | slow random walk 0–1 (vision stub) |

- Non-existent tag write → `denied/not_writable`. Read-only tag write → `denied/not_writable`.
- `ttl_s` expired before execution → `denied/ttl_expired`. Edge clock skew >500ms vs own check → heartbeat `clock_ok=false`, commands → `denied/clock_untrusted` (sim: env `EDGE_CLOCK_SKEW_MS` for tests).

## Command lifecycle (backend authoritative)

Statuses: `issued|sent|acked|done|denied|failed|timeout`

- `POST /api/commands` `{tag,value,ttl_s?,idempotency_key?}` → `201 {"command_id"}` ; 401 no auth, 403 wrong role, **409 `{"active_command_id"}` if same tag already in-flight**, 400 invalid.
- Backend publishes cmd; marks `sent` on MQTT pub, `acked` when edge publishes resp received... edge responds directly to `cmd-resp` → map `done|denied|error`→`done|denied|failed`. No resp within `ttl_s` → `timeout`. No auto-retry.
- Same `idempotency_key` + same user → return existing command_id (200, not new row).
- `GET /api/commands/{id}` → `{id,tag,value,status,detail?,created_at,updated_at,user}`.
- `GET /api/commands?limit=` list.

## REST (all under `/api`, JSON)

- `GET /api/health` → `{"status":"ok","db":"up","mqtt":"up","edge":"up|stale"}`
- `GET /api/tags` → `[{"name","writable","unit?"}]`
- `GET /api/tags/{name}/latest` → `{name,v,q,ts}` (`name` = full dotted tag; URL-encode path)
- `GET /api/tags/{name}/history?from=&to=&limit=` → `[{v,q,ts}]`
- `GET /api/alarms` → active+recent alarms `[{id,tag,rule,severity,state:active|acked|cleared,ts}]` (`cleared` = condition returned to normal; kept in list for audit trail)
- `POST /api/alarms/{id}/ack` → 200 (auth required)
- `GET /api/system/health` → `{mqtt:{connected},edge:{last_heartbeat_ts,clock_ok},backend:{uptime_s}}`
- Seed alarm rule: `conv1.temp_c > 80` severity `critical`.

## Auth (demo)

- Header `Authorization: Bearer <token>`. Dev tokens: `demo-operator` (role operator: read+command+ack), `demo-viewer` (role viewer: read only). No token = 401 on mutating endpoints; viewer on command = 403. Most GET endpoints allow anonymous (public read-only) — **exception: `GET /api/commands*` requires operator role** (command history reveals who commanded what/when; consistent with WS which only broadcasts `command` events to operator clients).

## WebSocket `/ws`

- `?token=` optional (anonymous = read-only). Events:
  - `{"type":"tag","name","v","q","ts"}`
  - `{"type":"alarm", alarm object}` / `{"type":"alarm_update",...}`
  - `{"type":"command","command_id","status","tag","detail?"}`
  - `{"type":"health","mqtt":"up","edge":"up|stale"}`
  - `{"type":"auth_expired"}` then close code **4401** when token would expire (demo: tokens never expire; just support the event shape).
- Client contract: reconnect with backoff+jitter; UI ring-buffer + rAF flush.

## Env vars

`MQTT_HOST`, `MQTT_PORT`, `EDGE_ID`, `SITE`, `ADAPTER`, `EDGE_CLOCK_SKEW_MS`, `DB_PATH`, `CORS_ORIGIN`, `POLL_MS` (edge poll cadence, default 1000).
