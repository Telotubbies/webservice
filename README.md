# webservice — industrial dashboard

Edge → MQTT(TLS+dynsec) → FastAPI → React pipeline for a simulated sorting
line (Factory I/O-style). One edge node (`edge1`) on site `plant1` publishes
UNS-shaped telemetry on `v2/{org}/{site}/{edge}/…` topics; the backend
persists it (Postgres + RLS), serves REST + a live WebSocket behind Keycloak
OIDC, and runs the alarm, insight + command-lifecycle engines; the web UI is
a dense Datadog/Grafana-grade ops console behind a sign-in wall.

```
edge-bridge ──MQTT 8883/TLS──> mosquitto ──> backend ──REST/WS──> web (nginx)
    (sim/modbus,     (dynsec per-identity   (ingest, Postgres+RLS, (React,
     QoS1, heartbeat) ACLs, loopback)        alarms, OIDC verify)    uPlot)
 <──cmd / cmd-resp───────────────┘                │
        Keycloak (OIDC realm `wds`, PKCE) ────────┘
```

| service | build | host port | role |
|---|---|---|---|
| postgres | `postgres:16-alpine` | — (compose-net only) | system of record — RLS tenancy (`wds_app`/`wds_system`/`wds_owner` roles); test overlay publishes `127.0.0.1:5433` |
| mosquitto | `eclipse-mosquitto:2` | `127.0.0.1:8883` | broker — TLS only, dynamic-security plugin (per-identity ACLs); plaintext 1883 exists only under the test overlay |
| keycloak | `quay.io/keycloak/keycloak:26.4` | `127.0.0.1:8080` | IdP — realm `wds`, public PKCE client `wds-web`, `wds-api` audience, back-channel logout |
| edge-bridge | `edge-bridge/` | — | adapter (sim, modbus-ready) → telemetry + command handler |
| backend | `backend/` | `127.0.0.1:8000` | FastAPI: `/api`, `/ws`, Postgres+RLS, alarm/insight/command engines, dynsec reconciler |
| web | `web/` | `127.0.0.1:5173` | React SPA behind nginx (proxies `/api`, `/ws`, `/realms/`) |

## Quickstart

```bash
cp .env.example .env       # optional — defaults work out of the box
make secrets certs         # first run only: infra/secrets + dev TLS certs (gitignored)
make up                    # docker compose up -d --build --wait
make seed-dev              # dev only: realm test users + demo org memberships
open http://localhost:5173
```

The UI opens on a **sign-in wall** — anonymous access is removed (v4 T5).
Sign in with SSO (Keycloak): `admin@demo`, `operator@demo`, or
`viewer@demo`, password `KC_DEMO_PASSWORD` (default `kc-demo-pass`).
A dev-token path also exists under `APP_ENV=dev` only: `demo-operator`
(full control) / `demo-viewer` (read-only) — it is compiled out under any
other `APP_ENV`.

## Commands

`make` lists everything: `up` `up-test` `down` `ps` `logs` `build` `clean`
`secrets` `secrets-check` `certs` `seed-dev` `test-contract` `test-db`
`test-integration` `test-security` `uat` `web-build` `migrate`
`verify-audit` `backup` `restore` `migrate-sqlite`

Ops (doc 18): `make backup` → timestamped `pg_dump -Fc` into `backups/`;
`make restore DUMP=backups/wds-….dump` drops+recreates `wds` and re-verifies
the audit chain (`verify-audit`). `make migrate-sqlite SQLITE=<app.db> [DRY=1]`
imports a v1 SQLite database into Postgres for a target org
(`scripts/migrate_sqlite_to_pg.py`, doc 18 §3 — idempotent, `--dry-run`
reports row counts).

Prod posture (v4 T7): `APP_ENV` defaults to `dev` for DX — a production
deploy MUST set `APP_ENV=prod`, which fails fast when any required env is
missing or still holds a dev-default secret (see `.env.example`). All
secrets are file-mounted under `infra/secrets/` — `docker inspect` shows
paths only, never values. Postgres/Keycloak secret files are invisible to
the backend, so prod bring-up must also run `make secrets-check` (auto-run
by `make up` when `APP_ENV=prod`) — it fails while any file still holds a
documented dev default. A production Keycloak realm must also disable
`directAccessGrantsEnabled` on `wds-web` — it is on in the dev/test realm
only because the test harness mints JWTs through the direct grant (see the
`wds-web` description in `infra/keycloak/realm-wds.json`).

## Layout

```
CONTRACT.md    v1 binding contract (topics, payloads, REST, WS, lifecycle)
CONTRACT.v2.md v2 multi-tenant contract — orgs/sites/edges, admin API, OIDC
docker-compose.yml + docker-compose.test.yml
infra/         mosquitto conf + dynsec policy, TLS certs, keycloak realm,
               postgres init, secrets generator
backend/       FastAPI service — app/, alarm_rules.yaml, Dockerfile
edge-bridge/   OT adapter — edge_bridge/, tags.yaml (canonical tag registry)
web/           React+Vite SPA — bun.lock is the canonical lockfile
tests/         contract + integration + security + e2e browser UAT
SDLC.md        SDLC doc index
SDLC/industrial-dashboard/  design docs 00–20 (incl. AWS target architecture,
               ADRs 12–14, doc 17 MQTT security, doc 18 ops)
```

## Config

`edge-bridge/tags.yaml` is the single source of truth for the tag
registry — edge reads it to publish, backend mounts it read-only to seed
`tags` (falls back to its built-in copy when run standalone). Alarm rules
live in `backend/alarm_rules.yaml` (DB-administered CRUD overrides under
`/api/v1/orgs/{org}/sites/{site}/alarm-rules`).

## Status

v4 enterprise stack shipped: Postgres+RLS multi-tenancy, Keycloak OIDC,
MQTT TLS+dynsec, REST/WS authorization + Origin gates, contract /
integration / security / UAT suites green. Remaining pre-AWS entry criteria
are tracked in `SDLC/industrial-dashboard/15-uat-signoff.md` (production
IdP + realm hardening, per-device IoT policies, TimescaleDB, vision feed,
PLC adapter).
