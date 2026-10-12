# webservice — industrial dashboard demo

Edge → MQTT → FastAPI → React pipeline for a simulated sorting line
(Factory I/O-style). One edge node (`edge1`) on site `plant1` publishes
UNS-shaped telemetry; the backend persists it (SQLite), serves REST + a
live WebSocket, and runs the alarm + command-lifecycle engines; the web
UI is a dense Datadog/Grafana-grade ops console.

```
edge-bridge ──MQTT──> mosquitto ──> backend ──REST/WS──> web (nginx)
    (sim/modbus,     (auth+ACL,     (ingest, persist,  (React,
     QoS1, heartbeat, localhost)     alarms, commands)   uPlot)
 <──cmd / cmd-resp───────────────┘
```

| service | build | host port | role |
|---|---|---|---|
| mosquitto | `eclipse-mosquitto:2` | `127.0.0.1:1883` | broker — auth + per-identity ACL, loopback only |
| edge-bridge | `edge-bridge/` | — | adapter (sim, modbus-ready) → telemetry + command handler |
| backend | `backend/` | `127.0.0.1:8000` | FastAPI: `/api`, `/ws`, SQLite, alarm + command engines |
| web | `web/` | `127.0.0.1:5173` | React SPA behind nginx (proxies `/api`, `/ws`) |

## Quickstart

```bash
cp .env.example .env       # optional — defaults work out of the box
make secrets certs         # first run only: infra/secrets + dev TLS certs (gitignored)
make up                    # docker compose up -d --build --wait
open http://localhost:5173
```

Demo tokens (development-only): paste `demo-operator` (full control) or
`demo-viewer` (read-only) into the token badge in the UI header.

## Commands

`make` lists everything: `up` `down` `ps` `logs` `build` `clean`
`test-contract` `test-integration` `uat` `web-build`

## Layout

```
CONTRACT.md   binding protocol contract (topics, payloads, REST, WS, lifecycle)
docker-compose.yml
infra/        broker config (mosquitto.conf, ACL) + credential generator
backend/      FastAPI service — app/, alarm_rules.yaml, Dockerfile
edge-bridge/  OT adapter — edge_bridge/, tags.yaml (canonical tag registry)
web/          React+Vite SPA — bun.lock is the canonical lockfile
tests/        contract + integration + e2e browser UAT
SDLC.md       SDLC doc index
SDLC/industrial-dashboard/  design docs 00–15 (incl. AWS target architecture)
```

## Config

`edge-bridge/tags.yaml` is the single source of truth for the tag
registry — edge reads it to publish, backend mounts it read-only to seed
`tags` (falls back to its built-in copy when run standalone). Alarm rules
live in `backend/alarm_rules.yaml`.

## Status

Demo scope verified: contract suite + integration suite + browser UAT.
This is **not** production — pre-AWS entry criteria are tracked in
`SDLC/industrial-dashboard/15-uat-signoff.md` (real IdP, per-device IoT
policies, TimescaleDB, TLS, vision feed, PLC adapter).
